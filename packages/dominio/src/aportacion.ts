import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Compania } from "./compania.ts";

/**
 * Las aportaciones son lo que la persona crea en su dispositivo. Se guardan con el mismo formato
 * que tendrán si algún día se comparten (ADR 0007): identificador, fecha de creación, versión del
 * esquema y origen, más el contenido de cada tipo. Cambiar el contenido de un tipo es subir su
 * versión y leer también la anterior.
 */

/**
 * Clave de un emplazamiento, como la publica la capa («movistar-0802532»), o de una corrección
 * publicada.
 */
const Clave = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120)));

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

/**
 * Lo que una corrección propuesta dice que cambia (ADR 0020). La nota opcional va aparte, en la
 * corrección propuesta: vale para los cuatro tipos.
 */
export const Cambio = Schema.Union([
  /** La posición del emplazamiento está mal: está en `posicion`. */
  Schema.Struct({ tipo: Schema.Literal("posicion"), posicion: Coordenada }),
  /** La compañía está en el emplazamiento (`esta`) o no está. */
  Schema.Struct({ tipo: Schema.Literal("compania"), compania: Compania, esta: Schema.Boolean }),
  /** El emplazamiento ya no existe. */
  Schema.Struct({ tipo: Schema.Literal("ya-no-existe") }),
  /** Falta un emplazamiento, en `posicion` y con esas compañías. */
  Schema.Struct({
    tipo: Schema.Literal("falta"),
    posicion: Coordenada,
    companias: Schema.Array(Compania).pipe(Schema.check(Schema.isMinLength(1), Schema.isUnique())),
  }),
]);
export type Cambio = typeof Cambio.Type;

export type TipoDeCambio = Cambio["tipo"];

/** Lo más largo que puede ser la nota de una corrección propuesta, en caracteres. */
export const LARGO_MAXIMO_NOTA = 500;

/** Una nota escrita por la persona: texto llano y corto, nunca una imagen. */
export const Nota = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(LARGO_MAXIMO_NOTA)),
);

/** Versión del esquema de la corrección propuesta. */
export const ESQUEMA_CORRECCION_PROPUESTA = 1;

/**
 * Aportación que contradice un dato del mapa. Lleva el emplazamiento que corrige salvo si falta
 * uno, que aún no tiene clave. Nunca cambia por sí sola lo publicado: antes la tiene que aceptar
 * la moderación (ADR 0020).
 */
export const CorreccionPropuesta = Schema.Struct({
  id: Schema.String.pipe(Schema.check(Schema.isUUID(4))),
  tipo: Schema.Literal("correccion-propuesta"),
  esquema: Schema.Literal(ESQUEMA_CORRECCION_PROPUESTA),
  creada: Schema.Int,
  /** Desde dónde se propuso: la ficha de un emplazamiento o el mapa, para uno que falta. */
  origen: Schema.Literals(["ficha", "mapa"]),
  emplazamiento: Schema.NullOr(Clave),
  cambio: Cambio,
  nota: Schema.NullOr(Nota),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (correccion) =>
        (correccion.cambio.tipo === "falta") === (correccion.emplazamiento === null) ||
        "solo una corrección de un emplazamiento que falta va sin emplazamiento",
    ),
  ),
);
export type CorreccionPropuesta = typeof CorreccionPropuesta.Type;

/** Versión del esquema de la corroboración. */
export const ESQUEMA_CORROBORACION = 1;

/**
 * Aportación que respalda una corrección que la ficha ya enseña («yo también lo veo»): suma una
 * persona a las que la sostienen, si la moderación la acepta.
 */
export const Corroboracion = Schema.Struct({
  id: Schema.String.pipe(Schema.check(Schema.isUUID(4))),
  tipo: Schema.Literal("corroboracion"),
  esquema: Schema.Literal(ESQUEMA_CORROBORACION),
  creada: Schema.Int,
  origen: Schema.Literal("ficha"),
  emplazamiento: Clave,
  /** La clave de la corrección publicada que respalda (`CorreccionDeFicha.clave`). */
  correccion: Clave,
});
export type Corroboracion = typeof Corroboracion.Type;

/** Toda aportación que se guarda en el dispositivo. */
export const Aportacion = Schema.Union([PuntoElegido, CorreccionPropuesta, Corroboracion]);
export type Aportacion = typeof Aportacion.Type;

export type TipoAportacion = Aportacion["tipo"];

/**
 * Lo que se puede compartir: la corrección propuesta y la corroboración. El punto elegido nunca
 * sale del dispositivo (ADR 0007).
 */
export const AportacionCompartible = Schema.Union([CorreccionPropuesta, Corroboracion]);
export type AportacionCompartible = typeof AportacionCompartible.Type;

export type TipoCompartible = AportacionCompartible["tipo"];

export const TIPOS_COMPARTIBLES = [
  "correccion-propuesta",
  "corroboracion",
] as const satisfies ReadonlyArray<TipoCompartible>;

/** Si la aportación se puede compartir. */
export const esCompartible = (aportacion: Aportacion): aportacion is AportacionCompartible =>
  aportacion.tipo !== "punto-elegido";

type SinSobre<A> = A extends Aportacion ? Omit<A, "id" | "creada"> : never;

/** Lo que pone quien crea una aportación; el almacén añade el identificador y la fecha. */
export type ContenidoAportacion = SinSobre<Aportacion>;
