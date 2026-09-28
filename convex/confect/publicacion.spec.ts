import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

/** Lo que ha hecho una publicación. */
export const Publicada = Schema.Struct({
  version: Schema.String,
  /** `al-dia` si el almacén ya tenía esa versión como vigente y no se ha escrito nada. */
  tipo: Schema.Literals(["publicada", "al-dia"]),
  emplazamientos: Schema.Int,
  lotes: Schema.Int,
  /** Ficheros escritos ahora, contando `vigente.json`. Cero si no ha cambiado nada. */
  escritos: Schema.Int,
  /** Tamaño de la capa y del mayor lote de fichas, sin comprimir. */
  bytesCapa: Schema.Int,
  bytesLoteMayor: Schema.Int,
  /** Suma de los lotes de fichas, sin comprimir. */
  bytesFichas: Schema.Int,
});
export type Publicada = typeof Publicada.Type;

/** Lo que ha pasado al publicar tras una ingesta. Nunca es un fallo: la ingesta ya ha terminado. */
export const ResultadoPublicacion = Schema.Union([
  Publicada,
  /** El despliegue no tiene almacén de ficheros configurado: no se publica nada. */
  Schema.Struct({ tipo: Schema.Literal("sin-almacen") }),
  /** La publicación ha fallado; la próxima ingesta la vuelve a intentar. */
  Schema.Struct({ tipo: Schema.Literal("fallida"), motivo: Schema.String }),
]);
export type ResultadoPublicacion = typeof ResultadoPublicacion.Type;

/**
 * Publicación: escribe la capa y las fichas de la instantánea actual en el almacén de ficheros.
 * Va en el runtime de Node, que tiene más memoria que el de Convex y deja escribir en una carpeta
 * local en desarrollo. La lanza la ingesta al acabar cada ejecución completada, y también se
 * puede lanzar a mano con `convex run publicacion:publicar`.
 */
export default GroupSpec.makeNode().addFunction(
  FunctionSpec.internalNodeAction({
    name: "publicar",
    returns: () => ResultadoPublicacion,
  }),
);
