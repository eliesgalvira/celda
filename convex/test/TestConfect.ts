import { TestConfect as TestConfect_ } from "@confect/test";

import convexSchema from "../confect/_generated/convexSchema";
import confectSchema from "../confect/_generated/schema";

export const TestConfect = TestConfect_.TestConfect<typeof confectSchema>();

/**
 * Convex en memoria (convex-test) con las funciones generadas. El glob de la documentación de
 * Confect no encuentra `convex/_generated` con Vite 8; este sí (exploración 02).
 */
export const layer = TestConfect_.layer(
  confectSchema,
  convexSchema,
  import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"]),
);
