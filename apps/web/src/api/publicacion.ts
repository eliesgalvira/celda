/**
 * Lo que lee la API de la publicación vigente: los mismos ficheros de `/capas` que el mapa, pedidos
 * por HTTP a su propio origen (ADR 0032). Nunca pide nada a R2, a Convex ni al ministerio.
 *
 * Lo leído se queda en la memoria de la instancia de la función. Las capas de provincia y el
 * resumen se nombran por su contenido y no cambian; `vigente.json` sí, y se vuelve a leer a los
 * cinco minutos. Una lectura que falla no se guarda.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  CapaIlegible,
  decodificarVigente,
  FICHERO_VIGENTE,
  type Vigente,
  VersionDistinta,
} from "../../../../packages/dominio/src/capa.ts";
import {
  type CapaDeProvincia,
  leerCapaDeProvincia,
  leerResumen,
  type ResumenLeido,
} from "../../../../packages/dominio/src/provincias.ts";

/** Un fichero publicado no se ha podido leer: no ha llegado o no tiene la forma esperada. */
export class DatosNoDisponibles extends Schema.TaggedError<DatosNoDisponibles>()(
  "DatosNoDisponibles",
  { url: Schema.String, motivo: Schema.String },
) {}

/** Cuánto se fía la instancia de un `vigente.json` leído antes de volver a pedirlo. */
export const VIGENTE_DURA_MS = 5 * 60_000;

/**
 * Ficheros leídos que se guardan como mucho. Son el resumen y las capas de provincia, unos 3 MB de
 * texto por versión; con 64 caben dos versiones enteras.
 */
const FICHEROS_GUARDADOS = 64;

/** La versión vigente y su resumen: todo lo de una consulta sale de la misma versión. */
export interface VersionLeida {
  readonly vigente: Vigente;
  readonly resumen: ResumenLeido;
}

export class Publicacion extends Context.Service<
  Publicacion,
  {
    /** La versión vigente en `origen` (la carpeta `/capas`, sin barra final) y su resumen. */
    readonly version: (origen: string) => Effect.Effect<VersionLeida, DatosNoDisponibles>;
    /** La capa de una provincia, por el fichero que dice el resumen de la versión. */
    readonly provincia: (
      origen: string,
      codigo: string,
      fichero: string,
    ) => Effect.Effect<CapaDeProvincia, DatosNoDisponibles>;
  }
>()("@celda/web/api/publicacion") {}

/**
 * Un valor por clave que se carga una sola vez aunque lo pidan varias consultas a la vez, y que no
 * se guarda si la carga falla. Guarda como mucho `maximo` claves y olvida antes las más viejas.
 */
const guardadoPorClave = <A, E>(maximo: number) => {
  const valores = new Map<string, A>();
  const turnos = new Map<string, Semaphore.Semaphore>();
  return (clave: string, cargar: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      const guardado = valores.get(clave);
      if (guardado !== undefined) return Effect.succeed(guardado);
      let turno = turnos.get(clave);
      if (turno === undefined) {
        turno = Semaphore.makeUnsafe(1);
        turnos.set(clave, turno);
      }
      return turno.withPermits(1)(
        Effect.suspend(() => {
          const yaCargado = valores.get(clave);
          if (yaCargado !== undefined) return Effect.succeed(yaCargado);
          return Effect.tap(cargar, (valor) =>
            Effect.sync(() => {
              valores.set(clave, valor);
              turnos.delete(clave);
              for (const vieja of valores.keys()) {
                if (valores.size <= maximo) break;
                valores.delete(vieja);
              }
            }),
          );
        }),
      );
    });
};

/** El texto de un fichero publicado; `None` si el origen no lo tiene (404). */
const descargar = (http: HttpClient.HttpClient, url: string) =>
  Effect.gen(function* () {
    const respuesta = yield* http.get(url);
    if (respuesta.status === 404) return Option.none<string>();
    const ok = yield* HttpClientResponse.filterStatusOk(respuesta);
    return Option.some(yield* ok.text);
  }).pipe(Effect.mapError((error) => new DatosNoDisponibles({ url, motivo: error.message })));

const exigir = (http: HttpClient.HttpClient, url: string) =>
  Effect.flatMap(descargar(http, url), (texto) =>
    Effect.fromOption(texto).pipe(
      Effect.mapError(() => new DatosNoDisponibles({ url, motivo: "el origen no lo tiene" })),
    ),
  );

const ilegible =
  (url: string) =>
  (error: CapaIlegible | VersionDistinta): DatosNoDisponibles =>
    new DatosNoDisponibles({
      url,
      motivo:
        error._tag === "VersionDistinta"
          ? `es de ${error.encontrada} y se esperaba ${error.esperada}`
          : error.motivo,
    });

/** La publicación del origen sobre el cliente HTTP que se le dé. */
export const publicacionDelOrigen = Layer.effect(
  Publicacion,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const vigentes = new Map<string, { readonly vigente: Vigente; readonly hasta: number }>();
    const resumenes = guardadoPorClave<ResumenLeido, DatosNoDisponibles>(FICHEROS_GUARDADOS);
    const capas = guardadoPorClave<CapaDeProvincia, DatosNoDisponibles>(FICHEROS_GUARDADOS);

    const leerVigente = Effect.fn("Publicacion.vigente")(function* (origen: string) {
      const ahora = yield* Clock.currentTimeMillis;
      const guardado = vigentes.get(origen);
      if (guardado !== undefined && guardado.hasta > ahora) return guardado.vigente;
      const url = `${origen}/${FICHERO_VIGENTE}`;
      const vigente = yield* Effect.flatMap(exigir(http, url), (texto) =>
        Effect.fromResult(decodificarVigente(texto)).pipe(
          Effect.mapError((error) => new DatosNoDisponibles({ url, motivo: error.message })),
        ),
      );
      vigentes.set(origen, { vigente, hasta: ahora + VIGENTE_DURA_MS });
      return vigente;
    });

    const version = Effect.fn("Publicacion.version")(function* (origen: string) {
      const vigente = yield* leerVigente(origen);
      const fichero = vigente.resumen;
      if (fichero === undefined) {
        return yield* new DatosNoDisponibles({
          url: `${origen}/${FICHERO_VIGENTE}`,
          motivo: `${vigente.version} no tiene resumen nacional`,
        });
      }
      const url = `${origen}/${fichero}`;
      const resumen = yield* resumenes(
        fichero,
        Effect.flatMap(exigir(http, url), (texto) =>
          Effect.fromResult(leerResumen(texto, vigente.version)).pipe(
            Effect.mapError(ilegible(url)),
          ),
        ),
      );
      return { vigente, resumen };
    });

    const provincia = Effect.fn("Publicacion.provincia")(function* (
      origen: string,
      codigo: string,
      fichero: string,
    ) {
      const url = `${origen}/${fichero}`;
      return yield* capas(
        fichero,
        Effect.flatMap(exigir(http, url), (texto) =>
          Effect.fromResult(leerCapaDeProvincia(texto, codigo)).pipe(
            Effect.mapError(ilegible(url)),
          ),
        ),
      );
    });

    return { version, provincia };
  }),
);
