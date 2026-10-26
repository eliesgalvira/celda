/**
 * Lo que lee la API de la publicación vigente: los mismos ficheros de `/capas` que el mapa, pedidos
 * por HTTP a su propio origen (ADR 0032). Nunca pide nada a R2, a Convex ni al ministerio.
 *
 * Lo leído se queda en la memoria de la instancia de la función, en cachés de Effect que comparten
 * la lectura entre consultas simultáneas. Las capas de provincia y el resumen se nombran por su
 * contenido y no cambian; `vigente.json` sí, y se vuelve a leer a los cinco minutos. Una lectura
 * que falla no se guarda.
 */
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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
export const VIGENTE_DURA = Duration.minutes(5);

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

/** Una lectura que ha salido bien se guarda el tiempo que se le dé; una que falla, nada. */
const soloSiSaleBien =
  (dura: Duration.Input) =>
  <A, E>(salida: Exit.Exit<A, E>): Duration.Input =>
    Exit.isSuccess(salida) ? dura : Duration.zero;

/** El texto de un fichero publicado. Que el origen no lo tenga (404) también es no poder leerlo. */
const leerTexto = (http: HttpClient.HttpClient, url: string) =>
  Effect.gen(function* () {
    const respuesta = yield* http.get(url);
    if (respuesta.status === 404) {
      return yield* new DatosNoDisponibles({ url, motivo: "el origen no lo tiene" });
    }
    const ok = yield* HttpClientResponse.filterStatusOk(respuesta);
    return yield* ok.text;
  }).pipe(
    Effect.catchTag("HttpClientError", (error) =>
      Effect.fail(new DatosNoDisponibles({ url, motivo: error.message })),
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

/** Un fichero de la publicación: su URL y lo que hace falta para comprobarlo al leerlo. */
interface FicheroPedido {
  readonly url: string;
  /** La versión que tiene que decir el resumen, o la provincia que tiene que decir la capa. */
  readonly espera: string;
}

/** La publicación del origen sobre el cliente HTTP que se le dé. */
export const publicacionDelOrigen = Layer.effect(
  Publicacion,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const vigentes = yield* Cache.makeWith(
      (url: string) =>
        Effect.flatMap(leerTexto(http, url), (texto) =>
          Effect.fromResult(decodificarVigente(texto)).pipe(
            Effect.mapError((error) => new DatosNoDisponibles({ url, motivo: error.message })),
          ),
        ),
      { capacity: 4, timeToLive: soloSiSaleBien(VIGENTE_DURA) },
    );
    const resumenes = yield* Cache.makeWith(
      ({ url, espera }: FicheroPedido) =>
        Effect.flatMap(leerTexto(http, url), (texto) =>
          Effect.fromResult(leerResumen(texto, espera)).pipe(Effect.mapError(ilegible(url))),
        ),
      { capacity: FICHEROS_GUARDADOS, timeToLive: soloSiSaleBien(Duration.infinity) },
    );
    const capas = yield* Cache.makeWith(
      ({ url, espera }: FicheroPedido) =>
        Effect.flatMap(leerTexto(http, url), (texto) =>
          Effect.fromResult(leerCapaDeProvincia(texto, espera)).pipe(
            Effect.mapError(ilegible(url)),
          ),
        ),
      { capacity: FICHEROS_GUARDADOS, timeToLive: soloSiSaleBien(Duration.infinity) },
    );

    const version = Effect.fn("Publicacion.version")(function* (origen: string) {
      const vigente = yield* Cache.get(vigentes, `${origen}/${FICHERO_VIGENTE}`);
      if (vigente.resumen === undefined) {
        return yield* new DatosNoDisponibles({
          url: `${origen}/${FICHERO_VIGENTE}`,
          motivo: `${vigente.version} no tiene resumen nacional`,
        });
      }
      const resumen = yield* Cache.get(resumenes, {
        url: `${origen}/${vigente.resumen}`,
        espera: vigente.version,
      });
      return { vigente, resumen };
    });

    const provincia = Effect.fn("Publicacion.provincia")(function* (
      origen: string,
      codigo: string,
      fichero: string,
    ) {
      return yield* Cache.get(capas, { url: `${origen}/${fichero}`, espera: codigo });
    });

    return Publicacion.of({ version, provincia });
  }),
);
