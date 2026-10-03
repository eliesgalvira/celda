import { Coordenada } from "@celda/dominio/area";
import type { Banda } from "@celda/dominio/banda";
import type { Caja } from "@celda/dominio/barrido";
import { Compania } from "@celda/dominio/compania";
import { Afirmacion, type Fuente } from "@celda/dominio/observacion";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Una estación base tal como sale del listado de una fuente, antes de leer su ficha. */
export const Registro = Schema.Struct({
  clave: Schema.String,
  compania: Compania,
  codigo: Schema.String,
  posicion: Coordenada,
  direccion: Schema.String,
  municipio: Schema.String,
  url: Schema.String,
});
export type Registro = typeof Registro.Type;

/** Resultado de recorrer el listado entero de una fuente. */
export interface Listado {
  readonly registros: ReadonlyArray<Registro>;
  /** Elementos que no se han podido leer, con el motivo. No paran la ejecución. */
  readonly avisos: ReadonlyArray<string>;
}

/** La fuente no ha respondido bien ni después de los reintentos. */
export class FuenteNoDisponible extends Schema.TaggedError<FuenteNoDisponible>()(
  "FuenteNoDisponible",
  { url: Schema.String, motivo: Schema.String },
) {}

/** La fuente ha respondido algo que el extractor no sabe leer. */
export class RespuestaInesperada extends Schema.TaggedError<RespuestaInesperada>()(
  "RespuestaInesperada",
  { url: Schema.String, motivo: Schema.String },
) {}

/**
 * El registro oficial no tiene ficha de la estación base, aunque su listado la incluya: su
 * página de detalle dice «Código de emplazamiento no válido». La estación base queda sin ficha en
 * el registro, y la ficha se vuelve a pedir con la espera de siempre por si el ministerio lo
 * arregla.
 */
export class SinFichaEnElRegistro extends Schema.TaggedError<SinFichaEnElRegistro>()(
  "SinFichaEnElRegistro",
  { url: Schema.String, motivo: Schema.String },
) {}

/** El `robots.txt` de la fuente prohíbe esa ruta a Celda. */
export class ProhibidoPorRobots extends Schema.TaggedError<ProhibidoPorRobots>()(
  "ProhibidoPorRobots",
  { url: Schema.String },
) {}

/**
 * La fuente está bloqueando a Celda: responde 401 o 403, o devuelve una página que no es lo que
 * se ha pedido, como un aviso de un cortafuegos. No se insiste: se deja de pedir hasta la noche
 * siguiente.
 */
export class FuenteBloqueada extends Schema.TaggedError<FuenteBloqueada>()("FuenteBloqueada", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

/**
 * La fuente pide que se espere: un 429, o un 503 con `Retry-After`. Si pide poco, el cliente
 * espera lo que pide y repite; si pide más, no lo dice o sigue pidiéndolo tras los reintentos,
 * no se insiste: se deja de pedir hasta la noche siguiente.
 */
export class FuentePideEsperar extends Schema.TaggedError<FuentePideEsperar>()(
  "FuentePideEsperar",
  { url: Schema.String, motivo: Schema.String },
) {}

/** La ejecución ha gastado todas las peticiones que tiene permitidas hacia la fuente. */
export class LimiteDePeticiones extends Schema.TaggedError<LimiteDePeticiones>()(
  "LimiteDePeticiones",
  { maximo: Schema.Int },
) {}

export type ErrorDeExtractor =
  | FuenteNoDisponible
  | FuenteBloqueada
  | FuentePideEsperar
  | RespuestaInesperada
  | SinFichaEnElRegistro
  | ProhibidoPorRobots
  | LimiteDePeticiones;

/** Texto de un error para el estado de la ingesta. */
export const describirError = (error: ErrorDeExtractor): string => {
  switch (error._tag) {
    case "FuenteNoDisponible":
    case "FuenteBloqueada":
    case "FuentePideEsperar":
    case "RespuestaInesperada":
    case "SinFichaEnElRegistro":
      return `${error._tag}: ${error.motivo} (${error.url})`;
    case "ProhibidoPorRobots":
      return `${error._tag}: ${error.url}`;
    case "LimiteDePeticiones":
      return `${error._tag}: ${error.maximo} peticiones`;
  }
};

/**
 * Parte de la ingesta que lee una sola fuente. Cada instancia vive lo que dura una ejecución:
 * su límite de peticiones cuenta desde que se construye la capa.
 */
export class Extractor extends Context.Service<
  Extractor,
  {
    readonly fuente: Fuente;
    /** Recorre el listado completo. Si falla, la ejecución no sabe qué ha desaparecido. */
    readonly listado: Effect.Effect<Listado, ErrorDeExtractor>;
    /** Lee las bandas de la ficha de un registro. */
    readonly ficha: (registro: Registro) => Effect.Effect<ReadonlyArray<Banda>, ErrorDeExtractor>;
  }
>()("@celda/ingesta/extractor") {}

/** Lo que devuelve una fuente al pedirle el listado de una caja, en una sola petición. */
export interface ListadoDeCaja {
  /** Sin repetir y ordenados por clave. */
  readonly registros: ReadonlyArray<Registro>;
  readonly avisos: ReadonlyArray<string>;
  /**
   * Si la respuesta llega al tope de elementos de la fuente. Entonces le pueden faltar
   * registros sin que la fuente avise, y la caja hay que dividirla.
   */
  readonly enElTope: boolean;
  /** Bytes de la respuesta. */
  readonly bytes: number;
}

/**
 * Extractor de una fuente cuyo listado se pide por cajas y corta en un tope, como el registro
 * oficial. Qué cajas se piden lo decide el barrido por zonas (`barrido.ts`). Igual que
 * `Extractor`, vive lo que dura una ejecución.
 */
export class ExtractorPorCajas extends Context.Service<
  ExtractorPorCajas,
  {
    readonly fuente: Fuente;
    /** El listado de una caja, bordes incluidos. */
    readonly caja: (caja: Caja) => Effect.Effect<ListadoDeCaja, ErrorDeExtractor>;
    /** Lee las bandas de la ficha de un registro. */
    readonly ficha: (registro: Registro) => Effect.Effect<ReadonlyArray<Banda>, ErrorDeExtractor>;
    /** Peticiones hechas a la fuente desde que se construyó, con los reintentos. */
    readonly peticiones: Effect.Effect<number>;
  }
>()("@celda/ingesta/extractor/ExtractorPorCajas") {}

/**
 * Un punto del listado de una fuente que agrupa estaciones base, como un marcador de
 * antenasmoviles.es. El listado solo da los códigos y la posición; lo demás está en su detalle.
 */
export const Punto = Schema.Struct({
  /** Los códigos del punto, ordenados y separados por comas. */
  clave: Schema.String,
  codigos: Schema.Array(Schema.String),
  posicion: Coordenada,
  /** Huella de lo que dice el listado del punto: si cambia, hay que volver a leer su detalle. */
  huella: Schema.String,
  /** Orden de lectura del detalle entre los pendientes: 0 antes que 1. */
  prioridad: Schema.Int,
});
export type Punto = typeof Punto.Type;

/** Los puntos de la zona en el listado de una fuente. */
export interface ListadoDePuntos {
  readonly puntos: ReadonlyArray<Punto>;
  /** Filas que no se han podido leer, con el motivo. No paran la ejecución. */
  readonly avisos: ReadonlyArray<string>;
}

/** Una observación que sale del detalle de un punto: una estación base y lo que dice de ella. */
export const ObservacionDePunto = Schema.Struct({
  ...Registro.fields,
  afirma: Afirmacion,
});
export type ObservacionDePunto = typeof ObservacionDePunto.Type;

/** Lo que dice el detalle de un punto. */
export interface DetalleDePunto {
  readonly observaciones: ReadonlyArray<ObservacionDePunto>;
  readonly avisos: ReadonlyArray<string>;
}

/**
 * Extractor de una fuente que lista puntos y da el detalle de cada uno aparte, como
 * antenasmoviles.es. Igual que `Extractor`, vive lo que dura una ejecución.
 */
export class ExtractorDePuntos extends Context.Service<
  ExtractorDePuntos,
  {
    readonly fuente: Fuente;
    /** Los puntos de la zona. Si falla, la ejecución no sabe qué ha desaparecido. */
    readonly puntos: Effect.Effect<ListadoDePuntos, ErrorDeExtractor>;
    /** Las observaciones del detalle de un punto. */
    readonly detalle: (punto: Punto) => Effect.Effect<DetalleDePunto, ErrorDeExtractor>;
  }
>()("@celda/ingesta/extractor/ExtractorDePuntos") {}
