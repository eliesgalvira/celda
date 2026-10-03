import { Provincias } from "@celda/ingesta/fichas";
import { PasadaDeBorde } from "@celda/dominio/cuadrosDelRegistro";
import { municipioDelPunto } from "@celda/dominio/municipio";
import * as RegistroOficial from "@celda/ingesta/registro-oficial/extractor";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import {
  almacenDesdeConfig,
  copiasDesdeConfig,
  vercelDesdeConfig,
} from "@celda/publicacion/configuracion";
import { buzonAdministrado } from "@celda/moderacion/buzon";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { baseNocturna } from "./base.ts";
import { montarCapasEn } from "./capas.ts";
import { clienteHttpDelRegistro } from "./conexionDelRegistro.ts";
import { configuracion } from "./configuracion.ts";
import { credencialesDeSystemd } from "./credenciales.ts";
import {
  copiarBase,
  estado,
  Extractores,
  noche,
  provinciasDe,
  publicadorEn,
  publicarAMano,
  sinAlmacen,
  subirCopia,
} from "./programa.ts";
import { cuadrosDeBorde, pasadaDeBorde } from "./cuadros.ts";

/**
 * La ingesta nocturna fuera de Convex (ADR 0015). Cuatro órdenes sobre la misma base:
 *
 * - `noche`: la noche entera, ingesta, publicación, build de Vercel y copia de seguridad.
 * - `estado`: la última ejecución de cada fuente, las fichas pendientes, los errores y lo
 *   publicado.
 * - `publicar`: publica a mano lo que haya en la base, sin pedir nada a las fuentes, y lanza el
 *   build de Vercel si no sirve la versión vigente.
 * - `copia`: copia la base a la carpeta de copias y, con un cubo de R2, también allí.
 *
 * Y dos que no abren la base:
 *
 * - `capas <carpeta>`, que monta en una carpeta la versión vigente del almacén de la configuración
 *   y las dos anteriores. La lanza el build de Vercel (ADR 0018).
 * - `cuadros-de-borde <fichero>`, que pide una vez al registro oficial, con el ritmo, el
 *   `User-Agent` y el tope del extractor, cada cuadro que toca alguna provincia y no está en ninguna
 *   zona de barrido, y escribe en `<fichero>` lo que trae cada uno (`pasadaDeBorde`). Con ese
 *   fichero, `pnpm run cuadros` pone al día los cuadros de las zonas (#55).
 *
 * La configuración va en variables de entorno (`configuracion.ts`). Los secretos pueden llegar
 * también como credenciales de systemd (`credenciales.ts`).
 */

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «noche», «estado», «publicar», «copia», «capas» o «cuadros-de-borde».`;
  }
}

/** `capas` sin su carpeta. */
class FaltanArgumentos extends Schema.TaggedError<FaltanArgumentos>()("FaltanArgumentos", {}) {
  override get message() {
    return "Uso: capas <carpeta>. Las capas salen del almacén de la configuración: el cubo de R2 o CELDA_ALMACEN_CARPETA.";
  }
}

/** `capas` sin almacén del que leer. */
class SinAlmacen extends Schema.TaggedError<SinAlmacen>()("SinAlmacen", {}) {
  override get message() {
    return "No hay almacén del que montar las capas: faltan las variables de R2 (CELDA_R2_CUENTA, CELDA_R2_CUBO, CELDA_R2_ID_CLAVE y CELDA_R2_SECRETO) o CELDA_ALMACEN_CARPETA.";
  }
}

const codificarPasada = Schema.encodeEffect(Schema.fromJsonString(PasadaDeBorde));

/** `cuadros-de-borde` sin el fichero en el que escribir. */
class FaltaElFichero extends Schema.TaggedError<FaltaElFichero>()("FaltaElFichero", {}) {
  override get message() {
    return "Uso: cuadros-de-borde <fichero>. El fichero es el JSON que lee `pnpm run cuadros`.";
  }
}

const principal = Effect.gen(function* () {
  const [orden = "", ...argumentos] = process.argv.slice(2);
  if (orden === "capas") {
    const path = yield* Path.Path;
    const [carpeta] = argumentos;
    if (carpeta === undefined) return yield* new FaltanArgumentos();
    const almacen = yield* almacenDesdeConfig;
    if (Option.isNone(almacen)) return yield* new SinAlmacen();
    const destino = path.resolve(carpeta);
    // El punto de entrada de la orden monta aquí sus capas, una vez: el almacén del que se lee y
    // la carpeta en la que se monta.
    // @effect-diagnostics-next-line strictEffectProvide:off
    const origen = yield* Effect.service(AlmacenDeFicheros).pipe(Effect.provide(almacen.value));
    yield* montarCapasEn(origen, destino).pipe(
      // @effect-diagnostics-next-line strictEffectProvide:off
      Effect.provide(almacenEnCarpeta({ carpeta: destino, origen: "/capas" })),
    );
    return;
  }
  const c = yield* configuracion;
  const zonas = yield* zonasDePublicacion;
  const extractorDelRegistro = RegistroOficial.capaPorCajas(
    c.registroOficial,
    c.fichasDelRegistro,
  ).pipe(Layer.provide(clienteHttpDelRegistro()));
  if (orden === "cuadros-de-borde") {
    const [fichero] = argumentos;
    if (fichero === undefined) return yield* new FaltaElFichero();
    const pasar = pasadaDeBorde(
      cuadrosDeBorde(zonas.municipios),
      (posicion) => municipioDelPunto(posicion, zonas.municipios).provincia?.codigo,
    );
    // Como la orden `capas`, monta aquí su extractor, una vez, y no abre la base ni el almacén.
    // @effect-diagnostics-next-line strictEffectProvide:off
    const pasada = yield* pasar.pipe(Effect.provide(extractorDelRegistro));
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(fichero, `${yield* codificarPasada(pasada)}\n`);
    yield* Effect.logInfo(
      `Pasada de borde en ${fichero}: ${pasada.cuadros.length} cuadros, ` +
        `${pasada.peticiones} peticiones, ${pasada.errores.length} errores`,
    );
    return;
  }
  const base = baseNocturna({ fichero: c.base, interruptores: c.interruptores });
  const almacen = yield* almacenDesdeConfig;
  const vercel = yield* vercelDesdeConfig;
  const copias = yield* copiasDesdeConfig;
  const publicador = Option.match(almacen, {
    onNone: () => sinAlmacen,
    onSome: (capa) =>
      publicadorEn(zonas).pipe(
        Layer.provide(
          Option.match(vercel, {
            onNone: () => capa,
            onSome: (sitio) => Layer.merge(capa, sitio),
          }),
        ),
      ),
  });
  const extractores = Layer.succeed(
    Extractores,
    Extractores.of({
      registroOficial: extractorDelRegistro,
      comunidad: Option.map(c.buzon, (conexion) =>
        buzonAdministrado(conexion).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    }),
  );
  const entorno = Layer.mergeAll(
    publicador,
    extractores,
    Layer.succeed(Provincias, provinciasDe(zonas.municipios)),
    Option.getOrElse(copias, () => Layer.empty),
  ).pipe(Layer.provideMerge(base));

  const efecto = Effect.gen(function* () {
    switch (orden) {
      case "noche":
        yield* noche(c.noche);
        return;
      case "estado":
        yield* estado(c.noche.proceso);
        return;
      case "publicar":
        yield* publicarAMano;
        return;
      case "copia": {
        const copia = yield* copiarBase(c.noche.copias);
        yield* Effect.logInfo(`Copia de la base en ${copia}`);
        yield* subirCopia(copia, c.noche.copias.conservar);
        return;
      }
      default:
        return yield* new OrdenDesconocida({ orden });
    }
  });
  // El punto de entrada de la orden monta aquí sus capas, una vez.
  // @effect-diagnostics-next-line strictEffectProvide:off
  return yield* efecto.pipe(Effect.provide(entorno));
});

/** Node y, detrás de las variables de entorno, las credenciales de systemd. */
const programa = ConfigProvider.layerAdd(credencialesDeSystemd).pipe(
  Layer.provideMerge(NodeServices.layer),
);

// El punto de entrada del programa monta aquí sus capas, una vez.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(principal.pipe(Effect.provide(programa)));
