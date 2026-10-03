import { GroupSpec, Spec } from "@confect/core";
import buzon from "../buzon.spec";
import limpieza from "../limpieza.spec";
import moderacion from "../moderacion.spec";

const spec: Spec.Spec<{
  readonly buzon: GroupSpec.NamedAt<typeof buzon, "buzon">;
  readonly limpieza: GroupSpec.NamedAt<typeof limpieza, "limpieza">;
  readonly moderacion: GroupSpec.NamedAt<typeof moderacion, "moderacion">;
}> = Spec.make().addAt("buzon", buzon).addAt("limpieza", limpieza).addAt("moderacion", moderacion);

export default spec;
