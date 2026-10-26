/**
 * `GET /api/emplazamientos`: lee la consulta, carga de la publicación vigente las provincias que
 * toca el círculo y contesta con los emplazamientos más cercanos (ADR 0032). La función de Vercel
 * (`api/emplazamientos.ts`) solo le pasa la petición.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { cercanos, provinciasDelCirculo } from "./cercanos.ts";
import { leerConsulta } from "./consulta.ts";
import { DOCUMENTACION, json, respuestaDeError } from "./http.ts";
import { quiereLaPagina } from "./negociacion.ts";
import { pagina } from "./pagina.ts";
import { Publicacion } from "./publicacion.ts";
import { CercanosEnJson } from "./respuesta.ts";

/**
 * Cada dato nuevo llega con un despliegue nuevo, y cada despliegue vacía la caché de Vercel. La
 * caché compartida puede guardar una respuesta un día; el navegador, cinco minutos.
 */
const CACHE_DE_UNA_RESPUESTA = "public, max-age=300, s-maxage=86400";

const codificarCercanos = Schema.encodeSync(CercanosEnJson);

export const atender = Effect.fn("api.emplazamientos")(
  function* (peticion: Request) {
    const url = new URL(peticion.url);
    if (quiereLaPagina(peticion, url)) return pagina();
    const consulta = yield* Effect.fromResult(leerConsulta(url.searchParams));
    const publicacion = yield* Publicacion;
    const capas = `${url.origin}/capas`;
    const { vigente, resumen } = yield* publicacion.version(capas);
    const punto = { longitud: consulta.longitud, latitud: consulta.latitud };
    const leidas = yield* Effect.forEach(
      provinciasDelCirculo(resumen, punto, consulta.radioMetros),
      (provincia) => publicacion.provincia(capas, provincia.codigo, provincia.fichero),
      { concurrency: "unbounded" },
    );
    return json(
      200,
      codificarCercanos(cercanos(consulta, resumen, leidas, url.origin, vigente.licencias)),
      CACHE_DE_UNA_RESPUESTA,
    );
  },
  Effect.catchTags({
    // Quien abre la ruta a mano, desde un enlace, ve el error en el navegador: el mensaje le dice
    // también dónde está la documentación.
    ConsultaNoValida: (fallo) =>
      Effect.succeed(
        respuestaDeError(400, {
          error: "consulta-no-valida",
          mensaje: `${fallo.mensaje} La documentación está en ${DOCUMENTACION}`,
        }),
      ),
    DatosNoDisponibles: (fallo) =>
      Effect.as(
        Effect.logError("La API no ha podido leer la publicación", fallo),
        respuestaDeError(503, {
          error: "datos-no-disponibles",
          mensaje:
            "No se han podido leer los datos publicados. Vuelve a intentarlo en unos minutos.",
        }),
      ),
  }),
);
