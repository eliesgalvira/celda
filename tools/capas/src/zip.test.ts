import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { zipDe } from "./pruebas.ts";
import { entradasDelZip, leerEntrada } from "./zip.ts";

describe("lectura de un ZIP", () => {
  it.effect("lista sus entradas y descomprime cada una", () =>
    Effect.gen(function* () {
      const zip = yield* zipDe([
        ["readme.txt", "Límites"],
        ["au_AdministrativeUnit_4thOrder0.gml", "<gml>".repeat(1000)],
      ]);
      const entradas = Result.getOrThrow(entradasDelZip(zip));
      assert.deepStrictEqual(
        entradas.map((e) => [e.nombre, e.descomprimido]),
        [
          ["readme.txt", 8],
          ["au_AdministrativeUnit_4thOrder0.gml", 5000],
        ],
      );
      const [readme, gml] = entradas;
      if (readme === undefined || gml === undefined) return;
      assert.strictEqual(new TextDecoder().decode(yield* leerEntrada(zip, readme)), "Límites");
      assert.isBelow(gml.comprimido, 100);
      assert.strictEqual(new TextDecoder().decode(yield* leerEntrada(zip, gml)).length, 5000);
    }),
  );

  it("un fichero que no es un ZIP falla con ZipIlegible", () => {
    const leido = entradasDelZip(new TextEncoder().encode("<html>404</html>".repeat(4)));
    assert.isTrue(Result.isFailure(leido));
    if (Result.isFailure(leido)) assert.strictEqual(leido.failure._tag, "ZipIlegible");
  });
});
