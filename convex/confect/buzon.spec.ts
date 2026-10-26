import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * El buzón de las aportaciones compartidas (ADR 0020): las únicas funciones públicas de Celda.
 * Una pide la identidad del dispositivo y las otras dos envían una corrección propuesta o una
 * corroboración. Ninguna devuelve aportaciones: lo que una persona ha enviado lo
 * sabe su dispositivo (ADR 0007), y lo aceptado lo publica la ingesta nocturna.
 */

/**
 * El buzón no está abierto: el despliegue no tiene la clave `CELDA_BUZON_CLAVE`. La aportación
 * se queda en el dispositivo para enviarla más tarde.
 */
export class BuzonCerrado extends Schema.TaggedError<BuzonCerrado>()("BuzonCerrado", {}) {}

/**
 * El token de identidad no es de este buzón: está mal formado, su firma no cuadra o la identidad
 * ya no existe. El dispositivo pide otra.
 */
export class IdentidadNoValida extends Schema.TaggedError<IdentidadNoValida>()(
  "IdentidadNoValida",
  {},
) {}

/** La moderación ha vetado la identidad del dispositivo o la red desde la que envía. */
export class Vetada extends Schema.TaggedError<Vetada>()("Vetada", {
  que: Schema.Literals(["identidad", "ip"]),
}) {}

/** La aportación no cumple el esquema o no es verosímil; `motivo` dice por qué. */
export class AportacionNoValida extends Schema.TaggedError<AportacionNoValida>()(
  "AportacionNoValida",
  { motivo: Schema.String },
) {}

/** Dónde se ha llegado al límite: el del dispositivo, el de su red o el de todo el buzón. */
export const AmbitoDeLimite = Schema.Literals(["dispositivo", "ip", "total"]);
export type AmbitoDeLimite = typeof AmbitoDeLimite.Type;

/**
 * Se ha pasado un límite de cubo de fichas. `reintentarEn` son los milisegundos que faltan para
 * que haya otra ficha, contados desde que llega el error, para no depender del reloj del
 * dispositivo. En los del buzón entero lleva hasta 30 s de más, para que no vuelvan todos a la vez.
 */
export class LimiteAlcanzado extends Schema.TaggedError<LimiteAlcanzado>()("LimiteAlcanzado", {
  limite: Schema.String,
  ambito: AmbitoDeLimite,
  reintentarEn: Schema.Finite,
}) {}

/**
 * Los errores de un envío. Todos llegan tipados al cliente; un fallo de red o un despliegue
 * apagado por sus umbrales llegan como errores de Convex sin tipo.
 */
export const ErrorDeEnvio = Schema.Union([
  BuzonCerrado,
  IdentidadNoValida,
  Vetada,
  AportacionNoValida,
  LimiteAlcanzado,
]);
export type ErrorDeEnvio = typeof ErrorDeEnvio.Type;

export const ErrorDeIdentidad = Schema.Union([BuzonCerrado, Vetada, LimiteAlcanzado]);
export type ErrorDeIdentidad = typeof ErrorDeIdentidad.Type;

/*
 * Las formas que acepta Convex en los argumentos: la estructura de cada aportación, con sus tipos
 * pero sin sus comprobaciones. Convex rechaza un campo de más o de otro tipo antes de llamar a la
 * función; los UUID, las compañías y los largos los comprueba la función con los esquemas del
 * dominio, para dar `AportacionNoValida` en lugar de un error sin tipo. Ninguna forma tiene un
 * campo de bytes ni de fichero: no hay por dónde mandar una imagen.
 */

const FormaCoordenada = Schema.Struct({ longitud: Schema.Number, latitud: Schema.Number });

const FormaEncabezado = {
  id: Schema.String,
  esquema: Schema.Number,
  creada: Schema.Number,
  origen: Schema.String,
};

export const FormaCorreccion = Schema.Struct({
  ...FormaEncabezado,
  tipo: Schema.Literal("correccion-propuesta"),
  emplazamiento: Schema.NullOr(Schema.String),
  cambio: Schema.Union([
    Schema.Struct({ tipo: Schema.Literal("posicion"), posicion: FormaCoordenada }),
    Schema.Struct({
      tipo: Schema.Literal("compania"),
      compania: Schema.String,
      esta: Schema.Boolean,
    }),
    Schema.Struct({ tipo: Schema.Literal("ya-no-existe") }),
    Schema.Struct({
      tipo: Schema.Literal("falta"),
      posicion: FormaCoordenada,
      companias: Schema.Array(Schema.String),
    }),
  ]),
  nota: Schema.NullOr(Schema.String),
});

export const FormaCorroboracion = Schema.Struct({
  ...FormaEncabezado,
  tipo: Schema.Literal("corroboracion"),
  emplazamiento: Schema.String,
  correccion: Schema.String,
});

/** Lo que devuelve un envío: si la aportación es nueva o ya estaba en el buzón. */
export const Recibida = Schema.Struct({ nueva: Schema.Boolean });

export default GroupSpec.make()
  .addFunction(
    /**
     * Una identidad nueva para el dispositivo, como token firmado. Limitada por IP: unas 100 al
     * día desde la misma red.
     */
    FunctionSpec.publicMutation({
      name: "pedirIdentidad",
      returns: () => Schema.Struct({ identidad: Schema.String }),
      error: () => ErrorDeIdentidad,
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "enviarCorreccion",
      args: () => ({ identidad: Schema.String, correccion: FormaCorreccion }),
      returns: () => Recibida,
      error: () => ErrorDeEnvio,
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "enviarCorroboracion",
      args: () => ({ identidad: Schema.String, corroboracion: FormaCorroboracion }),
      returns: () => Recibida,
      error: () => ErrorDeEnvio,
    }),
  );
