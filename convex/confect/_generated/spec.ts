import { GroupSpec, Spec } from "@confect/core";
import capas from "../capas.spec";
import datos from "../datos.spec";
import ingesta from "../ingesta.spec";

const spec: Spec.Spec<{
  readonly capas: GroupSpec.NamedAt<typeof capas, "capas">;
  readonly datos: GroupSpec.NamedAt<typeof datos, "datos">;
  readonly ingesta: GroupSpec.NamedAt<typeof ingesta, "ingesta">;
}> = Spec.make().addAt("capas", capas).addAt("datos", datos).addAt("ingesta", ingesta);

export default spec;
