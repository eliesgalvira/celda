import {
  anioDeReferencia,
  type Banda,
  compararTexto,
  mhzDeRangos,
  type Rango,
} from "@celda/dominio/banda";
import type { Compania } from "@celda/dominio/compania";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type {
  FichaCruda,
  FichaLeida,
  FilaDeNiveles,
  FilaFicha,
  Listado,
  ListadoCrudo,
  Registro,
} from "../extractor.ts";
import { repararTexto, textoDeHtml } from "../texto.ts";
import type { Caja } from "../zona.ts";

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
 * Listado de una caja en grados ETRS89, con los parámetros que manda el visor. El valor de
 * `zoom` no cambia la respuesta, pero una petición sin él y sin los seis decimales recibió `{}`.
 */
export const urlDeListado = (caja: Caja): string =>
  `${ORIGEN}/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=${caja.map((grados) => grados.toFixed(6)).join(",")}`;

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

/** Lo que escribe el registro de un elemento del listado, sin limpiar (ADR 0027). */
export const crudoDeElemento = (elemento: Elemento): ListadoCrudo => ({
  id: elemento.id,
  gisId: elemento.properties.Gis_ID,
  direccion: elemento.properties.Dirección,
  longitud: elemento.geometry.coordinates[0],
  latitud: elemento.geometry.coordinates[1],
});

/**
 * Un registro con la compañía y el texto reparados, a partir de lo que escribe el registro. Es la
 * limpieza de Celda: se puede volver a hacer con lo guardado cuando cambia, sin pedir nada.
 */
export const registroDeCrudo = (crudo: ListadoCrudo): Lectura => {
  const separador = crudo.id.lastIndexOf(" - ");
  const titular = separador > 0 ? crudo.id.slice(0, separador) : crudo.id;
  const compania = companiaDeTitular(titular);
  if (compania === undefined) {
    return { tipo: "aviso", aviso: `Titular desconocido: ${crudo.id}` };
  }
  const direccion = repararTexto(crudo.direccion);
  const codigo = crudo.gisId.trim();
  return {
    tipo: "registro",
    registro: {
      clave: crudo.id,
      compania,
      codigo,
      posicion: { longitud: crudo.longitud, latitud: crudo.latitud },
      direccion,
      municipio: municipioDeDireccion(direccion),
      url: urlDeFicha(codigo, crudo.id),
      crudo,
    },
  };
};

/** Convierte un elemento del listado en un registro con la compañía y el texto reparados. */
export const registroDeElemento = (elemento: Elemento): Lectura =>
  registroDeCrudo(crudoDeElemento(elemento));

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

/**
 * La banda de 26 GHz (de 24,25 a 27,5 GHz), que el registro escribe en GHz en la columna de MHz,
 * como «25.70 - 26.70» en la ficha `0802073` de Telefónica.
 */
const BANDA_DE_26_GHZ = { desde: 24.25, hasta: 27.5 };

/**
 * Un rango en MHz. Uno que cae entero en la banda de 26 GHz escrita en GHz se pasa a MHz: en MHz
 * no hay ninguna banda móvil por debajo de 100.
 */
const rangoEnMhz = (desde: number, hasta: number): Rango =>
  desde >= BANDA_DE_26_GHZ.desde && hasta <= BANDA_DE_26_GHZ.hasta && desde <= hasta
    ? { desdeMhz: Math.round(desde * 1000), hastaMhz: Math.round(hasta * 1000) }
    : { desdeMhz: desde, hastaMhz: hasta };

/** «1910.00 - 1915.00; 2155.00 - 2170.00» son dos rangos de un mismo expediente. */
const rangosDeTexto = (texto: string): ReadonlyArray<Rango> | undefined => {
  const rangos = texto.split(";").map((parte) => {
    const [desde, hasta] = parte.split(" - ").map((n) => Number(n.trim()));
    return desde !== undefined &&
      hasta !== undefined &&
      Number.isFinite(desde) &&
      Number.isFinite(hasta)
      ? rangoEnMhz(desde, hasta)
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

/**
 * Un número de la tabla de niveles. El registro los escribe con punto decimal (`0.98806`); se
 * acepta también la coma (`0,98806`) y el exponente (`1.0E-4`), por si cambia cómo los escribe.
 * Cualquier otra cosa, como un separador de miles, no se da por número.
 */
const numeroDeNiveles = (texto: string): number | undefined => {
  const numero = texto.replace(",", ".");
  return /^\d+(\.\d*)?([eE][+-]?\d+)?$/u.test(numero) ? Number(numero) : undefined;
};

/** Convierte una fila de la tabla de niveles en una medida, o explica por qué no puede. */
export const medidaDeFila = (fila: FilaDeNiveles): Result.Result<MedidaDeExposicion, string> => {
  const distanciaMetros = numeroDeNiveles(fila.distancia);
  const acimutGrados = numeroDeNiveles(fila.acimut);
  const microvatiosPorCm2 = numeroDeNiveles(fila.valor);
  return distanciaMetros === undefined ||
    acimutGrados === undefined ||
    microvatiosPorCm2 === undefined
    ? Result.fail(
        `Medida ilegible en la ficha: ${fila.distancia} m, ${fila.acimut}°, ${fila.valor} µW/cm²`,
      )
    : Result.succeed({ distanciaMetros, acimutGrados, microvatiosPorCm2 });
};

/**
 * Las medidas de todas las filas, o el motivo de la primera que no se puede leer. Una fila con
 * alguna celda vacía no es una medida: el registro publica alguna sin valor, como una de
 * `CATR6190A` de Orange el 26/09/2026.
 */
export const medidasDeFilas = (
  filas: ReadonlyArray<FilaDeNiveles>,
): Result.Result<ReadonlyArray<MedidaDeExposicion>, string> =>
  Result.all(
    filas
      .filter((fila) => fila.distancia !== "" && fila.acimut !== "" && fila.valor !== "")
      .map(medidaDeFila),
  );

/**
 * Versión de `leerFicha`. Una ficha leída con una versión anterior vuelve a la cola aunque no le
 * toque la relectura, para que lo que se lee de más llegue a todas sin esperar a ella. Se sube
 * cada vez que `leerFicha` saca algo nuevo de la ficha o lo saca de otra forma:
 *
 * 1. Las bandas.
 * 2. Las medidas de exposición del ministerio (#73).
 */
export const VERSION_DE_LECTURA = 2;

/**
 * Las bandas y las medidas de exposición de las tablas de una ficha tal como las escribe el
 * registro, o por qué no se pueden leer. Es la limpieza de Celda: se puede volver a hacer con lo
 * guardado cuando cambia (ADR 0027).
 */
export const fichaDeCruda = (
  cruda: FichaCruda,
): Result.Result<Pick<FichaLeida, "bandas" | "medidasDeExposicion">, string> =>
  Result.all({
    bandas: bandasDeFilas(cruda.caracteristicas),
    medidasDeExposicion: medidasDeFilas(cruda.niveles),
  });

/** Las bandas y las medidas de exposición de una ficha en HTML, o por qué no se puede leer. */
export const leerFicha = (html: string): Result.Result<FichaLeida, string> =>
  Result.flatMap(filasDeFicha(html), (cruda) =>
    Result.map(fichaDeCruda(cruda), (leida): FichaLeida => ({ ...leida, cruda })),
  );

const celdas = (fila: string): ReadonlyArray<string> =>
  [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/giu)].map((celda) => textoDeHtml(celda[1] ?? ""));

/**
 * Las filas de tres celdas de un trozo de la ficha. La primera de cada tabla son sus títulos,
 * que empiezan por `titulo`, y no cuenta.
 */
const filasDeTabla = (
  tabla: string,
  titulo: string,
): ReadonlyArray<readonly [string, string, string]> =>
  [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)]
    .map((fila) => celdas(fila[1] ?? ""))
    .filter((c) => c.length === 3 && !(c[0] ?? "").startsWith(titulo))
    .map(([a = "", b = "", c = ""]) => [a, b, c] as const);

/**
 * Si una página es una ficha del geoportal, aunque sea la del aviso de código no válido: todas
 * llevan la tabla `tablaDetalleEstacion`. Una página sin ella, con HTTP 200, no la ha escrito el
 * visor de fichas: un cortafuegos, una página de mantenimiento o un cambio de formato.
 */
export const esFichaDelGeoportal = (html: string): boolean => html.includes("tablaDetalleEstacion");

/** Lo que se apunta de una estación base cuya ficha dice que el registro no la tiene. */
export const AVISO_SIN_FICHA = "La ficha dice «Código de emplazamiento no válido»";

/**
 * Si la ficha es el aviso de código no válido, que llega con HTTP 200: el registro no tiene
 * ficha de esa estación base aunque su listado la incluya, como `061723` de Vodafone o
 * `CLMR6422A` de Orange el 02/10/2026. No es una página ilegible: es lo que dice el registro.
 */
export const esFichaSinEmplazamiento = (html: string): boolean =>
  /c&oacute;digo de emplazamiento no v&aacute;lido|código de emplazamiento no válido/iu.test(html);

/** Lo que se saca de una ficha en HTML, y con qué resultado se archiva. */
export type LecturaDeFicha =
  | { readonly resultado: "leida"; readonly ficha: FichaLeida }
  | { readonly resultado: "sin-ficha" }
  | { readonly resultado: "ilegible"; readonly motivo: string }
  | { readonly resultado: "ajena" };

/**
 * Lee una ficha en HTML como la lee el extractor: una página que no es una ficha del geoportal es
 * ajena, una con el aviso de código no válido es una estación base sin ficha en el registro, y el
 * resto pasa por `leerFicha`. La usan también las relecturas del archivo (ADR 0027).
 */
export const lecturaDeFicha = (html: string): LecturaDeFicha => {
  if (!esFichaDelGeoportal(html)) return { resultado: "ajena" };
  if (esFichaSinEmplazamiento(html)) return { resultado: "sin-ficha" };
  const leida = leerFicha(html);
  return Result.isSuccess(leida)
    ? { resultado: "leida", ficha: leida.success }
    : { resultado: "ilegible", motivo: leida.failure };
};

/**
 * Filas de las dos tablas de la ficha en HTML: «Características técnicas» y «Niveles medidos en el
 * entorno». Una ficha sin la primera, o con el aviso de código no válido
 * (`esFichaSinEmplazamiento`), no es una estación sin bandas. Una sin la segunda, o con la
 * segunda vacía, es una estación de la que el registro no publica medidas.
 */
export const filasDeFicha = (
  html: string,
): Result.Result<
  {
    readonly caracteristicas: ReadonlyArray<FilaFicha>;
    readonly niveles: ReadonlyArray<FilaDeNiveles>;
  },
  string
> => {
  if (esFichaSinEmplazamiento(html)) {
    return Result.fail(AVISO_SIN_FICHA);
  }
  const inicio = html.indexOf("CARACTERISTICAS");
  if (inicio < 0) {
    return Result.fail("La ficha no tiene la tabla de características técnicas");
  }
  const niveles = html.indexOf("NIVELES MEDIDOS", inicio);
  const tablaDeNiveles = niveles < 0 ? "" : html.slice(niveles, html.indexOf("</table>", niveles));
  return Result.succeed({
    caracteristicas: filasDeTabla(
      html.slice(inicio, niveles < 0 ? undefined : niveles),
      "Operador",
    ).map(([operador, referencia, bandaMhz]) => ({ operador, referencia, bandaMhz })),
    niveles: filasDeTabla(tablaDeNiveles, "Distancia").map(([distancia, acimut, valor]) => ({
      distancia,
      acimut,
      valor,
    })),
  });
};
