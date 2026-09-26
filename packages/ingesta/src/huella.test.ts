import { assert, describe, it } from "@effect/vitest";

import { huella } from "./huella.ts";

describe("huella", () => {
  it("da los valores de referencia de FNV-1a de 64 bits", () => {
    assert.strictEqual(huella(""), "cbf29ce484222325");
    assert.strictEqual(huella("a"), "af63dc4c8601ec8c");
    assert.strictEqual(huella("foobar"), "85944171f73967e8");
  });

  it("cambia con un solo carácter distinto", () => {
    assert.notStrictEqual(huella('["0802532"],"7"'), huella('["0802532"],"73"'));
  });
});
