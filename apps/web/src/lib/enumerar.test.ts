import { assert, describe, it } from "@effect/vitest";

import { enumerar } from "./enumerar.ts";

describe("enumerar", () => {
  it("enumera los nombres como se dicen", () => {
    assert.strictEqual(enumerar([]), "");
    assert.strictEqual(enumerar(["Girona"]), "Girona");
    assert.strictEqual(enumerar(["Barcelona", "Girona"]), "Barcelona y Girona");
    assert.strictEqual(enumerar(["Barcelona", "Girona", "Lleida"]), "Barcelona, Girona y Lleida");
  });
});
