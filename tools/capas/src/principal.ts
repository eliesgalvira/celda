import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { CACHE_INMUTABLE, CACHE_VIGENTE } from "@celda/publicacion/almacenes/r2";
import { publicar as publicarDatos } from "@celda/publicacion/publicar";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
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

import { descargarBarrios, descargarPoblacion, leerLimites } from "./descarga.ts";
import { descargarMunicipios } from "./descargaDeMunicipios.ts";
import { escribirEspana } from "./espana.ts";
import { FORMAS_CASTELLANAS } from "./formasCastellanas.ts";
import { escribirNombres } from "./nombres.ts";
import { datosSinteticos, FECHA_SINTETICA } from "./sintetica.ts";
import { escribirZonas } from "./zonas.ts";

/**
 * Generador de capas. Ocho órdenes:
 *
 * - `servir`: sirve una carpeta publicada como origen estático local, con las cabeceras de la
 *   CDN. La publica la ingesta nocturna (`pnpm run ingesta publicar`) o `sintetica`.
 * - `barrios`: descarga de Open Data BCN los límites de barrio y los guarda en el repositorio.
 * - `poblacion`: descarga de Open Data BCN el padrón más reciente y guarda los habitantes de
 *   cada barrio, con su área y su límite, donde los lee la web.
 * - `municipios`: descarga los límites de municipios y provincias del IGN y el padrón del INE, y
 *   los guarda en el repositorio junto a los barrios (ADR 0017).
 * - `zonas`: escribe desde esos límites, sin descargar nada, el índice de municipios y el
 *   contorno de cada provincia que la web descarga al abrir el ejercicio de emplazamientos.
 * - `espana`: escribe desde esos límites, sin descargar nada, el contorno de España con que el
 *   mapa base esconde de lejos los rótulos de fuera (ADR 0024).
 * - `nombres`: escribe desde esos límites, sin descargar nada, la tabla de nombres de lugar de los
 *   oficiales bilingües y el contorno de la Comunitat Valenciana (ADR 0025).
 * - `sintetica`: publica en la carpeta una España sintética de `CELDA_SINTETICOS` emplazamientos
 *   (100.000 por defecto), con la publicación de verdad, para medir el mapa (ADR 0016).
 */

/** Dónde se publican las capas. El origen es la URL con la que la web las descarga. */
const configCapas = Config.all({
  origen: Config.String("CELDA_CAPAS_ORIGEN").pipe(Config.withDefault("http://127.0.0.1:8852")),
  carpeta: Config.String("CELDA_CAPAS_CARPETA").pipe(Config.withDefault("salida")),
});

/**
 * Los límites de barrio que escribe `barrios` y lee `poblacion`, guardados en git en el paquete
 * de la publicación, que también los lee.
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

/** Dónde escribe `zonas` el índice y los contornos: la web los lee de su carpeta. */
const configZonas = Config.String("CELDA_ZONAS").pipe(
  Config.withDefault("../../apps/web/src/ejercicio/zonas"),
);

/** Dónde escribe `espana` el contorno: el estilo del mapa base lo lee de su carpeta. */
const configEspana = Config.String("CELDA_ESPANA").pipe(
  Config.withDefault("../../packages/ui/src/mapa/espana.json"),
);

/**
 * Dónde escribe `nombres` la tabla y el contorno: el dominio los lee de su carpeta de datos, y de
 * allí la web, el mapa base y el buscador.
 */
const configNombres = Config.all({
  tabla: Config.String("CELDA_NOMBRES").pipe(
    Config.withDefault("../../packages/dominio/datos/nombres-de-lugar.json"),
  ),
  contorno: Config.String("CELDA_COMUNITAT_VALENCIANA").pipe(
    Config.withDefault("../../packages/dominio/datos/comunitat-valenciana.json"),
  ),
});

/** Pausa entre dos peticiones al mismo sitio de la orden `municipios`. */
const PAUSA_MUNICIPIOS = Duration.seconds(5);

const sintetica = Effect.gen(function* () {
  const capas = yield* configCapas;
  const cuantos = yield* Config.Int("CELDA_SINTETICOS").pipe(Config.withDefault(100_000));
  const publicada = yield* publicarDatos(yield* zonasDePublicacion).pipe(
    // Punto de entrada de la orden: aquí se montan sus capas, una vez.
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(
      Layer.merge(
        almacenEnCarpeta({ carpeta: capas.carpeta, origen: capas.origen.replace(/\/$/u, "") }),
        datosSinteticos(cuantos, FECHA_SINTETICA),
      ),
    ),
  );
  yield* Effect.log(
    `${publicada.version}: ${publicada.emplazamientos} emplazamientos sintéticos en ${publicada.lotes} lotes`,
    `resumen y capas de provincia de ${publicada.bytesCapa} bytes`,
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

const zonas = Effect.gen(function* () {
  const { municipios } = yield* configMunicipios;
  const destino = yield* configZonas;
  const escritos = yield* escribirZonas(municipios, destino);
  const bytes = [...escritos.values()].reduce((suma, n) => suma + n, 0);
  yield* Effect.log(`${escritos.size} ficheros de zonas, ${bytes} bytes, escritos en ${destino}`);
});

const espana = Effect.gen(function* () {
  const { municipios } = yield* configMunicipios;
  const destino = yield* configEspana;
  const { contorno, bytes } = yield* escribirEspana(municipios, destino);
  const vertices = contorno.coordinates.reduce((suma, [anillo = []]) => suma + anillo.length, 0);
  yield* Effect.log(
    `${contorno.coordinates.length} polígonos y ${vertices} vértices, ${bytes} bytes, escritos en ${destino}`,
  );
});

const nombres = Effect.gen(function* () {
  const { municipios } = yield* configMunicipios;
  const destino = yield* configNombres;
  const escritos = yield* escribirNombres(
    municipios,
    FORMAS_CASTELLANAS,
    destino.tabla,
    destino.contorno,
  );
  const { provincias, municipios: bilingues } = escritos.tabla;
  const vertices = escritos.contorno.coordinates.reduce(
    (suma, [anillo = []]) => suma + anillo.length,
    0,
  );
  yield* Effect.log(
    `${Object.keys(provincias).length} provincias y ${Object.keys(bilingues).length} municipios bilingües, ${escritos.bytesTabla} bytes, escritos en ${destino.tabla}`,
  );
  yield* Effect.log(
    `${escritos.contorno.coordinates.length} polígonos y ${vertices} vértices de la Comunitat Valenciana, ${escritos.bytesContorno} bytes, escritos en ${destino.contorno}`,
  );
});

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «servir», «barrios», «poblacion», «municipios», «zonas», «espana», «nombres» o «sintetica».`;
  }
}

const principal = Effect.gen(function* () {
  const orden = process.argv[2] ?? "";
  if (orden === "servir") return yield* servir;
  if (orden === "barrios") return yield* barrios;
  if (orden === "poblacion") return yield* poblacion;
  if (orden === "municipios") return yield* municipios;
  if (orden === "zonas") return yield* zonas;
  if (orden === "espana") return yield* espana;
  if (orden === "nombres") return yield* nombres;
  if (orden === "sintetica") return yield* sintetica;
  return yield* new OrdenDesconocida({ orden });
});

// El punto de entrada del generador monta aquí sus capas, una vez.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(principal.pipe(Effect.provide(NodeServices.layer)));
