// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { AlmacenDeCapas } from "@celda/convex/capas";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { almacenEnCarpeta } from "./almacen.ts";

const FICHERO = "sitios@2026-09-26T02:15:00Z.json";

/** El almacén sobre una carpeta temporal nueva, que se borra al acabar la prueba. */
const conCarpeta = <A, E>(
  prueba: (carpeta: string) => Effect.Effect<A, E, AlmacenDeCapas | FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const carpeta = path.join(yield* fs.makeTempDirectoryScoped(), "capas");
    return yield* prueba(carpeta).pipe(
      Effect.provide(almacenEnCarpeta({ carpeta, origen: "http://127.0.0.1:8852" })),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("almacén de capas en una carpeta", () => {
  it.effect("escribe el fichero una vez y lo da por guardado si llega igual", () =>
    conCarpeta((carpeta) =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeCapas;
        const fs = yield* FileSystem.FileSystem;
        assert.isTrue(yield* almacen.guardar(FICHERO, '{"version":"a"}'));
        assert.isFalse(yield* almacen.guardar(FICHERO, '{"version":"a"}'));
        assert.deepStrictEqual(yield* fs.readDirectory(carpeta), [FICHERO]);
        assert.strictEqual(almacen.url(FICHERO), `http://127.0.0.1:8852/${FICHERO}`);
      }),
    ),
  );

  it.effect("no pisa un fichero que ya existe con otro contenido", () =>
    conCarpeta((carpeta) =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeCapas;
        const fs = yield* FileSystem.FileSystem;
        yield* almacen.guardar(FICHERO, '{"version":"a"}');
        const fallo = yield* Effect.flip(almacen.guardar(FICHERO, '{"version":"b"}'));
        assert.strictEqual(fallo._tag, "CapaInmutable");
        assert.strictEqual(yield* fs.readFileString(`${carpeta}/${FICHERO}`), '{"version":"a"}');
      }),
    ),
  );
});
