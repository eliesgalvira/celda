import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { AlmacenDeFicheros, AlmacenNoDisponible, FicheroInmutable } from "../almacen.ts";

export interface OpcionesCarpeta {
  /** Carpeta que sirve el origen estático. */
  readonly carpeta: string;
  /** URL del origen que sirve esa carpeta, sin la barra final. */
  readonly origen: string;
}

/**
 * El almacén de ficheros en una carpeta del disco: la que sirve el origen estático local en
 * desarrollo, la que se sube a la vista previa y la de las pruebas. Escribe cada fichero de una
 * vez (a un temporal y luego lo renombra) y nunca pisa uno que ya exista con otro contenido,
 * salvo `vigente.json`.
 */
export const almacenEnCarpeta = (opciones: OpcionesCarpeta) =>
  Layer.effect(
    AlmacenDeFicheros,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const noDisponible = (causa: { readonly message: string }) =>
        new AlmacenNoDisponible({ motivo: causa.message });

      /** Escribe de una vez: nadie ve nunca un fichero a medias. */
      const escribir = (destino: string, contenido: string) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(destino), { recursive: true });
          const temporal = `${destino}.${process.pid}.tmp`;
          yield* fs.writeFileString(temporal, contenido);
          yield* fs.rename(temporal, destino);
        });

      const guardar = Effect.fn("AlmacenEnCarpeta.guardar")(
        function* (fichero: string, contenido: string) {
          const destino = path.join(opciones.carpeta, fichero);
          if (yield* fs.exists(destino)) {
            if ((yield* fs.readFileString(destino)) !== contenido) {
              return yield* new FicheroInmutable({ fichero });
            }
            return false;
          }
          yield* escribir(destino, contenido);
          return true;
        },
        Effect.catchTag("PlatformError", (error) => Effect.fail(noDisponible(error))),
      );

      const leer = Effect.fn("AlmacenEnCarpeta.leer")(
        function* (fichero: string) {
          const origen = path.join(opciones.carpeta, fichero);
          if (!(yield* fs.exists(origen))) return Option.none<string>();
          return Option.some(yield* fs.readFileString(origen));
        },
        Effect.catchTag("PlatformError", (error) => Effect.fail(noDisponible(error))),
      );

      const cambiarVigente = Effect.fn("AlmacenEnCarpeta.cambiarVigente")(
        (contenido: string) => escribir(path.join(opciones.carpeta, FICHERO_VIGENTE), contenido),
        Effect.catchTag("PlatformError", (error) => Effect.fail(noDisponible(error))),
      );

      const listar = Effect.gen(function* () {
        if (!(yield* fs.exists(opciones.carpeta))) return [];
        const entradas = yield* fs.readDirectory(opciones.carpeta, { recursive: true });
        // Las carpetas de lotes y los temporales de una escritura a medias no son ficheros publicados.
        return entradas
          .map((entrada) => entrada.split(path.sep).join("/"))
          .filter((entrada) => entrada.endsWith(".json"));
      }).pipe(
        Effect.catchTag("PlatformError", (error) => Effect.fail(noDisponible(error))),
        Effect.withSpan("AlmacenEnCarpeta.listar"),
      );

      const borrar = Effect.fn("AlmacenEnCarpeta.borrar")(
        function* (fichero: string) {
          const destino = path.join(opciones.carpeta, fichero);
          yield* fs.remove(destino, { force: true });
          if (!fichero.includes("/")) return;
          // La carpeta de lotes de una versión se va con su último lote. La retención borra varios
          // lotes a la vez: los dos últimos pueden verla vacía a la vez, y el segundo ya no la
          // encuentra al leerla o al quitarla. Que ya no esté es justo lo que se quería.
          const carpeta = path.dirname(destino);
          const quedan = yield* fs
            .readDirectory(carpeta)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([])));
          if (quedan.length === 0) yield* fs.remove(carpeta, { recursive: true, force: true });
        },
        Effect.catchTag("PlatformError", (error) => Effect.fail(noDisponible(error))),
      );

      return AlmacenDeFicheros.of({
        guardar,
        leer,
        cambiarVigente,
        listar,
        borrar,
        url: (fichero) => `${opciones.origen}/${fichero}`,
      });
    }),
  );
