import { publicarCapa } from "@celda/convex/capas";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpStaticServer from "effect/unstable/http/HttpStaticServer";
// NodeHttpServer necesita el constructor de servidores de Node.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeHttp from "node:http";

import { almacenEnCarpeta } from "./almacen.ts";
import { convexPorHttp } from "./convex.ts";

/**
 * Generador de capas. Dos órdenes:
 *
 * - `publicar`: lee la instantánea de Convex, escribe la capa en la carpeta del origen y la
 *   registra en Convex como vigente.
 * - `servir`: sirve esa carpeta como origen estático local, con las cabeceras de la CDN.
 */

/** Dónde se publican las capas. El origen es la URL con la que la web las descarga. */
const configCapas = Config.all({
  origen: Config.String("CELDA_CAPAS_ORIGEN").pipe(Config.withDefault("http://127.0.0.1:8852")),
  carpeta: Config.String("CELDA_CAPAS_CARPETA").pipe(Config.withDefault("salida")),
});

const configConvex = Config.all({
  url: Config.String("CELDA_CONVEX_URL"),
  claveAdmin: Config.Redacted("CELDA_CONVEX_CLAVE_ADMIN"),
});

const publicar = Effect.gen(function* () {
  const capas = yield* configCapas;
  const convex = yield* configConvex;
  const publicada = yield* publicarCapa().pipe(
    // Punto de entrada de la orden: aquí se montan sus capas, una vez.
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(
      Layer.merge(
        almacenEnCarpeta({ carpeta: capas.carpeta, origen: capas.origen.replace(/\/$/u, "") }),
        convexPorHttp(convex).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    ),
  );
  yield* Effect.log(
    `${publicada.version}: ${publicada.emplazamientos} emplazamientos, ${publicada.bytes} bytes`,
    publicada.ficheroNuevo ? "fichero nuevo" : "el fichero ya estaba",
    publicada.versionNueva ? "versión registrada" : "la versión ya estaba registrada",
    publicada.url,
  );
});

/** Un año e inmutable: cada versión es un fichero distinto que no cambia nunca (ADR 0004). */
const CACHE_INMUTABLE = "public, max-age=31536000, immutable";

const servir = Effect.gen(function* () {
  const { origen, carpeta } = yield* configCapas;
  const puerto = Number(new URL(origen).port);
  yield* Effect.log(`Origen estático de capas en ${origen}, desde la carpeta ${carpeta}`);
  return yield* Layer.launch(
    HttpRouter.serve(
      Layer.mergeAll(
        HttpStaticServer.layer({ root: carpeta, cacheControl: CACHE_INMUTABLE }),
        HttpRouter.cors({ allowedMethods: ["GET", "HEAD"] }),
      ),
    ).pipe(Layer.provide(NodeHttpServer.layer(NodeHttp.createServer, { port: puerto }))),
  );
});

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «publicar» o «servir».`;
  }
}

const principal = Effect.gen(function* () {
  const orden = process.argv[2] ?? "";
  if (orden === "publicar") return yield* publicar;
  if (orden === "servir") return yield* servir;
  return yield* new OrdenDesconocida({ orden });
});

// El punto de entrada del generador monta aquí sus capas, una vez.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(principal.pipe(Effect.provide(NodeServices.layer)));
