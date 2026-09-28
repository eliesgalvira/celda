import { AlmacenDeCapas, AlmacenNoDisponible, CapaInmutable } from "@celda/convex/capas";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

export interface OpcionesCarpeta {
  /** Carpeta que sirve el origen estático. */
  readonly carpeta: string;
  /** URL del origen que sirve esa carpeta, sin la barra final. */
  readonly origen: string;
}

/**
 * Almacén de capas en una carpeta del disco, la que sirve el origen estático. Escribe cada
 * fichero de una vez (a un temporal y luego lo renombra) y nunca pisa uno que ya exista con otro
 * contenido.
 */
export const almacenEnCarpeta = (opciones: OpcionesCarpeta) =>
  Layer.effect(
    AlmacenDeCapas,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const noDisponible = (causa: { readonly message: string }) =>
        new AlmacenNoDisponible({ motivo: causa.message });

      const guardar = Effect.fn("AlmacenEnCarpeta.guardar")(
        function* (fichero: string, contenido: string) {
          yield* fs.makeDirectory(opciones.carpeta, { recursive: true });
          const destino = path.join(opciones.carpeta, fichero);
          if (yield* fs.exists(destino)) {
            if ((yield* fs.readFileString(destino)) !== contenido) {
              return yield* new CapaInmutable({ fichero });
            }
            return false;
          }
          const temporal = `${destino}.${process.pid}.tmp`;
          yield* fs.writeFileString(temporal, contenido);
          yield* fs.rename(temporal, destino);
          return true;
        },
        Effect.catchTag("PlatformError", (error) => Effect.fail(noDisponible(error))),
      );

      return AlmacenDeCapas.of({
        guardar,
        url: (fichero) => `${opciones.origen}/${fichero}`,
      });
    }),
  );
