import { GroupSpec, Spec } from "@confect/core";
import datos from "../datos.spec";
import ingesta from "../ingesta.spec";

const spec: Spec.Spec<{
  readonly datos: GroupSpec.NamedAt<typeof datos, "datos">;
  readonly ingesta: GroupSpec.NamedAt<typeof ingesta, "ingesta">;
}> = Spec.make().addAt("datos", datos).addAt("ingesta", ingesta);

export default spec;
