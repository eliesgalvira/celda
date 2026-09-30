import { INTERMEDIO_FNMT } from "@celda/ingesta/registro-oficial/intermedio";
import * as Undici from "@effect/platform-node/Undici";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
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

/**
 * `fetch` con su propio agente, que verifica los certificados con `confianza`. Es el `fetch` del
 * paquete `undici` y no el global de Node: el global lleva dentro otra versión de Undici y rechaza
 * los agentes de esta («invalid onRequestStart method»). Hace lo mismo que el global (cabeceras,
 * redirecciones, compresión), así que para el geoportal solo cambia en qué certificados se confía.
 */
const fetchCon = (confianza: Confianza) =>
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Undici.Agent({ connect: { ca: [...confianza.raices, ...confianza.intermedios] } }),
      ),
      (agente) => Effect.promise(() => agente.destroy()),
    ),
    (agente): typeof globalThis.fetch =>
      (entrada, opciones) =>
        // SAFETY: los tipos del `fetch` de Undici son los de su versión de la API web y los del
        // global, los de la versión que trae Node: difieren en detalles (iteradores de cabeceras,
        // tipos de cuerpo), no en lo que usa `FetchHttpClient`, que pasa una URL y sus opciones y
        // lee estado, cabeceras y cuerpo de la respuesta.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions
        Undici.fetch(entrada instanceof Request ? entrada.url : entrada, {
          ...opciones,
          dispatcher: agente,
        } as Undici.RequestInit) as unknown as Promise<Response>,
  );

/**
 * El cliente HTTP del registro oficial, listado y fichas: el de `fetch` de siempre, con un agente
 * propio que confía en `confianza`. El agente se cierra al cerrar la capa. El resto de fuentes y la
 * publicación siguen con el `fetch` global.
 */
export const clienteHttpDelRegistro = (
  confianza: Confianza = confianzaDelRegistro(),
): Layer.Layer<HttpClient.HttpClient> =>
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.effect(FetchHttpClient.Fetch, fetchCon(confianza))),
  );
