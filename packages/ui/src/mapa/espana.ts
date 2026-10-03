import fichero from "./espana.json";
import type { ContornoDeEspana } from "./rotulos.ts";

/**
 * El contorno de España del IGN, simplificado a 400 m, con que el mapa base no rotula de lejos
 * los lugares de fuera (ADR 0024). `espana.json` lo escribe `pnpm run espana` en `tools/capas`
 * desde los límites de municipios del repositorio, y una prueba de allí comprueba que está al día.
 *
 * Pesa unos 24 KB con gzip: solo lo importa el código del mapa, que se descarga aparte de la
 * primera pantalla (`apps/web/src/mapa/mapaBase.ts`).
 */
export const CONTORNO_DE_ESPANA: ContornoDeEspana = {
  type: "MultiPolygon",
  coordinates: fichero.contorno.coordinates,
};
