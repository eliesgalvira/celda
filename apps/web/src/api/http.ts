/**
 * Las respuestas HTTP de la API (ADR 0032): JSON, abiertas a cualquier origen y con su caché. Las
 * funciones de Vercel contestan con un `Response` de la web.
 */
import * as Schema from "effect/Schema";

import { ErrorEnJson, type RespuestaDeError } from "./respuesta.ts";

/** La documentación de la API, que enlazan el índice y cada error. */
export const DOCUMENTACION = "https://github.com/eliesgalvira/celda/blob/main/docs/api.md";

/** Lo que no hay que guardar en ninguna caché, como los errores. */
export const SIN_CACHE = "no-store";

const codificarError = Schema.encodeSync(ErrorEnJson);

/**
 * Las rutas de la API contestan distinto según `Accept` cuando no llevan parámetros
 * (`negociacion.ts`), así que todas sus respuestas lo dicen con `Vary`.
 */
const cabeceras = (tipo: string, cache: string) => ({
  "Content-Type": tipo,
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": cache,
  Vary: "Accept",
});

export const json = (estado: number, cuerpo: string, cache: string): Response =>
  new Response(cuerpo, {
    status: estado,
    headers: cabeceras("application/json; charset=utf-8", cache),
  });

/**
 * Lo que contesta según `Accept` no se guarda en la caché compartida: aunque la respuesta diga
 * `Vary: Accept`, otra caché podría dar la página a un agente o el JSON a un navegador. Solo la del
 * navegador, que es de una sola persona.
 */
export const CACHE_NEGOCIADA = "private, max-age=300";

/** La página que explica la API, para el navegador. */
export const html = (cuerpo: string): Response =>
  new Response(cuerpo, {
    status: 200,
    headers: cabeceras("text/html; charset=utf-8", CACHE_NEGOCIADA),
  });

export const respuestaDeError = (estado: number, cuerpo: RespuestaDeError): Response =>
  json(estado, codificarError(cuerpo), SIN_CACHE);
