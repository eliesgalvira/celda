import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";

/**
 * Las aportaciones son lo que la persona crea en su dispositivo. Se guardan con el mismo formato
 * que tendrán si algún día se comparten (ADR 0007): identificador, fecha de creación, versión del
 * esquema y origen, más el contenido de cada tipo. Cambiar el contenido de un tipo es subir su
 * versión y leer también la anterior.
 */

/** Cómo se marcó un punto elegido: en el mapa (clic, arrastre o pin central) o con una dirección. */
export const OrigenPunto = Schema.Literals(["mapa", "busqueda"]);
export type OrigenPunto = typeof OrigenPunto.Type;

/** Versión del esquema del punto elegido. */
export const ESQUEMA_PUNTO_ELEGIDO = 1;

/** Un punto de referencia marcado a mano. Se guarda uno como mucho: elegir otro lo sustituye. */
export const PuntoElegido = Schema.Struct({
  /** UUID v4 creado en el dispositivo. Al compartirse, será la clave idempotente. */
  id: Schema.String.pipe(Schema.check(Schema.isUUID(4))),
  tipo: Schema.Literal("punto-elegido"),
  esquema: Schema.Literal(ESQUEMA_PUNTO_ELEGIDO),
  /** Cuándo se creó, en milisegundos desde 1970. */
  creada: Schema.Int,
  origen: OrigenPunto,
  posicion: Coordenada,
});
export type PuntoElegido = typeof PuntoElegido.Type;

/** Toda aportación que se guarda en el dispositivo. Las medidas y correcciones vendrán aquí. */
export const Aportacion = Schema.Union([PuntoElegido]);
export type Aportacion = typeof Aportacion.Type;

export type TipoAportacion = Aportacion["tipo"];

type SinSobre<A> = A extends Aportacion ? Omit<A, "id" | "creada"> : never;

/** Lo que pone quien crea una aportación; el almacén añade el identificador y la fecha. */
export type ContenidoAportacion = SinSobre<Aportacion>;
