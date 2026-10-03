import { type Coordenada, distanciaAlRectangulo, distanciaMetros } from "@celda/dominio/area";
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import type { EmplazamientoCercano } from "@celda/dominio/moderacion";
import {
  type CapaDeProvincia,
  leerCapaDeProvincia,
  leerLoteDeProvincia,
  leerParteDelIndice,
  leerResumen,
  parteDeClave,
  type ResumenLeido,
} from "@celda/dominio/provincias";
import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";

/** Lo publicado no se puede leer: el origen no contesta o lo que llega no se entiende. */
export class PublicadoNoDisponible extends Schema.TaggedError<PublicadoNoDisponible>()(
  "PublicadoNoDisponible",
  { motivo: Schema.String },
) {
  override get message() {
    return `No se puede leer lo publicado: ${this.motivo}`;
  }
}

/** Cuántos emplazamientos cercanos se dan como mucho. */
const CERCANOS_MAXIMOS = 5;

/**
 * Lo publicado en la versión vigente, tal como lo lee la web (ADR 0016): la ficha de cada
 * emplazamiento, con lo que dice el registro oficial y las correcciones ya aceptadas, y los
 * emplazamientos cerca de un punto. La moderación compara cada aportación con esto.
 */
export class LoPublicado extends Context.Service<
  LoPublicado,
  {
    /** La versión vigente, o `None` si no hay nada publicado. */
    readonly version: Effect.Effect<Option.Option<string>, PublicadoNoDisponible>;
    /** La ficha publicada de un emplazamiento, o `None` si la versión vigente no lo tiene. */
    readonly ficha: (clave: string) => Effect.Effect<Option.Option<Ficha>, PublicadoNoDisponible>;
    /** Los emplazamientos publicados a `radio` metros o menos del punto, del más cercano al más lejano. */
    readonly cercanos: (
      punto: Coordenada,
      radio: number,
    ) => Effect.Effect<ReadonlyArray<EmplazamientoCercano>, PublicadoNoDisponible>;
  }
>()("@celda/moderacion/publicado/LoPublicado") {}

/** Lee un fichero publicado; `None` si el origen no lo tiene. */
export type LeerPublicado = (
  fichero: string,
) => Effect.Effect<Option.Option<string>, PublicadoNoDisponible>;

const noDisponible = (motivo: string) => new PublicadoNoDisponible({ motivo });

const resultado = <A, E extends { readonly message: string }>(
  leido: Result.Result<A, E>,
  fichero: string,
) =>
  Effect.fromResult(leido).pipe(
    Effect.mapError((error) => noDisponible(`${fichero}: ${error.message}`)),
  );

/**
 * Lo publicado que da `leer`. Lee `vigente.json` y el resumen una vez, y guarda las capas, las
 * partes del índice y los lotes que lee: una tanda de moderación pide el mismo lote muchas veces.
 */
export const loPublicadoDesde = (leer: LeerPublicado) =>
  Layer.effect(
    LoPublicado,
    Effect.gen(function* () {
      const ficheros = yield* Cache.make({ lookup: leer, capacity: 64 });
      const fichero = (nombre: string) => Cache.get(ficheros, nombre);
      const obligatorio = (nombre: string) =>
        Effect.flatMap(fichero(nombre), (contenido) =>
          Option.match(contenido, {
            onNone: () => Effect.fail(noDisponible(`falta ${nombre}`)),
            onSome: Effect.succeed,
          }),
        );

      const resumen: Effect.Effect<
        Option.Option<ResumenLeido>,
        PublicadoNoDisponible
      > = yield* Effect.cached(
        Effect.gen(function* () {
          const texto = yield* leer(FICHERO_VIGENTE);
          if (Option.isNone(texto)) return Option.none();
          const vigente = yield* resultado(decodificarVigente(texto.value), FICHERO_VIGENTE);
          if (vigente.resumen === undefined) {
            return yield* noDisponible(`${vigente.version} no es del formato 5`);
          }
          const contenido = yield* obligatorio(vigente.resumen);
          return Option.some(
            yield* resultado(leerResumen(contenido, vigente.version), vigente.resumen),
          );
        }),
      );

      const capaDe = (provincia: string, nombre: string) =>
        Effect.flatMap(obligatorio(nombre), (contenido) =>
          resultado(leerCapaDeProvincia(contenido, provincia), nombre),
        );

      /** La provincia de una clave, según el índice de claves. */
      const provinciaDe = (leido: ResumenLeido, clave: string) =>
        Effect.gen(function* () {
          const partes = leido.claves ?? [];
          const parte = partes[parteDeClave(clave, partes.length)];
          if (parte === undefined) return Option.none<string>();
          const indice = yield* resultado(leerParteDelIndice(yield* obligatorio(parte)), parte);
          return Option.fromNullishOr(indice.get(clave));
        });

      const fichaEn = (capa: CapaDeProvincia, clave: string) =>
        Effect.gen(function* () {
          const emplazamiento = capa.emplazamientos.find((e) => e.clave === clave);
          const lote = capa.lotes[emplazamiento?.lote ?? -1];
          if (lote === undefined) return Option.none<Ficha>();
          const fichas = yield* resultado(
            leerLoteDeProvincia(yield* obligatorio(lote), capa.provincia),
            lote,
          );
          return Option.fromNullishOr(fichas.find((f) => f.clave === clave));
        });

      return LoPublicado.of({
        version: Effect.map(
          resumen,
          Option.map((leido) => leido.version),
        ),
        ficha: (clave) =>
          Effect.gen(function* () {
            const leido = yield* resumen;
            if (Option.isNone(leido)) return Option.none();
            const provincia = yield* provinciaDe(leido.value, clave);
            const nombre = Option.flatMap(provincia, (codigo) =>
              Option.fromNullishOr(
                leido.value.provincias.find((p) => p.codigo === codigo)?.fichero,
              ),
            );
            if (Option.isNone(provincia) || Option.isNone(nombre)) return Option.none();
            return yield* fichaEn(yield* capaDe(provincia.value, nombre.value), clave);
          }).pipe(Effect.withSpan("LoPublicado.ficha")),
        cercanos: (punto, radio) =>
          Effect.gen(function* () {
            const leido = yield* resumen;
            if (Option.isNone(leido)) return [];
            const candidatas = leido.value.provincias.filter(
              (p) =>
                p.fichero !== undefined &&
                p.caja !== undefined &&
                distanciaAlRectangulo(punto, p.caja) <= radio,
            );
            const cercanos: Array<EmplazamientoCercano> = [];
            for (const provincia of candidatas) {
              if (provincia.fichero === undefined) continue;
              const capa = yield* capaDe(provincia.codigo, provincia.fichero);
              for (const e of capa.emplazamientos) {
                const metros = distanciaMetros(punto, e.posicion);
                if (metros <= radio) {
                  cercanos.push({
                    clave: e.clave,
                    posicion: e.posicion,
                    companias: e.companias,
                    metros: Math.round(metros),
                  });
                }
              }
            }
            return cercanos.toSorted((a, b) => a.metros - b.metros).slice(0, CERCANOS_MAXIMOS);
          }).pipe(Effect.withSpan("LoPublicado.cercanos")),
      });
    }),
  );

/** Lo publicado en un origen HTTP, como la web: `https://celda.elies.site/capas`. */
export const loPublicadoEnHttp = (origen: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const base = origen.replace(/\/+$/u, "");
      const leer: LeerPublicado = (nombre) =>
        Effect.gen(function* () {
          const url = `${base}/${nombre}`;
          const respuesta = yield* http.get(url);
          if (respuesta.status === 404) return Option.none<string>();
          if (respuesta.status !== 200) {
            return yield* noDisponible(`GET ${url}: HTTP ${respuesta.status}`);
          }
          return Option.some(yield* respuesta.text);
        }).pipe(
          Effect.catchTag("HttpClientError", (error) => Effect.fail(noDisponible(error.message))),
        );
      return loPublicadoDesde(leer);
    }),
  );

/** Lo publicado en una carpeta, como la que escribe `pnpm run ingesta publicar` en local. */
export const loPublicadoEnCarpeta = (carpeta: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const leer: LeerPublicado = (nombre) => {
        const ruta = path.join(carpeta, nombre);
        return Effect.gen(function* () {
          if (!(yield* fs.exists(ruta))) return Option.none<string>();
          return Option.some(yield* fs.readFileString(ruta));
        }).pipe(Effect.mapError((error) => noDisponible(`${ruta}: ${error.message}`)));
      };
      return loPublicadoDesde(leer);
    }),
  );

/** Dónde lee la moderación lo publicado si no se le dice otra cosa: lo que sirve la web. */
export const ORIGEN_PUBLICADO = "https://celda.elies.site/capas";

/**
 * Lo publicado de la configuración: `CELDA_MODERACION_CAPAS`, una URL o una carpeta. Por defecto,
 * lo que sirve la web en `ORIGEN_PUBLICADO`.
 */
export const origenPublicadoDesdeConfig = Config.String("CELDA_MODERACION_CAPAS").pipe(
  Config.withDefault(ORIGEN_PUBLICADO),
);

/** La capa de lo publicado para un origen: una URL `http(s)://` o una carpeta. */
export const loPublicadoEn = (
  origen: string,
): Layer.Layer<LoPublicado, never, HttpClient.HttpClient | FileSystem.FileSystem | Path.Path> =>
  /^https?:\/\//u.test(origen) ? loPublicadoEnHttp(origen) : loPublicadoEnCarpeta(origen);
