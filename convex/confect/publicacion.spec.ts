import { ResultadoPublicacion } from "@celda/publicacion/publicar";
import { FunctionSpec, GroupSpec } from "@confect/core";

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
