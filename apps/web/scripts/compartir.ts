/**
 * Escribe la imagen para compartir (`@celda/ui/marca/compartir.ts`) con los puntos de la versión
 * vigente de unas capas. El build de Vercel la lanza al acabar de montar las capas:
 *
 *   node scripts/compartir.ts dist/capas dist/iconos/compartir.png
 *
 * Para probarla en local basta una carpeta con `vigente.json`, su resumen y sus puntos, bajados de
 * `https://celda.elies.site/capas`.
 * Va con los colores del tema oscuro, que destacan más entre las publicaciones; `--tema claro` la
 * pinta con los del claro. Si algo falla, sale con error y el build se para.
 */
// Corre en Node al construir, fuera de cualquier programa de Effect.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { leerResumen } from "@celda/dominio/provincias";
import { leerPuntos } from "@celda/dominio/puntos";
import {
  coloresAlCompartir,
  type DatosAlCompartir,
  pngAlCompartir,
} from "@celda/ui/marca/compartir.ts";
import * as Result from "effect/Result";

import espana from "../../../packages/ui/src/mapa/espana.json" with { type: "json" };
import limites from "../src/mapa/limites.json" with { type: "json" };

const [origen, salida, ...opciones] = process.argv.slice(2);
if (origen === undefined || salida === undefined) {
  throw new Error("Uso: node scripts/compartir.ts <capas> <salida.png> [--tema claro]");
}
const tema = opciones.join(" ") === "--tema claro" ? "claro" : "oscuro";

const leer = (fichero: string): string => NodeFS.readFileSync(`${origen}/${fichero}`, "utf8");

const vigente = Result.getOrThrow(decodificarVigente(leer(FICHERO_VIGENTE)));
if (vigente.resumen === undefined) throw new Error(`${vigente.version} no tiene resumen nacional`);
const resumen = Result.getOrThrow(leerResumen(leer(vigente.resumen), vigente.version));
const puntos = Result.getOrThrow(leerPuntos(leer(resumen.puntos)));

const datos: DatosAlCompartir = {
  contorno: { type: "MultiPolygon", coordinates: espana.contorno.coordinates },
  limites,
  longitud: puntos.longitud,
  latitud: puntos.latitud,
};
const css = NodeFS.readFileSync(
  new URL("../../../packages/ui/src/tema.css", import.meta.url),
  "utf8",
);
const png = pngAlCompartir(datos, coloresAlCompartir(css, tema));
NodeFS.writeFileSync(salida, png);
process.stdout.write(
  `${salida}: ${puntos.cuantos} emplazamientos de ${vigente.version}, tema ${tema}, ${png.length} bytes\n`,
);
