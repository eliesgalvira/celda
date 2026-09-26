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
import { descargarBarrios, descargarPoblacion, leerLimites } from "./descarga.ts";

/**
 * Generador de capas. Tres órdenes:
 *
 * - `publicar`: lee la instantánea de Convex, le pone a cada emplazamiento su barrio con los
 *   límites guardados, escribe la capa en la carpeta del origen y la registra en Convex como
 *   vigente.
 * - `servir`: sirve esa carpeta como origen estático local, con las cabeceras de la CDN.
 * - `barrios`: descarga de Open Data BCN los límites de barrio y los guarda en el repositorio.
 * - `poblacion`: descarga de Open Data BCN el padrón más reciente y guarda los habitantes de
 *   cada barrio, con su área y su límite, donde los lee la web.
 */

/** Dónde se publican las capas. El origen es la URL con la que la web las descarga. */
const configCapas = Config.all({
  origen: Config.String("CELDA_CAPAS_ORIGEN").pipe(Config.withDefault("http://127.0.0.1:8852")),
  carpeta: Config.String("CELDA_CAPAS_CARPETA").pipe(Config.withDefault("salida")),
});

/** Los límites de barrio que usa `publicar` y que escribe `barrios`, guardados en git. */
const configBarrios = Config.String("CELDA_BARRIOS").pipe(Config.withDefault("datos/barrios.json"));

/** Los habitantes por barrio que escribe `poblacion`: la web los lee de su carpeta. */
const configPoblacion = Config.String("CELDA_POBLACION").pipe(
  Config.withDefault("../../apps/web/src/ejercicio/poblacion.json"),
);

const configConvex = Config.all({
  url: Config.String("CELDA_CONVEX_URL"),
  claveAdmin: Config.Redacted("CELDA_CONVEX_CLAVE_ADMIN"),
});

const publicar = Effect.gen(function* () {
  const capas = yield* configCapas;
  const convex = yield* configConvex;
  const limites = yield* leerLimites(yield* configBarrios);
  const publicada = yield* publicarCapa(limites).pipe(
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

const barrios = Effect.gen(function* () {
  const destino = yield* configBarrios;
  const limites = yield* descargarBarrios(destino).pipe(
    // Punto de entrada de la orden: aquí se monta su cliente HTTP, una vez.
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(FetchHttpClient.layer),
  );
  yield* Effect.log(
    `${limites.barrios.length} barrios con fecha ${limites.fuente.fecha} escritos en ${destino}`,
  );
});

const poblacion = Effect.gen(function* () {
  const destino = yield* configPoblacion;
  const limites = yield* leerLimites(yield* configBarrios);
  const escrita = yield* descargarPoblacion(destino, limites).pipe(
    // Punto de entrada de la orden: aquí se monta su cliente HTTP, una vez.
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(FetchHttpClient.layer),
  );
  const total = escrita.barrios.reduce((suma, b) => suma + b.habitantes, 0);
  yield* Effect.log(
    `${escrita.barrios.length} barrios y ${total} habitantes a ${escrita.fuente.referencia} escritos en ${destino}`,
  );
});

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «publicar», «servir», «barrios» o «poblacion».`;
  }
}

const principal = Effect.gen(function* () {
  const orden = process.argv[2] ?? "";
  if (orden === "publicar") return yield* publicar;
  if (orden === "servir") return yield* servir;
  if (orden === "barrios") return yield* barrios;
  if (orden === "poblacion") return yield* poblacion;
  return yield* new OrdenDesconocida({ orden });
});

// El punto de entrada del generador monta aquí sus capas, una vez.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(principal.pipe(Effect.provide(NodeServices.layer)));
