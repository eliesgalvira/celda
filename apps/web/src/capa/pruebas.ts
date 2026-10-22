import type { Barrio, FuenteDeBarrios } from "@celda/dominio/barrio";
import {
  codificarVigente,
  type EmplazamientoDeCapa,
  type EmplazamientoLeido,
} from "@celda/dominio/capa";
import type { ZonaBarrida } from "@celda/dominio/cobertura";
import type { Ficha } from "@celda/dominio/ficha";
import { repartirEnLotes } from "@celda/dominio/lotes";
import type { FuenteDeMunicipios } from "@celda/dominio/municipio";
import {
  type CapaDeProvincia,
  combinacionesDeSituados,
  companiasDeSituados,
  cajaDeSituados,
  type EmplazamientoSituado,
  ficheroDeCapaDeProvincia,
  ficheroDeIndiceDeClaves,
  ficheroDeLoteDeProvincia,
  ficheroDeResumen,
  type FuentesDeZonas,
  generarCapaDeProvincia,
  generarIndiceDeClaves,
  generarLoteDeProvincia,
  generarResumen,
  leerCapaDeProvincia,
  leerResumen,
  type ProvinciaDelResumen,
  type ResumenLeido,
} from "@celda/dominio/provincias";
import { ficheroDePuntos, generarPuntos } from "@celda/dominio/puntos";
import { cajaDe } from "@celda/dominio/area";
import { combinacionesDe } from "@celda/dominio/filtro";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { crearAgrupador } from "./agrupacion.ts";
import { agrupacionEnHilo, type ProvinciaCargada, prefijoDeProvincia } from "./nacional.ts";
import { leerPuntosDelMapa, type PuntosDelMapa } from "./puntos.ts";
import { CapaEmplazamientos, type FalloCapa } from "./servicio.ts";

/** El fichero de los puntos en los resúmenes de prueba. */
export const FICHERO_DE_PUNTOS_DE_PRUEBA = ficheroDePuntos("prueba");

/**
 * Los puntos de toda España de unas provincias de prueba, como los publica la publicación y los
 * deja el Worker de capas.
 */
export const puntosDePrueba = (
  provincias: ReadonlyArray<{
    readonly codigo: string;
    readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  }>,
): PuntosDelMapa => {
  const leidos = leerPuntosDelMapa(
    generarPuntos(
      new Map(
        provincias.map((p) => [
          p.codigo,
          p.emplazamientos.map((emplazamiento): EmplazamientoSituado => ({
            emplazamiento,
            provincia: p.codigo,
            municipio: emplazamiento.municipio ?? null,
            lugar: { municipio: null, provincia: null },
          })),
        ]),
      ),
    ),
  );
  if (Result.isFailure(leidos)) throw new Error(leidos.failure.motivo);
  return leidos.success;
};

/** La fuente de los límites de barrio, como la publica Open Data BCN. */
export const FUENTE_DE_BARRIOS: FuenteDeBarrios = {
  atribucion: "Ajuntament de Barcelona",
  licencia: "CC BY 4.0",
  enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
  fecha: "2024-11-12",
};

/** La fuente de los límites de municipios, como la da el canal del IGN. */
export const FUENTE_DE_MUNICIPIOS: FuenteDeMunicipios = {
  atribucion: "Instituto Geográfico Nacional",
  producto: "Base de Datos de Límites Jurisdiccionales de España",
  licencia: "CC BY 4.0",
  enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
  fecha: "2026-08-10",
  huella: "sha256:prueba",
};

/** Las fuentes que cita el resumen de prueba. */
export const FUENTES_DE_PRUEBA: FuentesDeZonas = {
  barrios: FUENTE_DE_BARRIOS,
  municipios: FUENTE_DE_MUNICIPIOS,
  padron: {
    atribucion: "INE",
    licencia: "CC BY 4.0",
    enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
    referencia: "2025-01-01",
    publicada: "2025-12-11",
  },
};

/** La caja de Barcelona como zona barrida la noche de `barrido`. */
export const cajaDeBarcelona = (barrido: number | null): ZonaBarrida => ({
  nombre: "registro-oficial",
  titulo: "Caja de Barcelona",
  cajas: [[2.052, 41.317, 2.229, 41.468]],
  barrido,
});

/**
 * Lo que las pruebas de pantalla dan como capa: los emplazamientos de una provincia de una
 * versión, con sus barrios. Es la forma de la capa entera de antes del formato 5.
 */
export interface CapaDePrueba {
  readonly version: string;
  readonly fecha: number;
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  readonly barrios: ReadonlyArray<Barrio>;
  readonly fuenteDeBarrios: FuenteDeBarrios;
  /** Los ficheros de sus lotes; si faltan, uno por cada número de la columna `lote`. */
  readonly lotes?: ReadonlyArray<string>;
}

/** Barcelona en el resumen, con la caja de sus emplazamientos. */
const BARCELONA: Pick<ProvinciaDelResumen, "codigo" | "nombre" | "etiqueta"> = {
  codigo: "08",
  nombre: "Barcelona",
  etiqueta: { longitud: 1.983915, latitud: 41.730886 },
};

/** La provincia de Barcelona cargada con la capa de prueba: todos sus emplazamientos van en ella. */
export const provinciaDePrueba = (capa: CapaDePrueba): ProvinciaCargada => {
  const codigo = BARCELONA.codigo;
  const emplazamientos = capa.emplazamientos.map((e) => ({
    ...e,
    provincia: codigo,
    municipio: e.municipio ?? null,
    lote: e.lote ?? 0,
  }));
  const cuantosLotes = Math.max(0, ...emplazamientos.map((e) => e.lote + 1));
  const lotes =
    capa.lotes ??
    Array.from({ length: cuantosLotes }, (_, i) => ficheroDeLoteDeProvincia(codigo, `prueba${i}`));
  return {
    codigo,
    version: capa.version,
    fecha: capa.fecha,
    capa: {
      provincia: codigo,
      emplazamientos,
      barrios: capa.barrios,
      fuenteDeBarrios: capa.fuenteDeBarrios,
      municipios: [],
      lotes,
    },
    agrupador: crearAgrupador(emplazamientos, capa.barrios, {
      prefijo: prefijoDeProvincia(codigo),
    }),
  };
};

/**
 * El resumen con la capa de prueba: Barcelona, cubierta, con todos sus emplazamientos y sus
 * combinaciones de compañías. Con `sinCombinaciones`, como uno publicado antes de ellas.
 */
export const resumenDePrueba = (capa: CapaDePrueba, sinCombinaciones = false): ResumenLeido => {
  const barcelona: ProvinciaDelResumen = {
    ...BARCELONA,
    caja: cajaDe(capa.emplazamientos.map((e) => e.posicion)),
    emplazamientos: capa.emplazamientos.length,
    companias: [...new Set(capa.emplazamientos.flatMap((e) => e.companias))],
    cubierta: true,
    barrido: capa.fecha,
    fichero: ficheroDeCapaDeProvincia(BARCELONA.codigo, "prueba"),
  };
  return {
    version: capa.version,
    fecha: capa.fecha,
    fuentes: FUENTES_DE_PRUEBA,
    cobertura: [cajaDeBarcelona(capa.fecha)],
    provincias: [
      sinCombinaciones
        ? barcelona
        : { ...barcelona, combinaciones: combinacionesDe(capa.emplazamientos) },
    ],
    puntos: FICHERO_DE_PUNTOS_DE_PRUEBA,
  };
};

/**
 * Servicio de capa de prueba: la carga número `n` del resumen devuelve el de `cargas[n]`, y a
 * partir de la última repite esa. La provincia de Barcelona sale de la última capa que ha llegado
 * o, si no ha llegado ninguna, de la última carga. Con `Effect.never` no terminan nunca. Las
 * claves de `anteriores` llevan a la de un emplazamiento que se juntó con otro, como el índice.
 */
export const capaDePrueba = (
  cargas: ReadonlyArray<Effect.Effect<CapaDePrueba, FalloCapa>>,
  opciones: {
    readonly sinCombinaciones?: boolean;
    readonly anteriores?: ReadonlyMap<string, string>;
  } = {},
): Layer.Layer<CapaEmplazamientos> =>
  Layer.sync(CapaEmplazamientos, () => {
    let hechas = 0;
    let llegada = Option.none<CapaDePrueba>();
    const carga = (n: number) => cargas[Math.min(n, cargas.length - 1)] ?? Effect.never;
    return CapaEmplazamientos.of({
      resumen: Effect.suspend(() => {
        const esta = carga(hechas);
        hechas += 1;
        return Effect.map(
          Effect.tap(esta, (capa) =>
            Effect.sync(() => {
              llegada = Option.some(capa);
            }),
          ),
          (capa) => resumenDePrueba(capa, opciones.sinCombinaciones === true),
        );
      }),
      provincia: () =>
        Effect.suspend(() =>
          Effect.map(
            Option.match(llegada, {
              onSome: Effect.succeed,
              onNone: () => carga(cargas.length - 1),
            }),
            provinciaDePrueba,
          ),
        ),
      agrupacion: (_codigo, filtro) =>
        Effect.suspend(() =>
          Effect.map(
            Option.match(llegada, {
              onSome: Effect.succeed,
              onNone: () => carga(cargas.length - 1),
            }),
            (capa) =>
              agrupacionEnHilo(
                provinciaDePrueba(capa),
                resumenDePrueba(capa, opciones.sinCombinaciones === true),
                filtro,
              ),
          ),
        ),
      puntos: Effect.suspend(() =>
        Effect.map(
          Option.match(llegada, {
            onSome: Effect.succeed,
            onNone: () => carga(cargas.length - 1),
          }),
          (capa) =>
            puntosDePrueba([{ codigo: BARCELONA.codigo, emplazamientos: capa.emplazamientos }]),
        ),
      ),
      // Todos los emplazamientos de prueba van en Barcelona.
      situarClave: (clave) =>
        Effect.suspend(() =>
          Effect.map(
            Option.match(llegada, {
              onSome: Effect.succeed,
              onNone: () => carga(cargas.length - 1),
            }),
            (capa) => {
              const actual = opciones.anteriores?.get(clave) ?? clave;
              return capa.emplazamientos.some((e) => e.clave === actual)
                ? Option.some({ clave: actual, provincia: BARCELONA.codigo })
                : Option.none();
            },
          ),
        ),
    });
  });

/** Una huella de prueba, corta y estable, para nombrar los ficheros por su contenido. */
const huellaDePrueba = (contenido: string): string => {
  let a = 0x811c_9dc5;
  let b = 0x0100_0193;
  for (let i = 0; i < contenido.length; i++) {
    a = Math.imul(a ^ contenido.charCodeAt(i), 0x0100_0193) >>> 0;
    b = Math.imul(b ^ contenido.charCodeAt(i), 0x5bd1_e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
};

/** Una versión publicada en el formato 6, con todos sus ficheros, como la leería la web. */
export interface PublicacionDePrueba {
  readonly version: string;
  readonly fecha: number;
  /** Cada fichero publicado, por su nombre, con `vigente.json`. */
  readonly ficheros: ReadonlyMap<string, string>;
  readonly resumen: ResumenLeido;
  readonly capa: CapaDeProvincia;
  /** El fichero del lote de una clave. */
  readonly loteDe: (clave: string) => string;
}

/**
 * Publica unas fichas en Barcelona como lo haría la publicación, en lotes de `porLote`, sin
 * municipios ni barrios, para probar el servicio de capa y el de fichas con el formato de verdad.
 * El índice de claves va en `partesDelIndice` partes; con `null`, el resumen es de antes del
 * índice.
 */
export const publicacionDePrueba = (
  version: string,
  fecha: number,
  fichas: ReadonlyArray<Ficha>,
  porLote = 2,
  partesDelIndice: number | null = 4,
  anteriores: ReadonlyArray<readonly [anterior: string, actual: string]> = [],
): PublicacionDePrueba => {
  const situados: ReadonlyArray<EmplazamientoSituado> = fichas
    .map((f) => {
      const emplazamiento: EmplazamientoDeCapa = {
        clave: f.clave,
        posicion: f.posicion,
        estado: f.estado,
        // Las de sus estaciones base o, sin ninguna, Movistar.
        companias: f.estaciones.length > 0 ? f.estaciones.map((e) => e.compania) : ["movistar"],
      };
      return {
        emplazamiento,
        provincia: "08",
        municipio: null,
        lugar: { municipio: null, provincia: null },
      };
    })
    .toSorted((a, b) => (a.emplazamiento.clave < b.emplazamiento.clave ? -1 : 1));
  const ficheros = new Map<string, string>();
  const lotes = repartirEnLotes(
    situados.map((s) => s.emplazamiento),
    porLote,
  ).map((claves) => {
    const contenido = generarLoteDeProvincia(
      "08",
      fichas.filter((f) => claves.includes(f.clave)),
      new Map(),
      FUENTE_DE_MUNICIPIOS,
    );
    const fichero = ficheroDeLoteDeProvincia("08", huellaDePrueba(contenido));
    ficheros.set(fichero, contenido);
    return { fichero, claves };
  });
  const contenidoCapa = generarCapaDeProvincia({
    provincia: "08",
    situados,
    barrios: { fuente: FUENTE_DE_BARRIOS, barrios: [] },
    municipios: [],
    lotes,
  });
  const ficheroCapa = ficheroDeCapaDeProvincia("08", huellaDePrueba(contenidoCapa));
  ficheros.set(ficheroCapa, contenidoCapa);
  const claves =
    partesDelIndice === null
      ? undefined
      : generarIndiceDeClaves(
          new Map([["08", situados]]),
          partesDelIndice,
          new Map(anteriores),
        ).map((contenido) => {
          const fichero = ficheroDeIndiceDeClaves(huellaDePrueba(contenido));
          ficheros.set(fichero, contenido);
          return fichero;
        });
  const contenidoPuntos = generarPuntos(new Map([["08", situados]]));
  const ficheroPuntos = ficheroDePuntos(huellaDePrueba(contenidoPuntos));
  ficheros.set(ficheroPuntos, contenidoPuntos);
  const contenidoResumen = generarResumen({
    version,
    fuentes: FUENTES_DE_PRUEBA,
    cobertura: [cajaDeBarcelona(fecha)],
    provincias: [
      {
        ...BARCELONA,
        caja: cajaDeSituados(situados),
        emplazamientos: situados.length,
        companias: companiasDeSituados(situados),
        fichero: ficheroCapa,
        combinaciones: combinacionesDeSituados(situados),
      },
    ],
    cuadros: new Map(),
    claves,
    puntos: ficheroPuntos,
  });
  const ficheroResumen = ficheroDeResumen(version, huellaDePrueba(contenidoResumen));
  ficheros.set(ficheroResumen, contenidoResumen);
  ficheros.set(
    "vigente.json",
    codificarVigente({
      version,
      fecha,
      emplazamientos: situados.length,
      lotes: lotes.length,
      resumen: ficheroResumen,
    }),
  );
  const resumen = leerResumen(contenidoResumen, version);
  const capa = leerCapaDeProvincia(contenidoCapa, "08");
  if (Result.isFailure(resumen) || Result.isFailure(capa)) {
    throw new Error("la publicación de prueba no se lee");
  }
  return {
    version,
    fecha,
    ficheros,
    resumen: resumen.success,
    capa: capa.success,
    loteDe: (clave) => lotes.find((l) => l.claves.includes(clave))?.fichero ?? "",
  };
};

/** La capa de prueba de una publicación de prueba, para `capaDePrueba`. */
export const capaDePublicacion = (publicacion: PublicacionDePrueba): CapaDePrueba => ({
  version: publicacion.version,
  fecha: publicacion.fecha,
  emplazamientos: publicacion.capa.emplazamientos,
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
  lotes: publicacion.capa.lotes,
});
