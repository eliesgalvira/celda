// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { atender } from "./protocolo.ts";
import { ficheroDeReferencia } from "./referencias.ts";
import { SIMULACIONES } from "./registro.ts";
import { mallaDeRumbos } from "./simulacion.ts";

describe("registro de simulaciones", () => {
  it("no repite identificadores", () => {
    const ids = SIMULACIONES.map((s) => s.id);
    assert.deepStrictEqual(ids, [...new Set(ids)]);
  });

  it.effect("cada simulación registrada tiene el fichero de referencia de su versión", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const faltan = yield* Effect.filter(SIMULACIONES, (s) =>
        Effect.map(
          Effect.flatMap(ficheroDeReferencia(s.id, s.version), (ruta) => fs.exists(ruta)),
          (existe) => !existe,
        ),
      );
      assert.deepStrictEqual(
        faltan.map((s) => `${s.id}@${s.version}`),
        [],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("atender no calcula una simulación que no está o con otra versión", () => {
    const malla = mallaDeRumbos(90);
    const params = { azimuts: [0], anchoHazGrados: 65, atenuacionMaximaDb: 30 };
    const desconocida = atender(SIMULACIONES, {
      numero: 1,
      simulacion: "no-existe",
      version: "1",
      params,
      malla,
    });
    const otraVersion = atender(SIMULACIONES, {
      numero: 2,
      simulacion: "diagrama-sector",
      version: "0",
      params,
      malla,
    });
    const malos = atender(SIMULACIONES, {
      numero: 3,
      simulacion: "diagrama-sector",
      version: "1",
      params: { azimuts: [] },
      malla,
    });
    assert.deepStrictEqual(
      [desconocida, otraVersion, malos].map((r) => [r.numero, r.tipo]),
      [
        [1, "fallo"],
        [2, "fallo"],
        [3, "fallo"],
      ],
    );
  });
});
