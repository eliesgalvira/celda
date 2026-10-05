import { RECURSOS_INICIALES_MAPA_BASE } from "@celda/ui/mapa/estilo.ts";
import urlDelTrabajador from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import urlDeLimites from "./limites.json?url";

/**
 * Adelanta la cadena de descargas del mapa base. Sin esto, MapLibre (casi 1 MB) se pide cuando la
 * pantalla ya está pintada, su worker cuando se crea el mapa, y el TileJSON y los glifos cuando
 * llegan el worker y la primera tesela: cuatro viajes seguidos por la red.
 *
 * `entrada.tsx` lo importa lo primero, así que corre en cuanto ha llegado el código de la web y
 * antes de evaluar el resto: MapLibre se descarga mientras se monta la pantalla, sin quitarle
 * ancho de banda a ese código. Sin WebGL no se pide nada, porque el mapa no se va a poder dibujar.
 *
 * También pide ya los límites de comunidades y provincias (8 KB con gzip, del mismo origen): así
 * están cuando se crea el mapa y salen con la silueta de España en su primer pintado.
 */
export const precargarMapaBase = (documento: Document): void => {
  if (!("WebGLRenderingContext" in globalThis)) return;
  // `mapaBase.ts` pone en marcha los workers de MapLibre en cuanto se evalúa.
  void import("./mapaBase.ts").catch(() => {
    // Si falla, `PantallaMapa` lo vuelve a pedir y dice qué ha pasado.
  });
  // El código de los workers de MapLibre: queda en la caché HTTP para cuando arranquen.
  const trabajador = documento.createElement("link");
  trabajador.rel = "prefetch";
  trabajador.href = urlDelTrabajador;
  documento.head.append(trabajador);
  for (const url of [...RECURSOS_INICIALES_MAPA_BASE, urlDeLimites]) {
    // Como `fetch`, con CORS y sin credenciales: MapLibre los pide igual y reutiliza la respuesta.
    const enlace = documento.createElement("link");
    enlace.rel = "preload";
    enlace.as = "fetch";
    enlace.crossOrigin = "anonymous";
    enlace.href = url;
    documento.head.append(enlace);
  }
};

precargarMapaBase(document);
