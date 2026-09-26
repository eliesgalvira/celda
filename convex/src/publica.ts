import { Refs, Spec } from "@confect/core";

import datos from "../confect/datos.spec";

/**
 * Las referencias a las funciones públicas que lee la web. Solo el grupo `datos`: la spec entera
 * arrastraría al navegador los esquemas de la ingesta y sus extractores.
 */
export const refsPublicas = Refs.make(Spec.make().addAt("datos", datos));
