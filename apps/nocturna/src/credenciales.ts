import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/**
 * Las credenciales que systemd deja en `$CREDENTIALS_DIRECTORY` con `LoadCredential=`, como
 * configuración. Cada fichero va en formato `.env`, una variable por línea:
 *
 * ```
 * CELDA_R2_ID_CLAVE=…
 * CELDA_R2_SECRETO=…
 * ```
 *
 * Así los secretos no pasan por el entorno del proceso ni por el almacén de Nix. Se leen después
 * de las variables de entorno, que mandan si una variable está en los dos sitios. Sin
 * `CREDENTIALS_DIRECTORY` no añade nada.
 */
export const credencialesDeSystemd = Effect.gen(function* () {
  const directorio = yield* Config.option(Config.String("CREDENTIALS_DIRECTORY"));
  if (Option.isNone(directorio)) {
    return ConfigProvider.fromUnknown({});
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nombres = (yield* fs.readDirectory(directorio.value)).toSorted();
  const contenidos = yield* Effect.forEach(nombres, (nombre) =>
    fs.readFileString(path.join(directorio.value, nombre)),
  );
  return ConfigProvider.fromDotEnvContents(contenidos.join("\n"));
});
