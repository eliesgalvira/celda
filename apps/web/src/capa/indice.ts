import type { Coordenada } from "@celda/dominio/area";
import KDBush from "kdbush";
import Supercluster from "supercluster";

/**
 * El índice de supercluster de una capa de provincia, que se construye en un Worker y se
 * rehidrata en el hilo principal (ADR 0016). supercluster 9.1 guarda cada nivel de zoom en un
 * KDBush sobre un `ArrayBuffer` y los datos de sus agrupaciones en un `Int32Array`: el Worker
 * devuelve esos búferes transferidos y aquí se vuelve a montar un `Supercluster` con ellos, sin
 * agrupar otra vez. Las escenas y las transiciones siguen siendo síncronas.
 *
 * Depende de cómo guarda sus árboles la versión 9.1.0, fijada exacta en el catálogo. Las pruebas
 * de `agrupacion.test.ts` comparan las escenas y las transiciones del índice rehidratado con las
 * del construido en el hilo: si una versión nueva cambia algo, fallan.
 */

/**
 * Distancia en píxeles de pantalla por debajo de la cual se agrupa, en el zoom entero del nivel.
 * Con 48 salían más logos sueltos a zoom medio, pero con un tercio más de nodos el móvil simulado
 * bajaba de 55 a 51 fps al cruzar niveles. Con 60 nada se pisa: el hexágono mide 50 px.
 */
export const RADIO = 60;

/** Último nivel con agrupaciones. En el siguiente y más cerca, todos los emplazamientos van sueltos. */
export const NIVEL_MAXIMO = 16;

export interface PropiedadesDePunto {
  /** La posición del emplazamiento en su capa. */
  readonly indice: number;
}

type PropiedadesDeAgrupacion = Record<string, never>;

/** Un nivel de zoom del índice: el KDBush con los datos de sus puntos y agrupaciones al lado. */
type Arbol = Omit<KDBush, "data"> & { readonly data: Int32Array<ArrayBuffer> };

/**
 * supercluster con sus detalles internos a la vista: `_getOriginZoom` (el identificador de una
 * agrupación lleva el nivel siguiente a aquel en que se formó) y los campos que hay que rellenar
 * para rehidratarlo.
 */
export class Indice extends Supercluster<PropiedadesDePunto, PropiedadesDeAgrupacion> {
  declare _getOriginZoom: (id: number) => number;
  declare trees: Array<Arbol | undefined>;
  declare numPoints: number;
  declare stride: number;
  declare coords: Float64Array<ArrayBuffer>;
  declare props: Array<PropiedadesDePunto>;
  declare ids: Array<unknown> | null;
  declare clusterProps: Array<unknown>;
}

const nuevoIndice = (): Indice => new Indice({ radius: RADIO, maxZoom: NIVEL_MAXIMO });

/** Un índice con las posiciones de `indices` dentro de `posiciones`. */
export const indexar = (
  posiciones: ReadonlyArray<Coordenada>,
  indices: ReadonlyArray<number>,
): Indice => {
  const indice = nuevoIndice();
  indice.load(
    indices.map((i) => {
      const { longitud, latitud } = posiciones[i] ?? { longitud: 0, latitud: 0 };
      return {
        type: "Feature",
        properties: { indice: i },
        geometry: { type: "Point", coordinates: [longitud, latitud] },
      };
    }),
  );
  return indice;
};

/** Un nivel serializado: su KDBush entero y la vista de sus datos. */
interface ArbolSerializado {
  readonly kd: ArrayBuffer;
  readonly datos: Int32Array<ArrayBuffer>;
}

/** Un nivel que es el mismo árbol que el del nivel `mismo`. */
interface ArbolRepetido {
  readonly mismo: number;
}

/**
 * Un índice listo para `postMessage`: sus niveles, sus coordenadas y cuántos puntos tiene. Los
 * búferes van en la lista de transferibles, así que no se copian.
 */
export interface IndiceSerializado {
  readonly numPoints: number;
  readonly stride: number;
  readonly coords: Float64Array<ArrayBuffer>;
  readonly arboles: ReadonlyArray<ArbolSerializado | ArbolRepetido | null>;
}

/** Un índice serializado con los búferes que se transfieren con él. */
export interface IndiceParaEnviar {
  readonly serializado: IndiceSerializado;
  readonly transferibles: ReadonlyArray<ArrayBuffer>;
}

/** Serializa un índice y dice qué búferes se pueden transferir. Deja el índice inservible. */
export const serializarIndice = (indice: Indice): IndiceParaEnviar => {
  const buferes = new Set<ArrayBuffer>([indice.coords.buffer]);
  const vistos = new Map<Arbol, number>();
  const arboles = Array.from(
    { length: indice.trees.length },
    (_, z): ArbolSerializado | ArbolRepetido | null => {
      const arbol = indice.trees[z];
      if (arbol === undefined) return null;
      const mismo = vistos.get(arbol);
      if (mismo !== undefined) return { mismo };
      vistos.set(arbol, z);
      const kd = arbol.ids.buffer;
      buferes.add(kd);
      buferes.add(arbol.data.buffer);
      return { kd, datos: arbol.data };
    },
  );
  return {
    serializado: {
      numPoints: indice.numPoints,
      stride: indice.stride,
      coords: indice.coords,
      arboles,
    },
    transferibles: [...buferes],
  };
};

/**
 * Vuelve a montar el índice que se serializó con `serializarIndice`, con los mismos `indices` con
 * que se construyó. No agrupa nada: cuesta lo que crear un objeto por punto.
 */
export const rehidratarIndice = (
  serializado: IndiceSerializado,
  indices: ReadonlyArray<number>,
): Indice => {
  const indice = nuevoIndice();
  const arboles: Array<Arbol | undefined> = [];
  for (const [z, arbol] of serializado.arboles.entries()) {
    if (arbol !== null && "kd" in arbol) {
      arboles[z] = Object.assign(KDBush.from(arbol.kd), { data: arbol.datos });
    }
  }
  for (const [z, arbol] of serializado.arboles.entries()) {
    if (arbol !== null && "mismo" in arbol) arboles[z] = arboles[arbol.mismo];
  }
  indice.trees = arboles;
  indice.numPoints = serializado.numPoints;
  indice.stride = serializado.stride;
  indice.coords = serializado.coords;
  indice.props = indices.map((i) => ({ indice: i }));
  indice.ids = null;
  indice.clusterProps = [];
  return indice;
};

/**
 * Los índices de una capa: el de todos; si tiene barrios, el de los que no tienen ninguno; y si
 * alguno no tiene municipio, el de esos, que en los niveles de municipios van en hexágonos.
 */
export interface IndicesDeCapa<I> {
  readonly todos: I;
  readonly fuera: I | undefined;
  readonly sinMunicipio: I | undefined;
}

/** Lo que los índices necesitan saber de cada emplazamiento, además de su posición. */
interface ConZonas {
  readonly barrio: string | null;
  /** `null` sin municipio; sin la clave, una capa de antes del formato 5. */
  readonly municipio?: string | null;
}

/**
 * Las posiciones en la capa de sus emplazamientos, de los que quedan fuera de los barrios y de
 * los que no tienen municipio (un territorio compartido, el mar).
 */
export const indicesDeCapa = (
  emplazamientos: ReadonlyArray<ConZonas>,
  conBarrios: boolean,
): IndicesDeCapa<ReadonlyArray<number>> => {
  const todos = emplazamientos.map((_, i) => i);
  const sinMunicipio = todos.filter((i) => emplazamientos[i]?.municipio === null);
  return {
    todos,
    fuera: conBarrios ? todos.filter((i) => emplazamientos[i]?.barrio === null) : undefined,
    sinMunicipio: sinMunicipio.length > 0 ? sinMunicipio : undefined,
  };
};

/**
 * Los índices de una capa. Sin barrios, el nivel de barrios es uno más de hexágonos y no hace
 * falta el índice de los de fuera.
 */
export const indexarCapa = (
  emplazamientos: ReadonlyArray<ConZonas & { readonly posicion: Coordenada }>,
  conBarrios: boolean,
): IndicesDeCapa<Indice> => {
  const posiciones = emplazamientos.map((e) => e.posicion);
  const indices = indicesDeCapa(emplazamientos, conBarrios);
  return {
    todos: indexar(posiciones, indices.todos),
    fuera: indices.fuera === undefined ? undefined : indexar(posiciones, indices.fuera),
    sinMunicipio:
      indices.sinMunicipio === undefined ? undefined : indexar(posiciones, indices.sinMunicipio),
  };
};
