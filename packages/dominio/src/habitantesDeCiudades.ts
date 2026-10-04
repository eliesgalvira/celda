import * as Schema from "effect/Schema";

import datos from "../datos/habitantes-de-ciudades.json" with { type: "json" };
import type { Coordenada } from "./area.ts";
import { FuenteDePoblacion } from "./poblacion.ts";

/**
 * Los habitantes de las ciudades que rotula el mapa base, para la regla de choques (ADR 0024): un
 * rótulo de ciudad compite con los hexágonos por los habitantes del municipio que nombra. El mapa
 * base no trae código INE, así que el rótulo se busca por su texto, que es el nombre de lugar
 * (ADR 0025), y por su posición. Uno que no casa con ningún municipio, como uno de fuera de
 * España, cuenta 0.
 *
 * La tabla solo lleva los municipios de `MINIMO_DE_HABITANTES` o más: son las ciudades que el mapa
 * base rotula de lejos, y pesa unos 7 KB con gzip. De cerca, la web usa también los municipios de
 * las capas de provincia que han llegado, que los tienen todos. La escribe `pnpm run centros` en
 * `tools/capas` desde los límites y el padrón del repositorio. La importa el código del mapa, no
 * la primera pantalla.
 */

/** Los habitantes que necesita un municipio para estar en la tabla. */
export const MINIMO_DE_HABITANTES = 20_000;

/**
 * Lo más lejos, en grados, que puede quedar el rótulo de la etiqueta del municipio que nombra:
 * unos 50 km. El punto de OpenStreetMap y la etiqueta del IGN no coinciden, y en un municipio
 * grande pueden quedar a decenas de kilómetros.
 */
export const DISTANCIA_MAXIMA_GRADOS = 0.5;

/** Una ciudad: su nombre de lugar, la etiqueta de su municipio y sus habitantes. */
export const Ciudad = Schema.Tuple([Schema.String, Schema.Finite, Schema.Finite, Schema.Int]);
export type Ciudad = typeof Ciudad.Type;

/** La tabla, con la fuente del padrón. */
export const HabitantesDeCiudades = Schema.Struct({
  padron: FuenteDePoblacion,
  minimo: Schema.Int,
  ciudades: Schema.Array(Ciudad),
});
export type HabitantesDeCiudades = typeof HabitantesDeCiudades.Type;

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

/** El índice de la tabla del repositorio. */
export const CIUDADES: IndiceDeCiudades = indiceDeCiudades(
  datos.ciudades.map(([nombre, longitud, latitud, habitantes]) => ({
    nombre: String(nombre),
    etiqueta: { longitud: Number(longitud), latitud: Number(latitud) },
    habitantes: Number(habitantes),
  })),
);

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
