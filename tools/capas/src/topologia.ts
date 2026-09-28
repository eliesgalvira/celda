import type { AnilloEntero } from "./gml.ts";

/**
 * Simplificación de límites que conserva la topología, como la de mapshaper: los anillos se
 * parten en arcos por los vértices donde se juntan tres recintos o más, el lado que comparten
 * dos vecinos queda como un solo arco y cada arco se simplifica una vez. Así los dos vecinos
 * siguen compartiendo exactamente el mismo límite, sin huecos ni solapes entre ellos.
 */

/** Recintos → polígonos → anillos, en millonésimas de grado (`AnilloEntero`). */
export type Recintos = ReadonlyArray<ReadonlyArray<ReadonlyArray<AnilloEntero>>>;

/** Los arcos y, con la misma forma que los recintos, las referencias de cada anillo. */
export interface Topologia {
  /** Cada arco como vértices seguidos, `[x0, y0, x1, y1, …]`, en las unidades de la entrada. */
  readonly arcos: ReadonlyArray<ReadonlyArray<number>>;
  /** Por anillo, sus arcos: `i` tal cual y `~i` al revés. */
  readonly recintos: ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>;
}

// Las claves juntan longitud y latitud en un número exacto: bastan para la longitud entre −33,5° y
// 33,5° y para la latitud entre 0° y 67°, con toda España dentro.
const DESPLAZAMIENTO_X = 2 ** 25;
const BASE_Y = 2 ** 26;

const claveDe = (x: number, y: number): number => {
  if (x < -DESPLAZAMIENTO_X || x >= DESPLAZAMIENTO_X || y < 0 || y >= BASE_Y) {
    throw new Error(`vértice fuera de España: ${x} ${y}`);
  }
  return (x + DESPLAZAMIENTO_X) * BASE_Y + y;
};

const xDe = (clave: number): number => Math.floor(clave / BASE_Y) - DESPLAZAMIENTO_X;
const yDe = (clave: number): number => clave % BASE_Y;

/** Las claves de un anillo, sin repetir el primer vértice al final. */
const clavesDe = (anillo: AnilloEntero): Array<number> => {
  const claves: Array<number> = [];
  for (let k = 0; k + 3 < anillo.length; k += 2) {
    const clave = claveDe(anillo[k] ?? 0, anillo[k + 1] ?? 0);
    if (clave !== claves.at(-1)) claves.push(clave);
  }
  if (claves.length > 1 && claves[0] === claves.at(-1)) claves.pop();
  return claves;
};

/**
 * Los vértices donde se parten los anillos: los que tienen vecinos distintos en dos anillos,
 * como el punto donde se juntan tres municipios o donde un límite compartido llega a la costa.
 */
const unionesDe = (anillos: ReadonlyArray<ReadonlyArray<number>>): ReadonlySet<number> => {
  const vistos = new Map<number, number>();
  const anteriores: Array<number> = [];
  const siguientes: Array<number> = [];
  const uniones = new Set<number>();
  for (const claves of anillos) {
    const n = claves.length;
    for (let k = 0; k < n; k++) {
      const clave = claves[k] ?? 0;
      const anterior = claves[(k + n - 1) % n] ?? 0;
      const siguiente = claves[(k + 1) % n] ?? 0;
      const visto = vistos.get(clave);
      if (visto === undefined) {
        vistos.set(clave, anteriores.length);
        anteriores.push(anterior);
        siguientes.push(siguiente);
      } else if (!uniones.has(clave)) {
        const a = anteriores[visto];
        const s = siguientes[visto];
        if (!((a === anterior && s === siguiente) || (a === siguiente && s === anterior))) {
          uniones.add(clave);
        }
      }
    }
  }
  return uniones;
};

/** Parte un anillo en tramos que empiezan y acaban en una unión, o lo deja entero y canónico. */
const tramosDe = (
  claves: ReadonlyArray<number>,
  uniones: ReadonlySet<number>,
): Array<Array<number>> => {
  const n = claves.length;
  const primera = claves.findIndex((c) => uniones.has(c));
  if (primera === -1) {
    // Sin uniones es un arco cerrado. Empieza en su vértice menor, así el mismo anillo en dos
    // recintos, como un enclave y el agujero que llena, da el mismo arco.
    let menor = 0;
    for (let k = 1; k < n; k++) if ((claves[k] ?? 0) < (claves[menor] ?? 0)) menor = k;
    const girado = [...claves.slice(menor), ...claves.slice(0, menor)];
    return [[...girado, girado[0] ?? 0]];
  }
  const tramos: Array<Array<number>> = [];
  let tramo = [claves[primera] ?? 0];
  for (let paso = 1; paso <= n; paso++) {
    const clave = claves[(primera + paso) % n] ?? 0;
    tramo.push(clave);
    if (uniones.has(clave)) {
      tramos.push(tramo);
      tramo = [clave];
    }
  }
  return tramos;
};

const iguales = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, alReves: boolean) => {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[alReves ? b.length - 1 - k : k]) return false;
  }
  return true;
};

/**
 * Parte los anillos de los recintos en arcos compartidos. Dos anillos que recorren el mismo
 * límite, en el mismo sentido o al revés, acaban apuntando al mismo arco. Lanza un error si un
 * vértice cae fuera del rango de las claves.
 */
export const construirTopologia = (recintos: Recintos): Topologia => {
  const clavesDeAnillos = recintos.map((poligonos) =>
    poligonos.map((anillos) => anillos.map(clavesDe)),
  );
  const uniones = unionesDe(clavesDeAnillos.flat(2));
  const arcos: Array<ReadonlyArray<number>> = [];
  const porExtremos = new Map<string, Array<number>>();
  const referenciaDe = (tramo: ReadonlyArray<number>): number => {
    const primero = tramo[0] ?? 0;
    const ultimo = tramo.at(-1) ?? 0;
    for (const i of porExtremos.get(`${primero},${ultimo}`) ?? []) {
      if (iguales(tramo, arcos[i] ?? [], false)) return i;
    }
    for (const i of porExtremos.get(`${ultimo},${primero}`) ?? []) {
      if (iguales(tramo, arcos[i] ?? [], true)) return ~i;
    }
    const i = arcos.length;
    arcos.push(tramo);
    const clave = `${primero},${ultimo}`;
    const lista = porExtremos.get(clave);
    if (lista === undefined) porExtremos.set(clave, [i]);
    else lista.push(i);
    return i;
  };
  const referencias = clavesDeAnillos.map((poligonos) =>
    poligonos.map((anillos) =>
      anillos.map((claves) => tramosDe(claves, uniones).map(referenciaDe)),
    ),
  );
  return {
    arcos: arcos.map((claves) => claves.flatMap((clave) => [xDe(clave), yDe(clave)])),
    recintos: referencias,
  };
};

/** Metros en un grado de latitud, con el radio medio de la Tierra. */
const METROS_POR_GRADO = 111_195;

/** Distancia de `p` al segmento de `a` a `b`, todo en metros. */
const distanciaAlSegmento = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const largo = dx * dx + dy * dy;
  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Douglas-Peucker sobre un arco con la tolerancia en metros, en el plano local de su primer
 * vértice. Cada tramo que se parte guarda al menos su vértice más lejano, así que un anillo
 * nunca se queda en una línea: uno de dos arcos conserva cuatro vértices, y un arco cerrado, al
 * menos cuatro. `porGrado` son las unidades de la entrada en un grado.
 */
export const simplificarArco = (
  arco: ReadonlyArray<number>,
  toleranciaMetros: number,
  porGrado: number,
): ReadonlyArray<number> => {
  const n = arco.length / 2;
  if (n <= 3) return arco;
  const latitud = (arco[1] ?? 0) / porGrado;
  const escalaX = (METROS_POR_GRADO * Math.cos((latitud * Math.PI) / 180)) / porGrado;
  const escalaY = METROS_POR_GRADO / porGrado;
  const x = (k: number) => ((arco[2 * k] ?? 0) - (arco[0] ?? 0)) * escalaX;
  const y = (k: number) => ((arco[2 * k + 1] ?? 0) - (arco[1] ?? 0)) * escalaY;
  const guardar = new Uint8Array(n);
  guardar[0] = 1;
  guardar[n - 1] = 1;
  const pendientes: Array<readonly [number, number, boolean]> = [];
  const cerrado = arco[0] === arco.at(-2) && arco[1] === arco.at(-1);
  if (cerrado) {
    // Un arco cerrado se parte por el vértice más lejano al primero.
    let lejano = 1;
    for (let k = 2; k < n - 1; k++) {
      if (Math.hypot(x(k), y(k)) > Math.hypot(x(lejano), y(lejano))) lejano = k;
    }
    guardar[lejano] = 1;
    pendientes.push([0, lejano, true], [lejano, n - 1, true]);
  } else {
    pendientes.push([0, n - 1, true]);
  }
  while (pendientes.length > 0) {
    const [desde, hasta, forzar] = pendientes.pop() ?? [0, 0, false];
    if (hasta - desde < 2) continue;
    let peor = desde + 1;
    let distancia = -1;
    for (let k = desde + 1; k < hasta; k++) {
      const d = distanciaAlSegmento(x(k), y(k), x(desde), y(desde), x(hasta), y(hasta));
      if (d > distancia) {
        distancia = d;
        peor = k;
      }
    }
    if (forzar || distancia > toleranciaMetros) {
      guardar[peor] = 1;
      pendientes.push([desde, peor, false], [peor, hasta, false]);
    }
  }
  const simplificado: Array<number> = [];
  for (let k = 0; k < n; k++) {
    if (guardar[k] === 1) simplificado.push(arco[2 * k] ?? 0, arco[2 * k + 1] ?? 0);
  }
  return simplificado;
};

/**
 * Un arco con otra resolución, `divisor` veces más gruesa, y en diferencias: `[x0, y0, dx1, dy1,
 * …]`. Si dos vértices seguidos caen en el mismo punto, se queda uno; los extremos, que
 * comparten los arcos vecinos, no se pierden nunca.
 */
export const codificarArco = (arco: ReadonlyArray<number>, divisor: number): Array<number> => {
  const puntos: Array<number> = [];
  const n = arco.length / 2;
  for (let k = 0; k < n; k++) {
    const x = Math.round((arco[2 * k] ?? 0) / divisor);
    const y = Math.round((arco[2 * k + 1] ?? 0) / divisor);
    const repetido = puntos.length > 0 && puntos.at(-2) === x && puntos.at(-1) === y;
    if (!repetido) puntos.push(x, y);
    else if (k === n - 1 && puntos.length === 2) puntos.push(x, y);
  }
  return puntos.map((valor, k) => (k < 2 ? valor : valor - (puntos[k - 2] ?? 0)));
};
