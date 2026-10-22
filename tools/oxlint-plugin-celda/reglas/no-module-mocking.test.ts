import { describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../pruebas/arnes.ts";

/**
 * La regla copiada de `anti-slop`, con el cambio de Celda: reconoce también el `vi` de
 * `@effect/vitest`, que es de donde lo importan las pruebas de Celda.
 */
const regla = createOxlintRuleHarness("anti-slop/no-module-mocking");

describe("anti-slop/no-module-mocking", () => {
  regla.valid(
    "deja usar el resto de `vi`",
    `
      import { vi } from "@effect/vitest";

      export const espia = vi.fn();
    `,
  );

  regla.invalid(
    "rechaza `vi.mock` con el `vi` de @effect/vitest",
    `
      import { vi } from "@effect/vitest";

      vi.mock("./servicio.ts");
    `,
  );

  regla.invalid(
    "rechaza `vi.doMock` con el `vi` de vitest",
    `
      import { vi } from "vitest";

      vi.doMock("./servicio.ts");
    `,
  );
});
