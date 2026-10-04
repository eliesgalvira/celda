import { INTERMEDIO_FNMT } from "@celda/ingesta/registro-oficial/intermedio";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as NodeTls from "node:tls";

/** En qué certificados confía una conexión HTTPS. */
export interface Confianza {
  /** Las raíces: una cadena solo vale si acaba en una de ellas. */
  readonly raices: ReadonlyArray<string>;
  /**
   * Intermedios con los que OpenSSL completa la cadena cuando el servidor no los envía. No son
   * raíces: una cadena que llegue a uno de ellos tiene que seguir hasta una de `raices`.
   */
  readonly intermedios: ReadonlyArray<string>;
}

/**
 * La del geoportal: las raíces de siempre de Node (las de Mozilla, más las de
 * `NODE_EXTRA_CA_CERTS` o las del sistema si se piden) y el intermedio de la FNMT que el geoportal
 * a veces no envía (`INTERMEDIO_FNMT`).
 */
export const confianzaDelRegistro = (): Confianza => ({
  raices: NodeTls.getCACertificates("default"),
  intermedios: [INTERMEDIO_FNMT],
});

/** Las que seguía `fetch`. */
const REDIRECCIONES_MAXIMAS = 20;

/**
 * Una respuesta comprimida no se descomprime: falla y dice con qué viene. El cliente pide el cuerpo
 * sin comprimir (`accept-encoding: identity`), y el geoportal no comprime aunque se le pida. Si
 * algún día lo hace, mejor un fallo claro que un listado o una ficha ilegibles.
 */
const sinComprimir = (
  respuesta: HttpClientResponse.HttpClientResponse,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> => {
  const codificacion = respuesta.headers["content-encoding"]?.trim().toLowerCase() ?? "identity";
  if (codificacion === "identity") return Effect.succeed(respuesta);
  return Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.DecodeError({
        request: respuesta.request,
        response: respuesta,
        cause: new Error(`respuesta comprimida con ${codificacion}, sin pedirlo`),
      }),
    }),
  );
};

/**
 * El cliente HTTP del registro oficial, listado y fichas: el de `node:https` de
 * `@effect/platform-node`, con un agente propio que verifica los certificados con `confianza`. El
 * resto de fuentes y la publicación siguen con el `fetch` global.
 *
 * Hace a mano lo que `fetch` hacía solo:
 *
 * - Sigue hasta `REDIRECCIONES_MAXIMAS` redirecciones.
 * - Pide el cuerpo sin comprimir (`sinComprimir`). `fetch` pedía `br, gzip, deflate, zstd` y
 *   descomprimía, pero el geoportal no comprime.
 * - Mantiene viva la conexión entre peticiones, como el agente de `fetch`, para no repetir el
 *   saludo TLS en cada ficha.
 *
 * El tiempo máximo de cada respuesta lo pone quien pide (`OpcionesCliente.espera`): al agotarse,
 * la petición se interrumpe y se cierra su conexión. El agente se cierra al cerrar la capa.
 */
export const clienteHttpDelRegistro = (
  confianza: Confianza = confianzaDelRegistro(),
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(Effect.service(HttpClient.HttpClient), (cliente) =>
      cliente.pipe(
        HttpClient.mapRequest(HttpClientRequest.setHeader("accept-encoding", "identity")),
        HttpClient.transformResponse(Effect.flatMap(sinComprimir)),
        HttpClient.followRedirects(REDIRECCIONES_MAXIMAS),
      ),
    ),
  ).pipe(
    Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
    Layer.provide(
      NodeHttpClient.layerAgentOptions({
        ca: [...confianza.raices, ...confianza.intermedios],
        keepAlive: true,
      }),
    ),
  );
