import { Coordenada } from "@celda/dominio/area";
import type { Banda } from "@celda/dominio/banda";
import type { Caja } from "@celda/dominio/barrido";
import { Compania } from "@celda/dominio/compania";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";
import type { Fuente } from "@celda/dominio/observacion";
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

/** Lo que se lee de la ficha de una estación base. */
export interface FichaLeida {
  readonly bandas: ReadonlyArray<Banda>;
  /** Las medidas de exposición del ministerio, quizá ninguna. */
  readonly medidasDeExposicion: ReadonlyArray<MedidaDeExposicion>;
}

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
 * oficial. Qué cajas se piden lo decide el barrido por zonas (`barrido.ts`). Cada instancia vive
 * lo que dura una ejecución: su límite de peticiones cuenta desde que se construye la capa.
 */
export class ExtractorPorCajas extends Context.Service<
  ExtractorPorCajas,
  {
    readonly fuente: Fuente;
    /** El listado de una caja, bordes incluidos. */
    readonly caja: (caja: Caja) => Effect.Effect<ListadoDeCaja, ErrorDeExtractor>;
    /** Lee la ficha de un registro. */
    readonly ficha: (registro: Registro) => Effect.Effect<FichaLeida, ErrorDeExtractor>;
    /** Peticiones hechas a la fuente desde que se construyó, con los reintentos. */
    readonly peticiones: Effect.Effect<number>;
  }
>()("@celda/ingesta/extractor/ExtractorPorCajas") {}
