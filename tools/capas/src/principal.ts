import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { CACHE_INMUTABLE, CACHE_VIGENTE } from "@celda/publicacion/almacenes/r2";
import { publicar as publicarInstantanea } from "@celda/convex/publicacion";
import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpStaticServer from "effect/unstable/http/HttpStaticServer";
// NodeHttpServer necesita el constructor de servidores de Node.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeHttp from "node:http";

import { convexPorHttp } from "./convex.ts";
import { descargarBarrios, descargarPoblacion, leerLimites } from "./descarga.ts";
import { descargarMunicipios, leerMunicipios } from "./descargaDeMunicipios.ts";

/**
 * Generador de capas. Cinco órdenes:
 *
 * - `publicar`: publica la instantánea de un despliegue de Convex en una carpeta, igual que la
 *   publicación automática tras cada ingesta: la capa, las fichas de la misma versión, con el
 *   municipio y la provincia de cada emplazamiento, y `vigente.json`. Sirve para publicar desde
 *   otro despliegue sin configurarle un almacén.
 * - `servir`: sirve esa carpeta como origen estático local, con las cabeceras de la CDN.
 * - `barrios`: descarga de Open Data BCN los límites de barrio y los guarda en el repositorio.
 * - `poblacion`: descarga de Open Data BCN el padrón más reciente y guarda los habitantes de
 *   cada barrio, con su área y su límite, donde los lee la web.
 * - `municipios`: descarga los límites de municipios y provincias del IGN y el padrón del INE, y
 *   los guarda en el repositorio junto a los barrios (ADR 0017).
 */

/** Dónde se publican las capas. El origen es la URL con la que la web las descarga. */
const configCapas = Config.all({
  origen: Config.String("CELDA_CAPAS_ORIGEN").pipe(Config.withDefault("http://127.0.0.1:8852")),
  carpeta: Config.String("CELDA_CAPAS_CARPETA").pipe(Config.withDefault("salida")),
});

/**
 * Los límites de barrio que usa `publicar` y que escribe `barrios`, guardados en git en el
 * paquete de la publicación, que también los lee.
 */
const configBarrios = Config.String("CELDA_BARRIOS").pipe(
  Config.withDefault("../../packages/publicacion/datos/barrios.json"),
);

/** Los habitantes por barrio que escribe `poblacion`: la web los lee de su carpeta. */
const configPoblacion = Config.String("CELDA_POBLACION").pipe(
  Config.withDefault("../../apps/web/src/ejercicio/poblacion.json"),
);

/**
 * Los límites de municipios y el padrón que escribe `municipios`, en el repositorio junto a los
 * barrios, y la carpeta donde se guarda el ZIP del IGN para no volver a pedirlo.
 */
const configMunicipios = Config.all({
  municipios: Config.String("CELDA_MUNICIPIOS").pipe(
    Config.withDefault("../../packages/publicacion/datos/municipios.json"),
  ),
  padron: Config.String("CELDA_PADRON").pipe(
    Config.withDefault("../../packages/publicacion/datos/padron.json"),
  ),
  cache: Config.String("CELDA_CACHE").pipe(
    Config.orElse(() =>
      Config.String("XDG_CACHE_HOME").pipe(Config.map((carpeta) => `${carpeta}/celda`)),
    ),
    Config.orElse(() => Config.String("HOME").pipe(Config.map((casa) => `${casa}/.cache/celda`))),
  ),
});

/** Pausa entre dos peticiones al mismo sitio de la orden `municipios`. */
const PAUSA_MUNICIPIOS = Duration.seconds(5);

const configConvex = Config.all({
  url: Config.String("CELDA_CONVEX_URL"),
  claveAdmin: Config.Redacted("CELDA_CONVEX_CLAVE_ADMIN"),
});

const publicar = Effect.gen(function* () {
  const capas = yield* configCapas;
  const convex = yield* configConvex;
  const limites = yield* leerLimites(yield* configBarrios);
  const municipios = yield* leerMunicipios((yield* configMunicipios).municipios);
  const publicada = yield* publicarInstantanea({ barrios: limites, municipios }).pipe(
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
    `${publicada.version} (${publicada.tipo}): ${publicada.emplazamientos} emplazamientos en ${publicada.lotes} lotes`,
    `${publicada.escritos} ficheros escritos`,
    `capa de ${publicada.bytesCapa} bytes, fichas de ${publicada.bytesFichas} bytes`,
    `(el lote mayor, ${publicada.bytesLoteMayor})`,
  );
});

const servir = Effect.gen(function* () {
  const { origen, carpeta } = yield* configCapas;
  const puerto = Number(new URL(origen).port);
  yield* Effect.log(`Origen estático de capas en ${origen}, desde la carpeta ${carpeta}`);
  // `vigente.json` cambia en cada publicación: se sirve aparte, sin caché larga.
  const vigente = HttpRouter.add(
    "GET",
    `/${FICHERO_VIGENTE}`,
    HttpServerResponse.file(`${carpeta}/${FICHERO_VIGENTE}`, {
      headers: { "cache-control": CACHE_VIGENTE, "content-type": "application/json" },
    }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 404 }))),
  );
  return yield* Layer.launch(
    HttpRouter.serve(
      Layer.mergeAll(
        vigente,
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

const municipios = Effect.gen(function* () {
  const opciones = yield* configMunicipios;
  const { limites, padron } = yield* descargarMunicipios({
    ...opciones,
    pausa: PAUSA_MUNICIPIOS,
  }).pipe(
    // Punto de entrada de la orden: aquí se monta su cliente HTTP, una vez.
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(FetchHttpClient.layer),
  );
  const cuantos = limites.territorios.filter((t) => t.tipo === "municipio").length;
  const habitantes = padron.municipios.reduce((suma, m) => suma + m.habitantes, 0);
  yield* Effect.log(
    `${cuantos} municipios, ${limites.territorios.length - cuantos} territorios sin municipio`,
    `y ${limites.provincias.length} provincias del IGN del ${limites.fuente.fecha} en ${opciones.municipios}`,
  );
  yield* Effect.log(
    `${habitantes} habitantes a ${padron.fuente.referencia} (INE, ${padron.fuente.publicada}) en ${opciones.padron}`,
  );
});

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «publicar», «servir», «barrios», «poblacion» o «municipios».`;
  }
}

const principal = Effect.gen(function* () {
  const orden = process.argv[2] ?? "";
  if (orden === "publicar") return yield* publicar;
  if (orden === "servir") return yield* servir;
  if (orden === "barrios") return yield* barrios;
  if (orden === "poblacion") return yield* poblacion;
  if (orden === "municipios") return yield* municipios;
  return yield* new OrdenDesconocida({ orden });
});

// El punto de entrada del generador monta aquí sus capas, una vez.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(principal.pipe(Effect.provide(NodeServices.layer)));
