import * as Schema from "effect/Schema";

import datos from "../datos/habitantes-de-ciudades.json" with { type: "json" };
import { FuenteDePoblacion } from "./poblacion.ts";
import { indiceDeCiudades, type IndiceDeCiudades } from "./poblacionDeRotulos.ts";

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

/** Una ciudad: su nombre de lugar, el punto de su capital y sus habitantes. */
export const Ciudad = Schema.Tuple([Schema.String, Schema.Finite, Schema.Finite, Schema.Int]);
export type Ciudad = typeof Ciudad.Type;

/** La tabla, con la fuente del padrón. */
export const HabitantesDeCiudades = Schema.Struct({
  padron: FuenteDePoblacion,
  minimo: Schema.Int,
  ciudades: Schema.Array(Ciudad),
});
export type HabitantesDeCiudades = typeof HabitantesDeCiudades.Type;

/** El índice de la tabla del repositorio. */
export const CIUDADES: IndiceDeCiudades = indiceDeCiudades(
  datos.ciudades.map(([nombre, longitud, latitud, habitantes]) => ({
    nombre: String(nombre),
    etiqueta: { longitud: Number(longitud), latitud: Number(latitud) },
    habitantes: Number(habitantes),
  })),
);
