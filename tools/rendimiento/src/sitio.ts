// La medida no usa Effect: Playwright es de promesas y el script corre con Node tal cual.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

/**
 * Un servidor local que imita el sitio de Vercel (ADR 0010): la web construida, lo publicado en
 * `/capas`, las cabeceras de `apps/web/vercel.json` y la compresión de la CDN. Así la medida ve los
 * mismos bytes y la misma caché que un teléfono.
 */

const TIPOS = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".css", "text/css"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json"],
]);

const COMPRIMIBLES = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".webmanifest"]);

const INMUTABLE = "public, max-age=31536000, immutable";
const SIN_CACHE = "public, max-age=0, must-revalidate";

/** La caché de cada ruta, como en `vercel.json`. */
const cacheDe = (ruta: string): string => {
  if (ruta === "/capas/vigente.json") return SIN_CACHE;
  if (ruta.startsWith("/capas/") || ruta.startsWith("/assets/")) return INMUTABLE;
  return SIN_CACHE;
};

export interface Sitio {
  readonly origen: string;
  readonly cerrar: () => Promise<void>;
}

/**
 * Sirve `web` (la carpeta `dist`) con `capas` en `/capas` en un puerto libre de 127.0.0.1. Con
 * `aislado`, la página va aislada de otros orígenes (COOP y COEP), como pide
 * `performance.measureUserAgentSpecificMemory` para medir la memoria de la página y sus Workers.
 */
export const servirSitio = async (web: string, capas: string, aislado = false): Promise<Sitio> => {
  const comprimidos = new Map<string, Buffer>();

  const leer = async (
    ruta: string,
  ): Promise<{ fichero: string; contenido: Buffer } | undefined> => {
    const [base, relativa] = ruta.startsWith("/capas/")
      ? [capas, ruta.slice("/capas/".length)]
      : [web, ruta.slice(1)];
    const fichero = NodePath.join(base, decodeURIComponent(relativa));
    if (!fichero.startsWith(base)) return undefined;
    try {
      return { fichero, contenido: await NodeFSP.readFile(fichero) };
    } catch {
      return undefined;
    }
  };

  const servidor = NodeHttp.createServer((peticion, respuesta) => {
    const ruta = new URL(peticion.url ?? "/", "http://sitio").pathname;
    void (async () => {
      const esEstatico = ruta.startsWith("/capas/") || ruta.startsWith("/assets/");
      // Como `rewrites` de vercel.json: lo que no es un fichero va a la web.
      const encontrado =
        (await leer(ruta === "/" ? "/index.html" : ruta)) ??
        (esEstatico ? undefined : await leer("/index.html"));
      if (encontrado === undefined) {
        respuesta.writeHead(404, { "cache-control": SIN_CACHE }).end();
        return;
      }
      const extension = NodePath.extname(encontrado.fichero);
      const cabeceras: NodeHttp.OutgoingHttpHeaders = {
        "content-type": TIPOS.get(extension) ?? "application/octet-stream",
        "cache-control": encontrado.fichero.endsWith("index.html") ? SIN_CACHE : cacheDe(ruta),
        "access-control-allow-origin": "*",
      };
      if (aislado) {
        cabeceras["cross-origin-opener-policy"] = "same-origin";
        cabeceras["cross-origin-embedder-policy"] = "credentialless";
      }
      const aceptaGzip = /\bgzip\b/u.test(String(peticion.headers["accept-encoding"] ?? ""));
      let cuerpo = encontrado.contenido;
      if (aceptaGzip && COMPRIMIBLES.has(extension)) {
        let comprimido = comprimidos.get(encontrado.fichero);
        if (comprimido === undefined) {
          comprimido = NodeZlib.gzipSync(encontrado.contenido, { level: 9 });
          comprimidos.set(encontrado.fichero, comprimido);
        }
        cuerpo = comprimido;
        cabeceras["content-encoding"] = "gzip";
        cabeceras.vary = "accept-encoding";
      }
      cabeceras["content-length"] = String(cuerpo.length);
      respuesta.writeHead(200, cabeceras).end(peticion.method === "HEAD" ? undefined : cuerpo);
    })();
  });

  await new Promise<void>((resolver) => {
    servidor.listen(0, "127.0.0.1", resolver);
  });
  // SAFETY: un servidor TCP que ya escucha da su dirección y su puerto, no la ruta de un socket.
  const { port: puerto } = servidor.address() as NodeNet.AddressInfo;
  return {
    origen: `http://127.0.0.1:${puerto}`,
    cerrar: () =>
      new Promise<void>((resolver) => {
        servidor.closeAllConnections();
        servidor.close(() => resolver());
      }),
  };
};
