/**
 * `GET /api/emplazamientos`: lee la consulta, carga de la publicación vigente las provincias que
 * toca el círculo y contesta con los emplazamientos más cercanos (ADR 0032). La función de Vercel
 * (`api/emplazamientos.ts`) solo le pasa la petición.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { cercanos, provinciasDelCirculo } from "./cercanos.ts";
import { leerConsulta } from "./consulta.ts";
import { Publicacion } from "./publicacion.ts";
import { CercanosEnJson, ErrorEnJson, type RespuestaDeError } from "./respuesta.ts";

/**
 * Cada dato nuevo llega con un despliegue nuevo, y cada despliegue vacía la caché de Vercel. La
 * caché compartida puede guardar una respuesta un día; el navegador, cinco minutos.
 */
const CACHE_DE_UNA_RESPUESTA = "public, max-age=300, s-maxage=86400";

const codificarCercanos = Schema.encodeSync(CercanosEnJson);
const codificarError = Schema.encodeSync(ErrorEnJson);

const json = (estado: number, cuerpo: string, cache: string): Response =>
  new Response(cuerpo, {
    status: estado,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cache,
    },
  });

const error = (estado: number, cuerpo: RespuestaDeError): Response =>
  json(estado, codificarError(cuerpo), "no-store");

export const atender = (peticion: Request): Effect.Effect<Response, never, Publicacion> =>
  Effect.gen(function* () {
    const url = new URL(peticion.url);
    const consulta = leerConsulta(url.searchParams);
    if (Result.isFailure(consulta)) {
      return error(400, { error: "consulta-no-valida", mensaje: consulta.failure.mensaje });
    }
    const publicacion = yield* Publicacion;
    const capas = `${url.origin}/capas`;
    const { vigente, resumen } = yield* publicacion.version(capas);
    const punto = { longitud: consulta.success.longitud, latitud: consulta.success.latitud };
    const leidas = yield* Effect.forEach(
      provinciasDelCirculo(resumen, punto, consulta.success.radio),
      (provincia) => publicacion.provincia(capas, provincia.codigo, provincia.fichero),
      { concurrency: "unbounded" },
    );
    return json(
      200,
      codificarCercanos(cercanos(consulta.success, resumen, leidas, url.origin, vigente.licencias)),
      CACHE_DE_UNA_RESPUESTA,
    );
  }).pipe(
    Effect.catchTag("DatosNoDisponibles", (fallo) =>
      Effect.as(
        Effect.logError("La API no ha podido leer la publicación", fallo),
        error(503, {
          error: "datos-no-disponibles",
          mensaje:
            "No se han podido leer los datos publicados. Vuelve a intentarlo en unos minutos.",
        }),
      ),
    ),
    Effect.withSpan("api.emplazamientos"),
  );
