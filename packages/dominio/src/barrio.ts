import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Compania } from "./compania.ts";

/** Un vértice en grados WGS84, en el orden de GeoJSON: longitud y latitud. */
const Vertice = Schema.Tuple([Schema.Finite, Schema.Finite]);

/** Un anillo de un polígono. Puede repetir o no el primer vértice al final. */
export const Anillo = Schema.Array(Vertice);
export type Anillo = typeof Anillo.Type;

/** Un polígono: el anillo exterior y, detrás, sus agujeros. */
export const Poligono = Schema.Array(Anillo);
export type Poligono = typeof Poligono.Type;

/** Un barrio de Barcelona: su código oficial, su nombre y dónde va su etiqueta en el mapa. */
export const Barrio = Schema.Struct({
  /** Código del Ayuntamiento, de «01» a «73». */
  codigo: Schema.String,
  nombre: Schema.String,
  /** Un punto dentro del barrio, cerca de su centro. */
  etiqueta: Coordenada,
});
export type Barrio = typeof Barrio.Type;

/** Un barrio con su límite, uno o varios polígonos. */
export const LimiteDeBarrio = Schema.Struct({
  ...Barrio.fields,
  poligonos: Schema.Array(Poligono),
});
export type LimiteDeBarrio = typeof LimiteDeBarrio.Type;

/** De dónde salen los límites de barrio: lo que hay que citar al usarlos. */
export const FuenteDeBarrios = Schema.Struct({
  atribucion: Schema.String,
  licencia: Schema.String,
  /** Página del conjunto de datos. */
  enlace: Schema.String,
  /** Fecha de los datos según la fuente, `AAAA-MM-DD`. */
  fecha: Schema.String,
});
export type FuenteDeBarrios = typeof FuenteDeBarrios.Type;

/** Los límites de todos los barrios, con su fuente. */
export const LimitesDeBarrios = Schema.Struct({
  fuente: FuenteDeBarrios,
  barrios: Schema.Array(LimiteDeBarrio),
});
export type LimitesDeBarrios = typeof LimitesDeBarrios.Type;

/**
 * Si el punto cae dentro del anillo, por el número de cruces de un rayo hacia el este. Los
 * bordes son semiabiertos: un punto sobre el lado que comparten dos anillos vecinos cae en uno
 * solo de ellos.
 */
const dentroDelAnillo = (x: number, y: number, anillo: Anillo): boolean => {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i++) {
    const [xi = 0, yi = 0] = anillo[i] ?? [];
    const [xj = 0, yj = 0] = anillo[j] ?? [];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
};

/** Si el punto cae dentro del polígono: en su anillo exterior y fuera de sus agujeros. */
export const dentroDelPoligono = (punto: Coordenada, poligono: Poligono): boolean => {
  const [exterior, ...agujeros] = poligono;
  const { longitud: x, latitud: y } = punto;
  return (
    exterior !== undefined &&
    dentroDelAnillo(x, y, exterior) &&
    !agujeros.some((agujero) => dentroDelAnillo(x, y, agujero))
  );
};

/**
 * El barrio en que cae un punto, o `undefined` si no cae en ninguno, como un emplazamiento de
 * L'Hospitalet. Si dos límites se solapan, gana el primero de la lista, así que el resultado no
 * depende de nada más que de los datos.
 */
export const barrioDelPunto = (
  punto: Coordenada,
  limites: ReadonlyArray<LimiteDeBarrio>,
): LimiteDeBarrio | undefined =>
  limites.find((limite) => limite.poligonos.some((p) => dentroDelPoligono(punto, p)));

/** Lo que se cuenta de un barrio a partir de la capa. */
export interface ResumenDeBarrio {
  readonly barrio: Barrio;
  /** Cuántos emplazamientos caen en el barrio. */
  readonly emplazamientos: number;
  /** Compañías de la capa sin ningún emplazamiento en el barrio, en el orden de `companias`. */
  readonly ausentes: ReadonlyArray<Compania>;
}

/** Lo que el resumen necesita de cada emplazamiento. */
export interface EmplazamientoConBarrio {
  /** Código del barrio en que cae, o `null` si queda fuera de Barcelona. */
  readonly barrio: string | null;
  readonly companias: ReadonlyArray<Compania>;
}

/**
 * Cuántos emplazamientos tiene cada barrio y qué compañías no tienen ninguno allí (sus
 * ausencias). Solo cuentan como ausentes las compañías que tienen algún emplazamiento en la capa:
 * de una que no aparece en ninguna parte no se puede decir que falte en un barrio. `companias` da
 * el orden en que salen las ausencias.
 */
export const resumirBarrios = (
  barrios: ReadonlyArray<Barrio>,
  emplazamientos: ReadonlyArray<EmplazamientoConBarrio>,
  companias: ReadonlyArray<Compania> = Compania.literals,
): ReadonlyArray<ResumenDeBarrio> => {
  const enLaCapa = new Set<Compania>();
  const porBarrio = new Map<string, { cuantos: number; presentes: Set<Compania> }>();
  for (const emplazamiento of emplazamientos) {
    for (const compania of emplazamiento.companias) enLaCapa.add(compania);
    if (emplazamiento.barrio === null) continue;
    const cuenta = porBarrio.get(emplazamiento.barrio) ?? { cuantos: 0, presentes: new Set() };
    cuenta.cuantos += 1;
    for (const compania of emplazamiento.companias) cuenta.presentes.add(compania);
    porBarrio.set(emplazamiento.barrio, cuenta);
  }
  return barrios.map((barrio) => {
    const cuenta = porBarrio.get(barrio.codigo);
    return {
      barrio,
      emplazamientos: cuenta?.cuantos ?? 0,
      ausentes: companias.filter((c) => enLaCapa.has(c) && cuenta?.presentes.has(c) !== true),
    };
  });
};
