import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../pruebas/arnes.ts";

const rule = createOxlintRuleHarness("celda/no-effect-error-swallow");

describe("celda/no-effect-error-swallow", () => {
  rule.valid(
    "allows catches that recover with meaning",
    `
      import * as Effect from "effect/Effect";

      export const programa = Effect.fail("boom").pipe(
        Effect.catchTag("boom", (error) => Effect.logWarning("fallo recuperable", error)),
        Effect.catchCause((causa) => Effect.logError("causa inesperada", causa)),
      );
    `,
  );

  rule.valid(
    "allows Effect.void as a value outside catch handlers",
    `
      import * as Effect from "effect/Effect";

      export const nada = Effect.void;
      export const tras = Effect.succeed(1).pipe(Effect.andThen(() => Effect.void));
    `,
  );

  rule.invalid(
    "reports Effect.ignore in a pipe",
    `
      import * as Effect from "effect/Effect";

      export const programa = Effect.fail("boom").pipe(Effect.ignore);
    `,
    (output) => {
      assert.match(output, /erases the failure without a trace/);
    },
  );

  rule.invalid(
    "reports Effect.ignoreCause calls",
    `
      import * as Effect from "effect/Effect";

      export const programa = Effect.ignoreCause(Effect.fail("boom"));
    `,
  );

  rule.invalid(
    "reports a catch handler returning Effect.void",
    `
      import * as Effect from "effect/Effect";

      export const programa = Effect.fail("boom").pipe(
        Effect.catchTag("boom", () => Effect.void),
      );
    `,
    (output) => {
      assert.match(output, /disappears silently/);
    },
  );

  rule.invalid(
    "reports a block-bodied handler whose only statement returns Effect.void",
    `
      import * as Effect from "effect/Effect";

      export const programa = Effect.fail("boom").pipe(
        Effect.catchCause(() => {
          return Effect.void;
        }),
      );
    `,
  );

  rule.invalid(
    "reports Effect.void handlers inside catchTags objects",
    `
      import * as Effect from "effect/Effect";

      export const programa = Effect.fail("boom").pipe(
        Effect.catchTags({
          boom: () => Effect.void,
        }),
      );
    `,
  );
});
