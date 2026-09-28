// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { almacenEnCarpeta } from "../src/almacenes/carpeta";
import { AlmacenDeFicheros } from "../src/publicacion";

const FICHERO = "sitios@2026-09-26T02:15:00Z.json";
const LOTE = "fichas@2026-09-26T02:15:00Z/0.json";

/** El almacén sobre una carpeta temporal nueva, que se borra al acabar la prueba. */
const conCarpeta = <A, E>(
  prueba: (
    carpeta: string,
  ) => Effect.Effect<A, E, AlmacenDeFicheros | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const carpeta = path.join(yield* fs.makeTempDirectoryScoped(), "capas");
    return yield* prueba(carpeta).pipe(
      Effect.provide(almacenEnCarpeta({ carpeta, origen: "http://127.0.0.1:8852" })),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("almacén de ficheros en una carpeta", () => {
  it.effect("escribe el fichero una vez y lo da por guardado si llega igual", () =>
    conCarpeta((carpeta) =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeFicheros;
        const fs = yield* FileSystem.FileSystem;
        assert.isTrue(yield* almacen.guardar(FICHERO, '{"version":"a"}'));
        assert.isFalse(yield* almacen.guardar(FICHERO, '{"version":"a"}'));
        assert.deepStrictEqual(yield* fs.readDirectory(carpeta), [FICHERO]);
        assert.strictEqual(almacen.url(FICHERO), `http://127.0.0.1:8852/${FICHERO}`);
      }),
    ),
  );

  it.effect("crea la carpeta de las fichas y lee lo guardado", () =>
    conCarpeta(() =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeFicheros;
        assert.isTrue(Option.isNone(yield* almacen.leer(LOTE)));
        assert.isTrue(yield* almacen.guardar(LOTE, '{"version":"a","lote":0}'));
        assert.deepStrictEqual(yield* almacen.leer(LOTE), Option.some('{"version":"a","lote":0}'));
      }),
    ),
  );

  it.effect("no pisa un fichero que ya existe con otro contenido", () =>
    conCarpeta((carpeta) =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeFicheros;
        const fs = yield* FileSystem.FileSystem;
        yield* almacen.guardar(FICHERO, '{"version":"a"}');
        const fallo = yield* Effect.flip(almacen.guardar(FICHERO, '{"version":"b"}'));
        assert.strictEqual(fallo._tag, "FicheroInmutable");
        assert.strictEqual(yield* fs.readFileString(`${carpeta}/${FICHERO}`), '{"version":"a"}');
      }),
    ),
  );

  it.effect("vigente.json es el único que se sustituye", () =>
    conCarpeta((carpeta) =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeFicheros;
        const fs = yield* FileSystem.FileSystem;
        yield* almacen.cambiarVigente('{"version":"a"}');
        yield* almacen.cambiarVigente('{"version":"b"}');
        assert.deepStrictEqual(yield* almacen.leer("vigente.json"), Option.some('{"version":"b"}'));
        // Sin temporales a medias.
        assert.deepStrictEqual(yield* fs.readDirectory(carpeta), ["vigente.json"]);
      }),
    ),
  );

  it.effect("lista los ficheros con su ruta y borra la carpeta de lotes con el último", () =>
    conCarpeta((carpeta) =>
      Effect.gen(function* () {
        const almacen = yield* AlmacenDeFicheros;
        const fs = yield* FileSystem.FileSystem;
        assert.deepStrictEqual(yield* almacen.listar, []);
        const otroLote = "fichas@2026-09-26T02:15:00Z/1.json";
        yield* almacen.guardar(FICHERO, "{}");
        yield* almacen.guardar(LOTE, "{}");
        yield* almacen.guardar(otroLote, "{}");
        yield* almacen.cambiarVigente("{}");
        assert.sameMembers([...(yield* almacen.listar)], [FICHERO, LOTE, otroLote, "vigente.json"]);

        yield* almacen.borrar(LOTE);
        assert.sameMembers(yield* fs.readDirectory(carpeta), [
          FICHERO,
          "fichas@2026-09-26T02:15:00Z",
          "vigente.json",
        ]);
        yield* almacen.borrar(otroLote);
        yield* almacen.borrar(otroLote);
        yield* almacen.borrar(FICHERO);
        assert.deepStrictEqual(yield* fs.readDirectory(carpeta), ["vigente.json"]);
      }),
    ),
  );
});
