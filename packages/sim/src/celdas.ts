import * as Schema from "effect/Schema";

import { type Poligono, recortar } from "./poligono.ts";
import { diferenciaDeRumbo, type Malla, puntosDe, type Simulacion } from "./simulacion.ts";

/** Un punto del plano de la malla, en metros al este y al norte de su origen. */
export const PuntoDelPlano = Schema.Struct({ este: Schema.Finite, norte: Schema.Finite });
export type PuntoDelPlano = typeof PuntoDelPlano.Type;

/** Un rectángulo del plano de la malla, en metros. */
export const CajaDelPlano = Schema.Struct({
  oeste: Schema.Finite,
  sur: Schema.Finite,
  este: Schema.Finite,
  norte: Schema.Finite,
}).check(
  Schema.makeFilter(
    (caja) => (caja.oeste < caja.este && caja.sur < caja.norte) || "la caja no tiene ancho o alto",
  ),
);
export type CajaDelPlano = typeof CajaDelPlano.Type;

/** Los emplazamientos, en el plano de la malla, y la caja a la que se recortan sus celdas. */
export const ParamsCeldas = Schema.Struct({
  emplazamientos: Schema.Array(PuntoDelPlano),
  caja: CajaDelPlano,
});
export type ParamsCeldas = typeof ParamsCeldas.Type;

export type ResultadoCeldas = {
  /**
   * Los vértices de todas las celdas seguidos, este y norte alternos, cada celda en sentido
   * antihorario y sin repetir su primer vértice.
   */
  readonly vertices: Float64Array;
  /**
   * La celda del emplazamiento `k` son los vértices de `inicio[k]` a `inicio[k + 1]`, sin incluir
   * el último. Tiene `emplazamientos + 1` valores. Una celda sin vértices está vacía: la de un
   * emplazamiento repetido (se la queda el primero) o la de uno tan lejos de la caja que no le
   * toca nada.
   */
  readonly inicio: Uint32Array;
  /**
   * Para cada punto de la malla, el emplazamiento más cercano, que es aquel en cuya celda cae; en
   * un empate, el primero. −1 si el punto queda fuera de la caja o no hay emplazamientos.
   */
  readonly celda: Int32Array;
};

/**
 * Casillas cuadradas con los emplazamientos que caen en cada una, para no comparar cada
 * emplazamiento con todos los demás: el más cercano a un punto o los que recortan una celda se
 * buscan por anillos de casillas cada vez más lejanos, y se para en cuanto ninguno de los que
 * faltan puede cambiar nada.
 */
interface Rejilla {
  readonly oeste: number;
  readonly sur: number;
  readonly lado: number;
  readonly columnas: number;
  readonly filas: number;
  /** Los emplazamientos de la casilla `c` son `indices[primero[c]]` a `indices[primero[c + 1] - 1]`. */
  readonly primero: Uint32Array;
  readonly indices: Uint32Array;
}

const rejillaDe = (este: ReadonlyArray<number>, norte: ReadonlyArray<number>): Rejilla => {
  const n = este.length;
  const oeste = Math.min(...este);
  const sur = Math.min(...norte);
  const ancho = Math.max(...este) - oeste;
  const alto = Math.max(...norte) - sur;
  // Un emplazamiento por casilla de media; con todos en fila, n casillas a lo largo.
  const lado = Math.max(Math.sqrt((ancho * alto) / n), Math.max(ancho, alto) / n, 1e-6);
  const columnas = Math.floor(ancho / lado) + 1;
  const filas = Math.floor(alto / lado) + 1;
  const casillaDe = (k: number) =>
    columna(lado, oeste, columnas, este[k] ?? 0) +
    columnas * columna(lado, sur, filas, norte[k] ?? 0);
  const primero = new Uint32Array(columnas * filas + 1);
  for (let k = 0; k < n; k++) {
    const siguiente = casillaDe(k) + 1;
    primero[siguiente] = (primero[siguiente] ?? 0) + 1;
  }
  for (let c = 0; c < columnas * filas; c++) {
    primero[c + 1] = (primero[c + 1] ?? 0) + (primero[c] ?? 0);
  }
  const libre = primero.slice(0, -1);
  const indices = new Uint32Array(n);
  for (let k = 0; k < n; k++) {
    const c = casillaDe(k);
    indices[libre[c] ?? 0] = k;
    libre[c] = (libre[c] ?? 0) + 1;
  }
  return { oeste, sur, lado, columnas, filas, primero, indices };
};

/** La columna (o fila) de la rejilla en que cae una coordenada, pegada al borde si queda fuera. */
const columna = (lado: number, desde: number, cuantas: number, valor: number): number =>
  Math.min(cuantas - 1, Math.max(0, Math.floor((valor - desde) / lado)));

/**
 * Recorre un punto de la rejilla por anillos de casillas: primero la suya, después las ocho de
 * alrededor, y así. Tras visitar el anillo `r`, todo emplazamiento que falta está a `r · lado`
 * metros o más del punto. `seguir` recibe cada emplazamiento del anillo y, al acabarlo, ese
 * `r · lado`; si devuelve `false`, se para.
 */
const porAnillos = (
  rejilla: Rejilla,
  este: number,
  norte: number,
  visitar: (k: number) => void,
  seguir: (distanciaQueFalta: number) => boolean,
): void => {
  const { columnas, filas, primero, indices } = rejilla;
  const c0 = columna(rejilla.lado, rejilla.oeste, columnas, este);
  const f0 = columna(rejilla.lado, rejilla.sur, filas, norte);
  const ultimo = Math.max(c0, columnas - 1 - c0, f0, filas - 1 - f0);
  const casilla = (c: number, f: number) => {
    if (c < 0 || c >= columnas || f < 0 || f >= filas) return;
    const i = c + columnas * f;
    for (let j = primero[i] ?? 0; j < (primero[i + 1] ?? 0); j++) visitar(indices[j] ?? 0);
  };
  for (let r = 0; r <= ultimo; r++) {
    if (r === 0) {
      casilla(c0, f0);
    } else {
      for (let c = c0 - r; c <= c0 + r; c++) {
        casilla(c, f0 - r);
        casilla(c, f0 + r);
      }
      for (let f = f0 - r + 1; f <= f0 + r - 1; f++) {
        casilla(c0 - r, f);
        casilla(c0 + r, f);
      }
    }
    if (!seguir(r * rejilla.lado)) return;
  }
};

/** Distancia del vértice más lejano de un polígono al origen. */
const radio = (poligono: ReadonlyArray<number>): number => {
  let maximo = 0;
  for (let i = 0; i < poligono.length; i += 2) {
    maximo = Math.max(maximo, Math.hypot(poligono[i] ?? 0, poligono[i + 1] ?? 0));
  }
  return maximo;
};

/**
 * La celda del emplazamiento `k`: la caja recortada por la mediatriz con cada vecino. Se calcula
 * con el emplazamiento en el origen, para no perder precisión con coordenadas grandes.
 */
const celdaDe = (
  k: number,
  este: ReadonlyArray<number>,
  norte: ReadonlyArray<number>,
  caja: CajaDelPlano,
  rejilla: Rejilla,
): ReadonlyArray<number> => {
  const pe = este[k] ?? 0;
  const pn = norte[k] ?? 0;
  let poligono: ReadonlyArray<number> = [
    caja.oeste - pe,
    caja.sur - pn,
    caja.este - pe,
    caja.sur - pn,
    caja.este - pe,
    caja.norte - pn,
    caja.oeste - pe,
    caja.norte - pn,
  ];
  porAnillos(
    rejilla,
    pe,
    pn,
    (q) => {
      if (q === k || poligono.length === 0) return;
      const de = (este[q] ?? 0) - pe;
      const dn = (norte[q] ?? 0) - pn;
      if (de === 0 && dn === 0) {
        // Dos emplazamientos en el mismo punto: la celda es del primero.
        if (q < k) poligono = [];
        return;
      }
      // Lo que queda del lado de este emplazamiento en la mediatriz con `q`.
      poligono = recortar(poligono, de, dn, (de * de + dn * dn) / 2);
    },
    // Un vecino a distancia d solo recorta la celda si d / 2 es menor que su radio.
    (queFalta) => poligono.length > 0 && queFalta < 2 * radio(poligono),
  );
  return poligono.map((valor, i) => valor + (i % 2 === 0 ? pe : pn));
};

const masCercano = (
  e: number,
  n: number,
  este: ReadonlyArray<number>,
  norte: ReadonlyArray<number>,
  rejilla: Rejilla,
): number => {
  let mejor = -1;
  let distancia = Infinity;
  porAnillos(
    rejilla,
    e,
    n,
    (k) => {
      const d = Math.hypot((este[k] ?? 0) - e, (norte[k] ?? 0) - n);
      if (d < distancia || (d === distancia && k < mejor)) {
        mejor = k;
        distancia = d;
      }
    },
    (queFalta) => queFalta <= distancia,
  );
  return mejor;
};

/**
 * Celdas de Voronoi: la zona de la caja en la que cada emplazamiento es el más cercano. Es un
 * modelo geométrico, sin propagación: supone que todos los emplazamientos emiten igual y que la
 * señal solo depende de la distancia. Las celdas cubren la caja entera sin solaparse.
 *
 * Cada celda es la caja recortada por la mediatriz entre su emplazamiento y cada uno de los
 * demás (Okabe, Boots, Sugihara y Chiu, «Spatial Tessellations», 2.ª ed., apartado 2.1). Los
 * vecinos se buscan por anillos en una rejilla y se para cuando ninguno de los que faltan puede
 * recortar más, así que con los emplazamientos repartidos cuesta del orden de n.
 *
 * La malla es opcional: de cada punto dice en qué celda cae. Con una malla vacía solo se
 * calculan las celdas.
 */
export const celdas: Simulacion<ParamsCeldas, ResultadoCeldas> = {
  id: "celdas",
  version: "1",
  params: ParamsCeldas,
  ejecutar: (p: ParamsCeldas, malla: Malla): ResultadoCeldas => {
    const n = p.emplazamientos.length;
    const este = p.emplazamientos.map((e) => e.este);
    const norte = p.emplazamientos.map((e) => e.norte);
    const puntos = puntosDe(malla);
    if (n === 0) {
      return {
        vertices: new Float64Array(0),
        inicio: new Uint32Array(1),
        celda: new Int32Array(puntos).fill(-1),
      };
    }
    const rejilla = rejillaDe(este, norte);

    const poligonos = Array.from({ length: n }, (_, k) => celdaDe(k, este, norte, p.caja, rejilla));
    const inicio = new Uint32Array(n + 1);
    for (const [k, poligono] of poligonos.entries()) {
      inicio[k + 1] = (inicio[k] ?? 0) + poligono.length / 2;
    }
    const vertices = new Float64Array(2 * (inicio[n] ?? 0));
    for (const [k, poligono] of poligonos.entries()) vertices.set(poligono, 2 * (inicio[k] ?? 0));

    const celda = new Int32Array(puntos);
    for (let i = 0; i < puntos; i++) {
      const e = malla.este[i] ?? 0;
      const m = malla.norte[i] ?? 0;
      const dentro = e >= p.caja.oeste && e <= p.caja.este && m >= p.caja.sur && m <= p.caja.norte;
      celda[i] = dentro ? masCercano(e, m, este, norte, rejilla) : -1;
    }
    return { vertices, inicio, celda };
  },
};

/** La celda del emplazamiento `k` de un resultado, sin copiarla. */
export const poligonoDe = (resultado: ResultadoCeldas, k: number): Poligono =>
  resultado.vertices.subarray(2 * (resultado.inicio[k] ?? 0), 2 * (resultado.inicio[k + 1] ?? 0));

/** Rumbo en [0, 360). */
const normalizar = (rumbo: number): number => ((rumbo % 360) + 360) % 360;

const vector = (rumbo: number): readonly [number, number] => {
  const radianes = (rumbo * Math.PI) / 180;
  return [Math.sin(radianes), Math.cos(radianes)];
};

/** Si el punto está dentro de un polígono convexo en sentido antihorario, sin tocar su borde. */
const dentroDelConvexo = (poligono: Poligono, e: number, n: number): boolean => {
  const m = poligono.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ae = poligono[2 * i] ?? 0;
    const an = poligono[2 * i + 1] ?? 0;
    const cruz =
      ((poligono[2 * j] ?? 0) - ae) * (n - an) - ((poligono[2 * j + 1] ?? 0) - an) * (e - ae);
    if (!(cruz > 0)) return false;
  }
  return true;
};

/** Por qué lado sale un rayo de un polígono y en qué punto de ese lado, de 0 a 1. */
interface Salida {
  readonly lado: number;
  readonly fraccion: number;
}

/**
 * Dónde sale del polígono el rayo que parte de `(e, n)` con dirección `(ue, un)`: el lado por el
 * que sale y cuánto ha recorrido de ese lado (de 0 a 1). Al recorrer el borde en sentido
 * antihorario, el rayo queda a la derecha del vértice de salida y a la izquierda del siguiente.
 */
const salida = (poligono: Poligono, e: number, n: number, ue: number, un: number): Salida => {
  const m = poligono.length / 2;
  const cruz = (i: number) =>
    ue * ((poligono[2 * i + 1] ?? 0) - n) - un * ((poligono[2 * i] ?? 0) - e);
  for (let i = 0; i < m; i++) {
    const a = cruz(i);
    const b = cruz((i + 1) % m);
    if (a <= 0 && b > 0) return { lado: i, fraccion: a / (a - b) };
  }
  // Con el punto dentro del polígono convexo no se llega aquí.
  return { lado: 0, fraccion: 0 };
};

const puntoDelLado = (poligono: Poligono, lado: number, fraccion: number): [number, number] => {
  const m = poligono.length / 2;
  const j = (lado + 1) % m;
  const ae = poligono[2 * lado] ?? 0;
  const an = poligono[2 * lado + 1] ?? 0;
  return [
    ae + fraccion * ((poligono[2 * j] ?? 0) - ae),
    an + fraccion * ((poligono[2 * j + 1] ?? 0) - an),
  ];
};

/**
 * La parte de la celda entre dos rumbos vistos desde el emplazamiento, de `desde` a `hasta` en el
 * sentido de las agujas del reloj. Como la celda es convexa y el emplazamiento está dentro, es el
 * emplazamiento más el trozo de borde entre los dos rayos.
 */
const cuna = (celda: Poligono, e: number, n: number, desde: number, hasta: number): Poligono => {
  const m = celda.length / 2;
  // En sentido antihorario el rumbo baja: se va del rayo de `hasta` al de `desde`.
  const [he, hn] = vector(hasta);
  const [de, dn] = vector(desde);
  const inicio = salida(celda, e, n, he, hn);
  const fin = salida(celda, e, n, de, dn);
  const puntos: Array<number> = [e, n, ...puntoDelLado(celda, inicio.lado, inicio.fraccion)];
  const anadir = (pe: number, pn: number) => {
    if (pe !== puntos[puntos.length - 2] || pn !== puntos[puntos.length - 1]) puntos.push(pe, pn);
  };
  const sinVertices = inicio.lado === fin.lado && fin.fraccion >= inicio.fraccion;
  if (!sinVertices) {
    for (let k = (inicio.lado + 1) % m; ; k = (k + 1) % m) {
      anadir(celda[2 * k] ?? 0, celda[2 * k + 1] ?? 0);
      if (k === fin.lado) break;
    }
  }
  anadir(...puntoDelLado(celda, fin.lado, fin.fraccion));
  return Float64Array.from(puntos);
};

/**
 * Reparte la celda de un emplazamiento entre los sectores de su estación base: a cada punto le
 * toca el sector cuyo eje queda más cerca de su rumbo visto desde el emplazamiento, y en un
 * empate, el primero. Con sectores iguales es el que más ganancia le da en el diagrama de sector,
 * así que coincide con el sector que da servicio.
 *
 * Devuelve un polígono por azimut, en su orden. No tienen por qué ser convexos (un sector de más
 * de 180° no lo es), pero juntos cubren la celda sin solaparse. Un azimut repetido se queda sin
 * polígono: su zona es del primero. Si el emplazamiento no está dentro de su celda, que solo pasa
 * si queda fuera de la caja, no hay reparto y todos salen vacíos.
 */
export const repartirEnSectores = (
  celda: Poligono,
  emplazamiento: PuntoDelPlano,
  azimuts: ReadonlyArray<number>,
): ReadonlyArray<Poligono> => {
  const vacio = () => new Float64Array(0);
  if (celda.length < 6 || !dentroDelConvexo(celda, emplazamiento.este, emplazamiento.norte)) {
    return azimuts.map(vacio);
  }
  // Un solo representante por rumbo, el primero que lo tiene, ordenados de 0 a 360.
  const unicos = [...new Map(azimuts.map((a, k) => [normalizar(a), k] as const).toReversed())]
    .map(([rumbo, k]) => ({ rumbo, k }))
    .toSorted((a, b) => a.rumbo - b.rumbo);
  const resultado: Array<Poligono> = azimuts.map(vacio);
  if (unicos.length === 1) {
    resultado[unicos[0]?.k ?? 0] = celda.slice();
    return resultado;
  }
  for (const [i, { rumbo, k }] of unicos.entries()) {
    const anterior = unicos[i - 1]?.rumbo ?? (unicos.at(-1)?.rumbo ?? 0) - 360;
    const siguiente = unicos[i + 1]?.rumbo ?? (unicos[0]?.rumbo ?? 0) + 360;
    // Los límites son las bisectrices con los ejes de al lado.
    resultado[k] = cuna(
      celda,
      emplazamiento.este,
      emplazamiento.norte,
      normalizar((anterior + rumbo) / 2),
      normalizar((rumbo + siguiente) / 2),
    );
  }
  return resultado;
};

/** El índice del azimut más cercano a un rumbo; en un empate, el primero. */
export const sectorDeRumbo = (rumbo: number, azimuts: ReadonlyArray<number>): number => {
  let mejor = -1;
  let desviacion = Infinity;
  for (const [k, azimut] of azimuts.entries()) {
    const d = Math.abs(diferenciaDeRumbo(rumbo, azimut));
    if (d < desviacion) {
      mejor = k;
      desviacion = d;
    }
  }
  return mejor;
};
