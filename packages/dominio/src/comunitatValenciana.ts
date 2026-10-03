import type { Coordenada } from "./area.ts";
import { dentroDelPoligono, type Poligono } from "./barrio.ts";
import fichero from "../datos/comunitat-valenciana.json" with { type: "json" };

/**
 * El contorno de la Comunitat Valenciana con que se decide el nombre de lugar de lo que no trae
 * código INE: los rótulos del mapa base y los resultados del buscador (ADR 0025). Es la unión de
 * los recintos del IGN de las provincias 03, 12 y 46, con el Rincón de Ademuz y sin los islotes de
 * menos de 1 km², simplificada a 400 m. Lo escribe `pnpm run nombres` en `tools/capas` desde los
 * límites del repositorio, y una prueba de allí comprueba que está al día y que ningún municipio
 * cambia de lado al simplificar.
 *
 * Pesa unos 3,5 KB con gzip: lo importan el código del mapa (`apps/web/src/mapa/mapaBase.ts`) y el
 * buscador al llegar su primera respuesta, no la primera pantalla.
 */

/** Un contorno como la geometría `MultiPolygon` de GeoJSON, en grados, como lo pide MapLibre. */
export interface Contorno {
  readonly type: "MultiPolygon";
  readonly coordinates: Array<Array<Array<Array<number>>>>;
}

export const CONTORNO_DE_LA_COMUNITAT_VALENCIANA: Contorno = {
  type: "MultiPolygon",
  coordinates: fichero.contorno.coordinates,
};

/** Los polígonos de un contorno, con cada vértice como `[longitud, latitud]`. */
export const poligonosDe = (contorno: Contorno): ReadonlyArray<Poligono> =>
  contorno.coordinates.map((poligono) =>
    poligono.map((anillo) =>
      anillo.map(([longitud = 0, latitud = 0]) => [longitud, latitud] as const),
    ),
  );

const POLIGONOS = poligonosDe(CONTORNO_DE_LA_COMUNITAT_VALENCIANA);

/** Si un punto cae en la Comunitat Valenciana. */
export const enLaComunitatValenciana = (punto: Coordenada): boolean =>
  POLIGONOS.some((poligono) => dentroDelPoligono(punto, poligono));
