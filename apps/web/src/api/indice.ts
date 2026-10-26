/**
 * `GET /api` dice qué hay en la API y dónde está la documentación, y una ruta de `/api/` que no
 * existe contesta con un 404 en JSON en lugar de con la página del mapa (ADR 0032).
 */
import * as Schema from "effect/Schema";

import { CACHE_NEGOCIADA, DOCUMENTACION, json, respuestaDeError } from "./http.ts";
import { quiereLaPagina } from "./negociacion.ts";
import { pagina } from "./pagina.ts";
import { IndiceEnJson } from "./respuesta.ts";

const codificarIndice = Schema.encodeSync(IndiceEnJson);

/**
 * El índice de la API, con los ejemplos en el origen de la petición. Un navegador que abre `/api`
 * recibe la página que explica cómo usarla.
 */
export const indice = (peticion: Request): Response => {
  const url = new URL(peticion.url);
  if (quiereLaPagina(peticion, url)) return pagina();
  const { origin } = url;
  return json(
    200,
    codificarIndice({
      descripcion:
        "Los emplazamientos de antenas de telefonía móvil de España del registro oficial, con sus compañías, sus bandas y las medidas de exposición del ministerio.",
      documentacion: DOCUMENTACION,
      rutas: [
        {
          ruta: "/api/emplazamientos",
          descripcion:
            "Los emplazamientos más cercanos a un punto, del más cercano al más lejano. El radio va en metros, o con su unidad: 1500m o 15km.",
          ejemplo: `${origin}/api/emplazamientos?lat=40.41693&lon=-3.70358&radio=300&limite=5`,
        },
        {
          ruta: "/capas/vigente.json",
          descripcion:
            "La versión vigente de los ficheros estáticos que lee el mapa, por donde se empieza a descargar el conjunto entero.",
          ejemplo: `${origin}/capas/vigente.json`,
        },
      ],
    }),
    CACHE_NEGOCIADA,
  );
};

/** Una ruta de `/api/` que no existe. */
export const noEncontrada = (): Response =>
  respuestaDeError(404, {
    error: "no-encontrado",
    mensaje: `Esta ruta no existe en la API de Celda. Las que hay están en /api, y la documentación en ${DOCUMENTACION}.`,
  });
