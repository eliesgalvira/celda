import type * as Schema from "effect/Schema";

/**
 * Los arrays en que una simulación devuelve su resultado. Pasan del Worker al hilo principal sin
 * copiarse y se comparan uno a uno con los ficheros de referencia.
 */
export type ArrayTipado =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;

/** Lo que devuelve una simulación: arrays tipados con nombre. */
export type Resultado = Readonly<Record<string, ArrayTipado>>;

/**
 * Los puntos donde se calcula una simulación, en un plano local en metros alrededor de un origen
 * que elige quien la llama: el emplazamiento, para el diagrama y las pérdidas, o una esquina de la
 * zona, para una vista con varias estaciones base. El punto `i` es `(este[i], norte[i])`.
 */
export interface Malla {
  /** Metros hacia el este desde el origen. */
  readonly este: Float64Array;
  /** Metros hacia el norte desde el origen. */
  readonly norte: Float64Array;
}

/**
 * Un cálculo con un modelo (ADR 0005). `ejecutar` es pura: el mismo `p` y la misma malla dan
 * siempre el mismo resultado, sin leer la hora, el azar ni nada de fuera. `params` es también el
 * formato con que los parámetros viajan al Worker y se guardan en los ficheros de referencia.
 *
 * Cambiar lo que calcula una simulación obliga a subir `version`: los resultados de referencia de
 * la versión anterior ya no valen, y la interfaz enseña la versión junto al resultado.
 */
export interface Simulacion<Params, R extends Resultado> {
  readonly id: string;
  readonly version: string;
  readonly params: Schema.Codec<Params, Schema.Json>;
  readonly ejecutar: (p: Params, malla: Malla) => R;
}

/** Cuántos puntos tiene la malla. */
export const puntosDe = (malla: Malla): number => malla.este.length;

/** Rumbo del punto `i` visto desde el origen, en grados desde el norte hacia el este, en [0, 360). */
export const rumboDe = (malla: Malla, i: number): number => {
  const grados = (Math.atan2(malla.este[i] ?? 0, malla.norte[i] ?? 0) * 180) / Math.PI;
  return grados < 0 ? grados + 360 : grados;
};

/** Distancia del punto `i` al origen, en metros. */
export const distanciaDe = (malla: Malla, i: number): number =>
  Math.hypot(malla.este[i] ?? 0, malla.norte[i] ?? 0);

/** Diferencia con signo entre dos rumbos, en (−180, 180]. */
export const diferenciaDeRumbo = (a: number, b: number): number => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

/**
 * Una malla con un punto por rumbo, a un metro del origen: la del diagrama de radiación. Los
 * rumbos van de 0 a 360 (sin incluirlo) cada `paso` grados.
 */
export const mallaDeRumbos = (paso: number): Malla => {
  const n = Math.round(360 / paso);
  const este = new Float64Array(n);
  const norte = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const radianes = (i * paso * Math.PI) / 180;
    este[i] = Math.sin(radianes);
    norte[i] = Math.cos(radianes);
  }
  return { este, norte };
};

/** Una malla con puntos a las `distancias` dadas, en metros, todos en el mismo `rumbo`. */
export const mallaEnRumbo = (rumbo: number, distancias: ReadonlyArray<number>): Malla => {
  const radianes = (rumbo * Math.PI) / 180;
  return {
    este: Float64Array.from(distancias, (d) => d * Math.sin(radianes)),
    norte: Float64Array.from(distancias, (d) => d * Math.cos(radianes)),
  };
};

/** Un rectángulo del plano, en metros. */
export interface Rectangulo {
  readonly oeste: number;
  readonly sur: number;
  readonly este: number;
  readonly norte: number;
}

/**
 * Los centros de una trama de hexágonos con un vértice arriba, de `radio` metros del centro a
 * cada vértice, que caen dentro del rectángulo. La trama está anclada al origen del plano (hay un
 * centro en 0, 0): dos rectángulos que se solapan dan los mismos centros en la parte común, así
 * que al mover el mapa los hexágonos no bailan. Las filas van de sur a norte y, dentro de cada
 * fila, de oeste a este.
 */
export const mallaHexagonal = (rectangulo: Rectangulo, radio: number): Malla => {
  const paso = Math.sqrt(3) * radio;
  const alto = 1.5 * radio;
  const este: Array<number> = [];
  const norte: Array<number> = [];
  for (let fila = Math.ceil(rectangulo.sur / alto); fila * alto <= rectangulo.norte; fila++) {
    // Las filas impares van medio paso a la derecha.
    const desplazamiento = Math.abs(fila % 2) * (paso / 2);
    const primera = Math.ceil((rectangulo.oeste - desplazamiento) / paso);
    for (let columna = primera; columna * paso + desplazamiento <= rectangulo.este; columna++) {
      este.push(columna * paso + desplazamiento);
      norte.push(fila * alto);
    }
  }
  return { este: Float64Array.from(este), norte: Float64Array.from(norte) };
};
