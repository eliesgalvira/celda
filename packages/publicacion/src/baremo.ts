import {
  type Baremo,
  CORTES,
  desviacionDe,
  EMPLAZAMIENTOS_MINIMOS,
  enLaRecta,
  FORMATO_DEL_BAREMO,
  ficheroDeBaremo,
  generarBaremo,
  type MedidasDeEspana,
  puntoDeMedida,
  type PuntoDeMedida,
  type RectaDelBaremo,
  UNO_POR_CIENTO_DEL_NIVEL,
  type ZonaDelBaremo,
} from "@celda/dominio/baremo";
import { claveDeMedida, type MedidaDeExposicion } from "@celda/dominio/exposicion";
import type { Ficha } from "@celda/dominio/ficha";
import { leerLoteDeProvincia } from "@celda/dominio/provincias";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AlmacenDeFicheros } from "./almacen.ts";

/**
 * Los baremos de exposición (ADR 0030), que el montaje de las capas calcula con los lotes de fichas
 * de la versión vigente y deja junto a ellas (`montarBaremos`). Cómo se leen y qué dicen está en
 * `@celda/dominio/baremo`.
 */

/** Un lote de la versión vigente no se ha podido leer: el build no monta las capas. */
export class BaremoSinCalcular extends Schema.TaggedError<BaremoSinCalcular>()(
  "BaremoSinCalcular",
  { motivo: Schema.String },
) {}

/**
 * Lo que se aparta de la típica una medida que cae en ella, en dB, para poder tomar su logaritmo.
 * Las rectas solo dependen de qué medidas quedan por encima o por debajo, así que el resultado no
 * depende de este valor mientras quede muy por debajo de la separación, que es de unos dB. Es
 * además la precisión del fichero.
 */
const SEPARACION_MINIMA_DB = 0.01;

/** Los números del fichero, con dos decimales: 0,01 dB es la décima parte del paso de 0,01 V/m. */
const redondear = (numero: number): number => Math.round(numero * 100) / 100;

/** Una medida de exposición de un emplazamiento, con la zona en que cae. */
export interface MedidaDeZona {
  readonly provincia: string;
  /** `null` en un territorio compartido: solo cuenta para la provincia. */
  readonly municipio: string | null;
  readonly emplazamiento: string;
  readonly distanciaMetros: number;
  readonly microvatiosPorCm2: number;
}

/**
 * Las medidas de exposición de un emplazamiento. Si dos de sus estaciones base publican la misma
 * medida (distancia, acimut y valor), cuenta una vez: es la misma.
 */
const medidasUnicasDe = (ficha: Ficha): ReadonlyArray<MedidaDeExposicion> => [
  ...new Map(
    ficha.estaciones
      .flatMap((estacion) => estacion.medidasDeExposicion ?? [])
      .map((medida) => [claveDeMedida(medida), medida]),
  ).values(),
];

/** Las medidas de exposición de unas fichas, con su zona. Una ficha sin provincia no entra en ninguna. */
export const medidasDeFichas = (fichas: ReadonlyArray<Ficha>): ReadonlyArray<MedidaDeZona> =>
  fichas.flatMap((ficha) => {
    const provincia = ficha.lugar?.provincia?.codigo;
    if (provincia === undefined) return [];
    return medidasUnicasDe(ficha).map((medida) => ({
      provincia,
      municipio: ficha.lugar?.municipio?.codigo ?? null,
      emplazamiento: ficha.clave,
      distanciaMetros: medida.distanciaMetros,
      microvatiosPorCm2: medida.microvatiosPorCm2,
    }));
  });

/** Los valores de las medidas de unas fichas, en µW/cm², también de las fichas sin provincia. */
export const valoresDeFichas = (fichas: ReadonlyArray<Ficha>): ReadonlyArray<number> =>
  fichas.flatMap((ficha) => medidasUnicasDe(ficha).map((medida) => medida.microvatiosPorCm2));

/** Las medidas de toda España, con los valores de todas sus fichas (`valoresDeFichas`). */
export const medidasDeEspana = (valores: ReadonlyArray<number>): MedidasDeEspana => ({
  medidas: valores.length,
  bajoElUnoPorCiento: valores.filter((valor) => valor < UNO_POR_CIENTO_DEL_NIVEL).length,
  maxima: valores.reduce((mayor, valor) => Math.max(mayor, valor), 0),
});

const sumaDeDesviaciones = (puntos: ReadonlyArray<PuntoDeMedida>, recta: RectaDelBaremo): number =>
  puntos.reduce((suma, punto) => suma + Math.abs(punto.y - enLaRecta(recta, punto.x)), 0);

/** El valor de menor índice cuyo peso acumulado llega a la mitad del total. */
const medianaPonderada = <A extends { readonly valor: number; readonly peso: number }>(
  candidatos: ReadonlyArray<A>,
): A | undefined => {
  const ordenados = candidatos.toSorted((a, b) => a.valor - b.valor);
  const mitad = ordenados.reduce((suma, candidato) => suma + candidato.peso, 0) / 2;
  let acumulado = 0;
  return ordenados.find((candidato) => {
    acumulado += candidato.peso;
    return acumulado >= mitad;
  });
};

/**
 * La recta mejor por un punto (`pivote`) es la de la mediana ponderada de las pendientes hacia los
 * demás. Si pasa por otro punto con menos suma de desviaciones, se repite desde él; si no, la de
 * antes es la mejor de todas, porque la suma es convexa (Wesolowsky, 1981).
 */
const descender = (
  puntos: ReadonlyArray<PuntoDeMedida>,
  pivote: PuntoDeMedida,
  mejor: { readonly recta: RectaDelBaremo; readonly suma: number },
): RectaDelBaremo => {
  const siguiente = medianaPonderada(
    puntos
      .filter((punto) => punto.x !== pivote.x)
      .map((punto) => ({
        valor: (punto.y - pivote.y) / (punto.x - pivote.x),
        peso: Math.abs(punto.x - pivote.x),
        punto,
      })),
  );
  if (siguiente === undefined) return mejor.recta;
  const recta = { nivel: pivote.y - siguiente.valor * pivote.x, pendiente: siguiente.valor };
  const suma = sumaDeDesviaciones(puntos, recta);
  return suma < mejor.suma ? descender(puntos, siguiente.punto, { recta, suma }) : mejor.recta;
};

/**
 * La recta de mínimas desviaciones absolutas: la que hace mínima la suma de las distancias en
 * vertical a los puntos, y deja la mitad por encima y la mitad por debajo. Es la mediana de `y` a
 * cada `x`, y unas pocas medidas extremas no la mueven. Sin dos `x` distintas es horizontal, a la
 * altura de la mediana.
 */
export const rectaMediana = (puntos: ReadonlyArray<PuntoDeMedida>): RectaDelBaremo => {
  const ordenados = puntos.toSorted((a, b) => a.x - b.x || a.y - b.y);
  const ys = ordenados.map((punto) => punto.y).toSorted((a, b) => a - b);
  const horizontal = { nivel: ys[Math.floor((ys.length - 1) / 2)] ?? 0, pendiente: 0 };
  const pivote = ordenados[Math.floor(ordenados.length / 2)];
  if (pivote === undefined) return horizontal;
  return descender(ordenados, pivote, { recta: horizontal, suma: Number.POSITIVE_INFINITY });
};

const redondearRecta = (recta: RectaDelBaremo): RectaDelBaremo => ({
  nivel: redondear(recta.nivel),
  pendiente: redondear(recta.pendiente),
});

/**
 * Las medidas de una zona como zona del baremo, si son de bastantes emplazamientos: sus
 * desviaciones en los percentiles 1 a 99, por rango más próximo.
 */
const zonaDe = (
  codigo: string,
  medidas: ReadonlyArray<{ readonly emplazamiento: string; readonly desviacion: number }>,
): ZonaDelBaremo | undefined => {
  const emplazamientos = new Set(medidas.map((medida) => medida.emplazamiento)).size;
  if (emplazamientos < EMPLAZAMIENTOS_MINIMOS) return undefined;
  const ordenadas = medidas.map((medida) => medida.desviacion).toSorted((a, b) => a - b);
  return {
    codigo,
    medidas: ordenadas.length,
    emplazamientos,
    cortes: Array.from({ length: CORTES }, (_, i) =>
      redondear(ordenadas[Math.ceil(((i + 1) * ordenadas.length) / (CORTES + 1)) - 1] ?? 0),
    ),
  };
};

/**
 * El baremo de `provincia` con las medidas de sus emplazamientos en `version`, y las de toda
 * España. Las rectas salen de todas las medidas de la provincia y se redondean antes de calcular
 * las desviaciones, así que la web, que las lee redondeadas, da las mismas.
 */
export const baremoDeProvincia = (
  version: string,
  provincia: string,
  medidas: ReadonlyArray<MedidaDeZona>,
  espana: MedidasDeEspana,
): Baremo => {
  const puntos = medidas.map(puntoDeMedida);
  const tipica = redondearRecta(rectaMediana(puntos));
  const separacion = redondearRecta(
    rectaMediana(
      puntos.map((punto) => ({
        x: punto.x,
        y: Math.log10(
          Math.max(Math.abs(punto.y - enLaRecta(tipica, punto.x)), SEPARACION_MINIMA_DB),
        ),
      })),
    ),
  );
  const desviadas = medidas.map((medida) => ({
    ...medida,
    desviacion: desviacionDe({ tipica, separacion }, medida),
  }));
  const porMunicipio = Arr.groupBy(
    desviadas.filter((medida) => medida.municipio !== null),
    (medida) => medida.municipio ?? "",
  );
  return {
    formato: FORMATO_DEL_BAREMO,
    version,
    provincia,
    tipica,
    separacion,
    zonaProvincial: zonaDe(provincia, desviadas) ?? null,
    municipios: Object.entries(porMunicipio)
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([codigo, suyas]) => zonaDe(codigo, suyas) ?? []),
    espana,
  };
};

/** Lo que ha montado `montarBaremos`: un fichero por provincia con medidas. */
export interface BaremosMontados {
  readonly ficheros: ReadonlyArray<string>;
  /** Suma de sus tamaños sin comprimir. */
  readonly bytes: number;
}

/** La provincia de un lote de fichas: `08` en `fichas/08/<huella>.json`. */
const provinciaDelLote = (fichero: string): string | undefined =>
  /^fichas\/([^/]+)\/[^/]+\.json$/u.exec(fichero)?.[1];

/**
 * Calcula el baremo de cada provincia de `version` con sus lotes de fichas, de entre `ficheros`,
 * tal como están en el almacén del contexto, y lo guarda en él. Solo la versión vigente: las
 * anteriores montadas pueden ser de otro formato de fichas, y una pestaña que aún las lee enseña
 * las medidas sin compararlas. Si un lote falta o no se entiende, falla, y el build con él: la web
 * tampoco podría leerlo.
 */
export const montarBaremos = Effect.fn("Baremo.montar")(function* (
  version: string,
  ficheros: ReadonlyArray<string>,
) {
  const almacen = yield* AlmacenDeFicheros;
  const lotes = ficheros.flatMap((fichero) => {
    const provincia = provinciaDelLote(fichero);
    return provincia === undefined ? [] : [{ fichero, provincia }];
  });
  const medidas = yield* Effect.forEach(
    lotes,
    ({ fichero, provincia }) =>
      Effect.gen(function* () {
        const contenido = yield* almacen.leer(fichero);
        if (Option.isNone(contenido)) {
          return yield* new BaremoSinCalcular({ motivo: `falta ${fichero}` });
        }
        const fichas = leerLoteDeProvincia(contenido.value, provincia);
        if (Result.isFailure(fichas)) {
          return yield* new BaremoSinCalcular({
            motivo: `${fichero} no se entiende: ${fichas.failure.motivo}`,
          });
        }
        return {
          deZona: medidasDeFichas(fichas.success),
          valores: valoresDeFichas(fichas.success),
        };
      }),
    { concurrency: 8 },
  );
  const espana = medidasDeEspana(medidas.flatMap((lote) => lote.valores));
  const porProvincia = Arr.groupBy(
    medidas.flatMap((lote) => lote.deZona),
    (medida) => medida.provincia,
  );
  const escritos = yield* Effect.forEach(
    Object.entries(porProvincia).toSorted(([a], [b]) => (a < b ? -1 : 1)),
    ([provincia, suyas]) =>
      Effect.gen(function* () {
        const fichero = ficheroDeBaremo(version, provincia);
        const contenido = generarBaremo(baremoDeProvincia(version, provincia, suyas, espana));
        yield* almacen.guardar(fichero, contenido);
        return { fichero, bytes: new TextEncoder().encode(contenido).length };
      }),
  );
  const montados: BaremosMontados = {
    ficheros: escritos.map((escrito) => escrito.fichero),
    bytes: escritos.reduce((suma, escrito) => suma + escrito.bytes, 0),
  };
  return montados;
});
