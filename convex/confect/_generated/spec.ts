import { GroupSpec, Spec } from "@confect/core";
import capas from "../capas.spec";
import datos from "../datos.spec";
import ingesta from "../ingesta.spec";
import publicacion from "../publicacion.spec";

const spec: Spec.Spec<{
  readonly capas: GroupSpec.NamedAt<typeof capas, "capas">;
  readonly datos: GroupSpec.NamedAt<typeof datos, "datos">;
  readonly ingesta: GroupSpec.NamedAt<typeof ingesta, "ingesta">;
  readonly publicacion: GroupSpec.NamedAt<typeof publicacion, "publicacion">;
}> = Spec.make().addAt("capas", capas).addAt("datos", datos).addAt("ingesta", ingesta).addAt("publicacion", publicacion);

export default spec;
