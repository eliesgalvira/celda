/**
 * La dirección de Celda y lo que dice una tarjeta al compartir un enlace: el tamaño de la imagen,
 * su título y su texto alternativo. Van aparte del dibujo de la imagen (`compartir.ts`) para que
 * los use quien no la dibuja, como la página de la API, sin cargar el rasterizador.
 */
import { CARPETA_ICONOS } from "./geometria.ts";

/** La dirección pública de Celda: las redes solo aceptan la imagen con la URL entera. */
export const SITIO = "https://celda.elies.site";

/** El tamaño que piden X y Facebook para una tarjeta grande: 1,91 a 1. */
export const COMPARTIR = {
  ancho: 1200,
  alto: 630,
  fichero: "compartir.png",
  ruta: `${CARPETA_ICONOS}/compartir.png`,
} as const;

/** El título y la descripción de la tarjeta, y el texto alternativo de su imagen. */
export const TITULO_AL_COMPARTIR = "Celda · Antenas de telefonía móvil de España";
export const ALTERNATIVO_AL_COMPARTIR =
  "Mapa de España con sus provincias y un punto por cada emplazamiento de antenas de telefonía móvil, con el logo de Celda en el centro.";
