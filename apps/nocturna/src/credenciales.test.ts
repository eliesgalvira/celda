// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { almacenDesdeConfig } from "@celda/publicacion/configuracion";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";

import { credencialesDeSystemd } from "./credenciales.ts";

/** La configuración como la monta el programa: el entorno y, detrás, las credenciales. */
const configuracionCon = (env: Record<string, string>) =>
  ConfigProvider.layerAdd(credencialesDeSystemd).pipe(
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    Layer.provideMerge(NodeServices.layer),
  );

/** Un directorio de credenciales como el que monta systemd, con un fichero por credencial. */
const directorioDeCredenciales = (ficheros: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directorio = yield* fs.makeTempDirectoryScoped({ prefix: "celda-credenciales-" });
    for (const [nombre, contenido] of Object.entries(ficheros)) {
      yield* fs.writeFileString(path.join(directorio, nombre), contenido);
    }
    return directorio;
  }).pipe(Effect.provide(NodeServices.layer));

describe("credenciales de systemd", () => {
  it.effect("cada fichero del directorio de credenciales llega a la configuración", () =>
    Effect.gen(function* () {
      const directorio = yield* directorioDeCredenciales({
        r2: [
          "CELDA_R2_CUENTA=cuenta",
          "CELDA_R2_CUBO=celda",
          "CELDA_R2_ID_CLAVE=clave",
          "CELDA_R2_SECRETO=secreto",
        ].join("\n"),
        vercel: "CELDA_VERCEL_DEPLOY_HOOK=https://api.vercel.com/v1/integrations/deploy/gancho\n",
      });
      const leido = yield* Effect.all({
        secreto: Config.Redacted("CELDA_R2_SECRETO"),
        gancho: Config.String("CELDA_VERCEL_DEPLOY_HOOK"),
        almacen: almacenDesdeConfig,
      }).pipe(Effect.provide(configuracionCon({ CREDENTIALS_DIRECTORY: directorio })));

      assert.isTrue(Option.isSome(leido.almacen));
      assert.strictEqual(leido.gancho, "https://api.vercel.com/v1/integrations/deploy/gancho");
      assert.strictEqual(Redacted.value(leido.secreto), "secreto");
    }).pipe(Effect.scoped),
  );

  it.effect("las variables de entorno mandan sobre las credenciales", () =>
    Effect.gen(function* () {
      const directorio = yield* directorioDeCredenciales({ r2: "CELDA_R2_CUBO=de-la-credencial" });
      const cubo = yield* Config.String("CELDA_R2_CUBO").pipe(
        Effect.provide(
          configuracionCon({ CREDENTIALS_DIRECTORY: directorio, CELDA_R2_CUBO: "del-entorno" }),
        ),
      );
      assert.strictEqual(cubo, "del-entorno");
    }).pipe(Effect.scoped),
  );

  it.effect("sin directorio de credenciales, la configuración es la del entorno", () =>
    Effect.gen(function* () {
      const almacen = yield* almacenDesdeConfig.pipe(Effect.provide(configuracionCon({})));
      assert.isTrue(Option.isNone(almacen));
    }),
  );
});
