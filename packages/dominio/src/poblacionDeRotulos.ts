import type { Coordenada } from "./area.ts";

/**
 * Cómo se buscan los habitantes de un rótulo de ciudad para la regla de choques (ADR 0024): por su
 * texto, que es el nombre de lugar (ADR 0025), y por su posición. Va aparte de la tabla
 * (`habitantesDeCiudades.ts`) para que la primera pantalla pueda buscar en los municipios de las
 * capas de provincia sin descargarla.
 */

/** Los habitantes que necesita un municipio para estar en la tabla. */
export const MINIMO_DE_HABITANTES = 20_000;

/**
 * Lo más lejos, en grados, que puede quedar el rótulo de la etiqueta del municipio que nombra:
 * unos 50 km. El punto de OpenStreetMap y la etiqueta del IGN no coinciden, y en un municipio
 * grande pueden quedar a decenas de kilómetros.
 */
export const DISTANCIA_MAXIMA_GRADOS = 0.5;

/** Los municipios por su nombre de lugar: dónde está su etiqueta y cuántos habitantes tienen. */
export type IndiceDeCiudades = ReadonlyMap<
  string,
  ReadonlyArray<{ readonly etiqueta: Coordenada; readonly habitantes: number }>
>;

/** Un índice por nombre de unas ciudades, para buscar con `habitantesDeRotulo`. */
export const indiceDeCiudades = (
  ciudades: ReadonlyArray<{
    readonly nombre: string;
    readonly etiqueta: Coordenada;
    readonly habitantes: number;
  }>,
): IndiceDeCiudades => {
  const indice = new Map<string, Array<{ etiqueta: Coordenada; habitantes: number }>>();
  for (const { nombre, etiqueta, habitantes } of ciudades) {
    const suyas = indice.get(nombre) ?? [];
    suyas.push({ etiqueta, habitantes });
    indice.set(nombre, suyas);
  }
  return indice;
};

/**
 * Los habitantes del municipio que nombra un rótulo: el de su mismo nombre más cercano a menos de
 * `DISTANCIA_MAXIMA_GRADOS`. Busca en cada índice y se queda con lo que dé el primero que lo
 * tiene. 0 si ninguno lo tiene.
 */
export const habitantesDeRotulo = (
  texto: string,
  posicion: Coordenada,
  ...indices: ReadonlyArray<IndiceDeCiudades>
): number => {
  for (const indice of indices) {
    let mejor: number | undefined;
    let distancia = DISTANCIA_MAXIMA_GRADOS;
    for (const { etiqueta, habitantes } of indice.get(texto) ?? []) {
      const d = Math.hypot(
        etiqueta.longitud - posicion.longitud,
        etiqueta.latitud - posicion.latitud,
      );
      if (d <= distancia) {
        distancia = d;
        mejor = habitantes;
      }
    }
    if (mejor !== undefined) return mejor;
  }
  return 0;
};
