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
export const RADIO_POR_DEFECTO_METROS = 1000;
/** Radio más grande que se acepta, en metros. */
export const RADIO_MAXIMO_METROS = 50_000;
/** Emplazamientos que se devuelven si la consulta no lo dice. */
export const LIMITE_POR_DEFECTO = 20;
/** Emplazamientos que se devuelven como mucho. */
export const LIMITE_MAXIMO = 50;

export interface Consulta {
  readonly latitud: number;
  readonly longitud: number;
  readonly radioMetros: number;
  /**
   * Si `radio` llegó sin unidad. Un número sin unidad son metros, pero un agente que pensaba en
   * kilómetros escribe `radio=15`: con eso y 0 resultados, la respuesta lo avisa (`cercanos.ts`).
   */
  readonly radioSinUnidad: boolean;
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

const leerLatitud = Schema.decodeUnknownResult(numero(-90, 90));
const leerLongitud = Schema.decodeUnknownResult(numero(-180, 180));
const leerLimite = Schema.decodeUnknownResult(
  Schema.FiniteFromString.pipe(
    Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: LIMITE_MAXIMO })),
  ),
);
const leerCompania = Schema.decodeUnknownResult(Compania);

const PARAMETROS = ["lat", "lon", "radio", "compania", "limite"] as const;
type Parametro = (typeof PARAMETROS)[number];
const ACEPTADOS = `${PARAMETROS.slice(0, -1).join(", ")} y ${PARAMETROS.at(-1) ?? ""}`;

const MENSAJES: Readonly<Record<Parametro, string>> = {
  lat: "lat tiene que ser la latitud en grados decimales, entre -90 y 90.",
  lon: "lon tiene que ser la longitud en grados decimales, entre -180 y 180.",
  radio: `radio tiene que ser una distancia en metros (1500) o con su unidad (1500m o 1.5km), de 1 m a ${RADIO_MAXIMO_METROS / 1000}km.`,
  compania: `compania tiene que ser una o varias de ${Compania.literals.join(", ")}, separadas por comas.`,
  limite: `limite tiene que ser un número entero de 1 a ${LIMITE_MAXIMO}.`,
};

/**
 * Los nombres que la gente y los agentes prueban antes de leer la documentación, con el parámetro
 * que buscaban. El error se lo dice, pero la consulta sigue sin aceptarlos.
 */
const PARECIDOS = new Map<string, Parametro>([
  ["latitud", "lat"],
  ["latitude", "lat"],
  ["lng", "lon"],
  ["long", "lon"],
  ["longitud", "lon"],
  ["longitude", "lon"],
  ["radius", "radio"],
  ["distancia", "radio"],
  ["companias", "compania"],
  ["compañia", "compania"],
  ["compañias", "compania"],
  ["company", "compania"],
  ["operador", "compania"],
  ["operator", "compania"],
  ["limit", "limite"],
]);

/** Lo que dice el error de un parámetro que no existe. */
const desconocido = (nombre: string): string => {
  const base = `El parámetro «${nombre}» no existe. Se aceptan ${ACEPTADOS}.`;
  if (nombre === "municipio" || nombre === "provincia") {
    return `${base} No hay filtro por ${nombre}: se busca alrededor de un punto, con lat y lon.`;
  }
  const parecido = PARECIDOS.get(nombre.toLowerCase());
  return parecido === undefined ? base : `${base} ¿Querías decir «${parecido}»?`;
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

const RADIO = /^(\d+(?:\.\d+)?) ?(m|km)?$/u;

/** El radio pedido, en metros enteros, y si llegó sin unidad. */
interface RadioLeido {
  readonly metros: number;
  readonly sinUnidad: boolean;
}

/**
 * El radio de `1500`, `1500m` o `1.5km`. Sin unidad son metros, como en la primera versión de la
 * API, para que las consultas ya escritas sigan valiendo.
 */
const radioDe = (valor: string): Result.Result<RadioLeido, ConsultaNoValida> => {
  const partes = RADIO.exec(valor.trim().toLowerCase());
  const cifra = Number(partes?.[1]);
  if (partes === null || !Number.isFinite(cifra)) return falla(MENSAJES.radio);
  const metros = Math.round(partes[2] === "km" ? cifra * 1000 : cifra);
  return metros >= 1 && metros <= RADIO_MAXIMO_METROS
    ? Result.succeed({ metros, sinUnidad: partes[2] === undefined })
    : falla(MENSAJES.radio);
};

const RADIO_POR_DEFECTO: RadioLeido = { metros: RADIO_POR_DEFECTO_METROS, sinUnidad: false };

/** Las compañías de `compania=movistar,orange`, sin repetir y en el orden en que llegan. */
const companiasDe = (valor: string): Result.Result<ReadonlyArray<Compania>, ConsultaNoValida> =>
  Result.map(
    Result.all(
      valor
        .split(",")
        .map((nombre) => campo("compania", nombre.trim().toLowerCase(), leerCompania)),
    ),
    (companias) => [...new Set(companias)],
  );

/**
 * Lee la consulta de los parámetros de la URL. Rechaza los que no conoce y los repetidos, en lugar
 * de ignorarlos: una consulta con `radius` en vez de `radio` daría el radio por defecto sin avisar.
 */
export const leerConsulta = (
  parametros: URLSearchParams,
): Result.Result<Consulta, ConsultaNoValida> => {
  const valores = new Map<Parametro, string>();
  for (const [nombre, valor] of parametros) {
    if (!esParametro(nombre)) return falla(desconocido(nombre));
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
  return Result.map(
    Result.all({
      latitud: campo("lat", lat, leerLatitud),
      longitud: campo("lon", lon, leerLongitud),
      radio: radio === undefined ? Result.succeed(RADIO_POR_DEFECTO) : radioDe(radio),
      limite:
        limite === undefined
          ? Result.succeed(LIMITE_POR_DEFECTO)
          : campo("limite", limite, leerLimite),
      companias: compania === undefined ? Result.succeed([]) : companiasDe(compania),
    }),
    ({ radio: { metros, sinUnidad }, ...resto }) => ({
      ...resto,
      radioMetros: metros,
      radioSinUnidad: sinUnidad,
    }),
  );
};
