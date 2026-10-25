/**
 * La consulta de `GET /api/emplazamientos` (ADR 0032): qué parámetros acepta, con qué límites y
 * qué se contesta a uno que no vale. Va aparte de la función para probarla sin red.
 *
 * Importa el dominio por ruta relativa: el compilador de funciones de Vercel convierte los `.ts`
 * del paquete en `.js`, pero no reescribe sus `exports`, y `@celda/dominio/…` no se encontraría
 * en producción (ADR 0032).
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Compania } from "../../../../packages/dominio/src/compania.ts";

/** Radio que se usa si la consulta no lo dice, en metros. */
export const RADIO_POR_DEFECTO = 1000;
/** Radio más grande que se acepta, en metros. */
export const RADIO_MAXIMO = 10_000;
/** Emplazamientos que se devuelven si la consulta no lo dice. */
export const LIMITE_POR_DEFECTO = 20;
/** Emplazamientos que se devuelven como mucho. */
export const LIMITE_MAXIMO = 50;

export interface Consulta {
  readonly latitud: number;
  readonly longitud: number;
  readonly radio: number;
  /** Las compañías del filtro; vacío es sin filtro. */
  readonly companias: ReadonlyArray<Compania>;
  readonly limite: number;
}

/** La consulta no vale: el mensaje dice por qué, en castellano, para quien la escribió. */
export class ConsultaNoValida extends Schema.TaggedError<ConsultaNoValida>()("ConsultaNoValida", {
  mensaje: Schema.String,
}) {}

const numero = (minimo: number, maximo: number) =>
  Schema.FiniteFromString.pipe(
    Schema.check(Schema.isBetween({ minimum: minimo, maximum: maximo })),
  );
const entero = (minimo: number, maximo: number) =>
  Schema.FiniteFromString.pipe(
    Schema.check(Schema.isInt(), Schema.isBetween({ minimum: minimo, maximum: maximo })),
  );

const leerLatitud = Schema.decodeUnknownResult(numero(-90, 90));
const leerLongitud = Schema.decodeUnknownResult(numero(-180, 180));
const leerRadio = Schema.decodeUnknownResult(entero(1, RADIO_MAXIMO));
const leerLimite = Schema.decodeUnknownResult(entero(1, LIMITE_MAXIMO));
const leerCompania = Schema.decodeUnknownResult(Compania);

const PARAMETROS = ["lat", "lon", "radio", "compania", "limite"] as const;
type Parametro = (typeof PARAMETROS)[number];
const ACEPTADOS = `${PARAMETROS.slice(0, -1).join(", ")} y ${PARAMETROS.at(-1) ?? ""}`;

const MENSAJES: Readonly<Record<Parametro, string>> = {
  lat: "lat tiene que ser la latitud en grados decimales, entre -90 y 90.",
  lon: "lon tiene que ser la longitud en grados decimales, entre -180 y 180.",
  radio: `radio tiene que ser un número entero de metros, de 1 a ${RADIO_MAXIMO}.`,
  compania: `compania tiene que ser una o varias de ${Compania.literals.join(", ")}, separadas por comas.`,
  limite: `limite tiene que ser un número entero de 1 a ${LIMITE_MAXIMO}.`,
};

const esParametro = (nombre: string): nombre is Parametro =>
  PARAMETROS.some((parametro) => parametro === nombre);

const falla = (mensaje: string) => Result.fail(new ConsultaNoValida({ mensaje }));

/**
 * El valor de un parámetro leído con su esquema, o el mensaje de ese parámetro. Uno vacío no vale:
 * `Number("")` es 0, y `lat=` sería el ecuador.
 */
const campo = <A, E>(
  parametro: Parametro,
  valor: string,
  leer: (valor: string) => Result.Result<A, E>,
): Result.Result<A, ConsultaNoValida> =>
  valor.trim() === ""
    ? falla(MENSAJES[parametro])
    : Result.mapError(leer(valor), () => new ConsultaNoValida({ mensaje: MENSAJES[parametro] }));

/** Las compañías de `compania=movistar,orange`, sin repetir y en el orden en que llegan. */
const companiasDe = (valor: string): Result.Result<ReadonlyArray<Compania>, ConsultaNoValida> => {
  const companias: Array<Compania> = [];
  for (const nombre of valor.split(",")) {
    const leida = campo("compania", nombre.trim().toLowerCase(), leerCompania);
    if (Result.isFailure(leida)) return Result.fail(leida.failure);
    if (!companias.includes(leida.success)) companias.push(leida.success);
  }
  return Result.succeed(companias);
};

/**
 * Lee la consulta de los parámetros de la URL. Rechaza los que no conoce y los repetidos, en lugar
 * de ignorarlos: una consulta con `radius` en vez de `radio` daría el radio por defecto sin avisar.
 */
export const leerConsulta = (
  parametros: URLSearchParams,
): Result.Result<Consulta, ConsultaNoValida> => {
  const valores = new Map<Parametro, string>();
  for (const [nombre, valor] of parametros) {
    if (!esParametro(nombre)) {
      return falla(`El parámetro «${nombre}» no existe. Se aceptan ${ACEPTADOS}.`);
    }
    if (valores.has(nombre)) {
      return falla(
        `El parámetro «${nombre}» va más de una vez. Para varias compañías, sepáralas con comas.`,
      );
    }
    valores.set(nombre, valor);
  }
  const lat = valores.get("lat");
  const lon = valores.get("lon");
  if (lat === undefined || lon === undefined) {
    return falla("Faltan lat y lon: el punto desde el que buscar, en grados decimales.");
  }
  const radio = valores.get("radio");
  const limite = valores.get("limite");
  const compania = valores.get("compania");
  return Result.all({
    latitud: campo("lat", lat, leerLatitud),
    longitud: campo("lon", lon, leerLongitud),
    radio:
      radio === undefined ? Result.succeed(RADIO_POR_DEFECTO) : campo("radio", radio, leerRadio),
    limite:
      limite === undefined
        ? Result.succeed(LIMITE_POR_DEFECTO)
        : campo("limite", limite, leerLimite),
    companias: compania === undefined ? Result.succeed([]) : companiasDe(compania),
  });
};
