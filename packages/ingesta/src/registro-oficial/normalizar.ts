import {
  anioDeReferencia,
  type Banda,
  compararTexto,
  mhzDeRangos,
  type Rango,
} from "@celda/dominio/banda";
import type { Compania } from "@celda/dominio/compania";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { Listado, Registro } from "../extractor.ts";
import { repararTexto, textoDeHtml } from "../texto.ts";

export const ORIGEN = "https://geoportal.minetur.gob.es";

/**
 * Razones sociales del registro y su compañía. El registro conserva nombres antiguos:
 * `VODAFONE ESPAÑA, S.A.` junto a `S.A.U.`, `ORANGE ESPAGNE` tras la fusión en MasOrange y
 * `DS MOBILE NETWORKS`, la sociedad de red de Digi.
 */
const TITULARES: ReadonlyArray<readonly [RegExp, Compania]> = [
  [/^TELEF[OÓ]NICA M[OÓ]VILES/iu, "movistar"],
  [/^VODAFONE ESPA[NÑ]A/iu, "vodafone"],
  [/^ORANGE ESPAG?[NÑ]/iu, "orange"],
  [/^DS MOBILE NETWORKS/iu, "digi"],
  [/^DIGI SPAIN TELECOM/iu, "digi"],
  [/^XFERA M[OÓ]VILES/iu, "yoigo"],
];

export const companiaDeTitular = (titular: string): Compania | undefined =>
  TITULARES.find(([patron]) => patron.test(titular.trim()))?.[1];

/** La dirección tiene la forma «vía, número. MUNICIPIO, PROVINCIA». */
export const municipioDeDireccion = (direccion: string): string => {
  const partes = direccion.split(". ");
  const final = partes.at(-1) ?? "";
  const coma = final.lastIndexOf(",");
  return partes.length > 1 && coma > 0 ? final.slice(0, coma).trim() : "";
};

/** Enlace a la ficha. `codEmplazamiento` va en UTF-8: en Latin-1 la ficha no lo reconoce. */
export const urlDeFicha = (codigo: string, clave: string): string =>
  `${ORIGEN}/VCTEL/detalleEstacion.do?emplazamiento=${encodeURIComponent(codigo)}&codEmplazamiento=${encodeURIComponent(clave)}`;

/**
 * Listado de una caja, con los mismos parámetros que manda el visor: `zoom` no cambia la
 * respuesta, pero sin él el geoportal contesta `{}`.
 */
export const urlDeListado = (caja: Caja): string =>
  `${ORIGEN}/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=${caja.map((grados) => grados.toFixed(6)).join(",")}`;

export type Caja = readonly [oeste: number, sur: number, este: number, norte: number];

const Elemento = Schema.Struct({
  id: Schema.String,
  geometry: Schema.Struct({
    coordinates: Schema.Tuple([Schema.Finite, Schema.Finite]),
  }),
  properties: Schema.Struct({
    Gis_ID: Schema.String,
    Dirección: Schema.String,
  }),
});
type Elemento = typeof Elemento.Type;

/** Una caja sin estaciones devuelve `{}` en lugar de una colección vacía. */
export const RespuestaListado = Schema.fromJsonString(
  Schema.Union([Schema.Struct({ features: Schema.Array(Schema.Unknown) }), Schema.Struct({})]),
);

/** Tope de elementos por respuesta. Una caja que llega a él se divide siempre. */
export const TOPE_LISTADO = 1000;

export type Lectura =
  | { readonly tipo: "registro"; readonly registro: Registro }
  | { readonly tipo: "aviso"; readonly aviso: string };

/** Convierte un elemento del listado en un registro con la compañía y el texto reparados. */
export const registroDeElemento = (elemento: Elemento): Lectura => {
  const separador = elemento.id.lastIndexOf(" - ");
  const titular = separador > 0 ? elemento.id.slice(0, separador) : elemento.id;
  const compania = companiaDeTitular(titular);
  if (compania === undefined) {
    return { tipo: "aviso", aviso: `Titular desconocido: ${elemento.id}` };
  }
  const [longitud, latitud] = elemento.geometry.coordinates;
  const direccion = repararTexto(elemento.properties.Dirección);
  return {
    tipo: "registro",
    registro: {
      clave: elemento.id,
      compania,
      codigo: elemento.properties.Gis_ID.trim(),
      posicion: { longitud, latitud },
      direccion,
      municipio: municipioDeDireccion(direccion),
      url: urlDeFicha(elemento.properties.Gis_ID.trim(), elemento.id),
    },
  };
};

const decodificarElemento = Schema.decodeUnknownOption(Elemento);

/**
 * Registros de los elementos de todas las cajas, sin repetir: un elemento en el borde de dos
 * cajas sale en las dos. Salen ordenados por clave.
 */
export const listadoDeElementos = (elementos: ReadonlyArray<unknown>): Listado => {
  const registros = new Map<string, Registro>();
  const avisos: Array<string> = [];
  for (const elemento of elementos) {
    const lectura = Option.map(decodificarElemento(elemento), registroDeElemento);
    if (Option.isNone(lectura)) {
      avisos.push("Elemento del listado con un formato desconocido");
    } else if (lectura.value.tipo === "aviso") {
      avisos.push(lectura.value.aviso);
    } else if (!registros.has(lectura.value.registro.clave)) {
      registros.set(lectura.value.registro.clave, lectura.value.registro);
    }
  }
  return {
    registros: [...registros.values()].sort((a, b) => compararTexto(a.clave, b.clave)),
    avisos,
  };
};

/** Fila de la tabla «Características técnicas» de la ficha. */
export interface FilaFicha {
  readonly operador: string;
  readonly referencia: string;
  readonly bandaMhz: string;
}

/** «1910.00 - 1915.00; 2155.00 - 2170.00» son dos rangos de un mismo expediente. */
const rangosDeTexto = (texto: string): ReadonlyArray<Rango> | undefined => {
  const rangos = texto.split(";").map((parte) => {
    const [desde, hasta] = parte.split(" - ").map((n) => Number(n.trim()));
    return desde !== undefined &&
      hasta !== undefined &&
      Number.isFinite(desde) &&
      Number.isFinite(hasta)
      ? { desdeMhz: desde, hastaMhz: hasta }
      : undefined;
  });
  return rangos.every((r) => r !== undefined) ? rangos : undefined;
};

/** Convierte una fila de la ficha en una banda, o explica por qué no puede. */
export const bandaDeFila = (fila: FilaFicha): Result.Result<Banda, string> => {
  const compania = companiaDeTitular(fila.operador);
  const rangos = rangosDeTexto(fila.bandaMhz);
  if (compania === undefined) {
    return Result.fail(`Operador desconocido en la ficha: ${fila.operador}`);
  }
  if (rangos === undefined) {
    return Result.fail(`Banda ilegible en la ficha: ${fila.bandaMhz}`);
  }
  const referencia = repararTexto(fila.referencia);
  return Result.succeed({
    referencia,
    compania,
    rangos,
    mhz: mhzDeRangos(rangos),
    anio: anioDeReferencia(referencia),
  });
};

/** Las bandas de todas las filas, o el motivo de la primera que no se puede leer. */
export const bandasDeFilas = (
  filas: ReadonlyArray<FilaFicha>,
): Result.Result<ReadonlyArray<Banda>, string> => Result.all(filas.map(bandaDeFila));

/** Las bandas de una ficha en HTML, o por qué no se puede leer. */
export const bandasDeFicha = (html: string): Result.Result<ReadonlyArray<Banda>, string> =>
  Result.flatMap(filasDeFicha(html), bandasDeFilas);

const celdas = (fila: string): ReadonlyArray<string> =>
  [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/giu)].map((celda) => textoDeHtml(celda[1] ?? ""));

/**
 * Filas de «Características técnicas» de la ficha en HTML. Una ficha sin esa tabla, o con el
 * aviso de código no válido (que llega con HTTP 200), es un error de la fuente y no una
 * estación sin bandas.
 */
export const filasDeFicha = (html: string): Result.Result<ReadonlyArray<FilaFicha>, string> => {
  if (
    /c&oacute;digo de emplazamiento no v&aacute;lido|código de emplazamiento no válido/iu.test(html)
  ) {
    return Result.fail("La ficha dice «Código de emplazamiento no válido»");
  }
  const inicio = html.indexOf("CARACTERISTICAS");
  if (inicio < 0) {
    return Result.fail("La ficha no tiene la tabla de características técnicas");
  }
  const fin = html.indexOf("NIVELES MEDIDOS", inicio);
  const tabla = html.slice(inicio, fin < 0 ? undefined : fin);
  return Result.succeed(
    [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)]
      .map((fila) => celdas(fila[1] ?? ""))
      .filter((c) => c.length === 3 && c[0] !== "Operador")
      .map(([operador = "", referencia = "", bandaMhz = ""]) => ({
        operador,
        referencia,
        bandaMhz,
      })),
  );
};
