import { Coordenada } from "@celda/dominio/area";
import type { Banda } from "@celda/dominio/banda";
import { Compania } from "@celda/dominio/compania";
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

/** El `robots.txt` de la fuente prohíbe esa ruta a Celda. */
export class ProhibidoPorRobots extends Schema.TaggedError<ProhibidoPorRobots>()(
  "ProhibidoPorRobots",
  { url: Schema.String },
) {}

/** La ejecución ha gastado todas las peticiones que tiene permitidas hacia la fuente. */
export class LimiteDePeticiones extends Schema.TaggedError<LimiteDePeticiones>()(
  "LimiteDePeticiones",
  { maximo: Schema.Int },
) {}

export type ErrorDeExtractor =
  | FuenteNoDisponible
  | RespuestaInesperada
  | ProhibidoPorRobots
  | LimiteDePeticiones;

/** Texto de un error para el estado de la ingesta. */
export const describirError = (error: ErrorDeExtractor): string => {
  switch (error._tag) {
    case "FuenteNoDisponible":
    case "RespuestaInesperada":
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
