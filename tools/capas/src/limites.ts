import { COMUNIDAD_DE_PROVINCIA } from "@celda/dominio/barrido";
import type { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import { arcoDe, LimitesDeMunicipios } from "@celda/dominio/municipio";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { type FronterasDeEspana, leerFronteras } from "./fronteras.ts";
import { codificarArco, simplificarArco } from "./topologia.ts";

/**
 * Los límites de comunidades autónomas y provincias y la frontera terrestre de España que pinta el
 * mapa (ADR 0023), sacados de los límites de municipios y las fronteras del IGN del repositorio
 * sin descargar nada, en dos ficheros: el general, a 1 km, y el de detalle, a 150 m. La orden
 * `limites` los vuelve a escribir cuando cambian.
 */

/** Con qué tolerancia y en qué unidades se escribe un fichero de límites. */
export interface NivelDeLimites {
  readonly toleranciaMetros: number;
  /** Unidades por grado de las líneas: unas diez veces menos que la tolerancia, o menos. */
  readonly unidadesPorGrado: number;
}

/**
 * El fichero general, que la web pide al arrancar y pinta de lejos. A 1 km pesa unos 8 KB con
 * gzip y se ve en su sitio hasta el zoom 7 (prototipo del 02/10/2026). Milésimas de grado: unos
 * 100 m, de sobra para esa tolerancia.
 */
export const LIMITES_GENERALES: NivelDeLimites = { toleranciaMetros: 1000, unidadesPorGrado: 1000 };

/**
 * El fichero de detalle, que la web pide la primera vez que el mapa pasa del zoom 7. A 150 m la
 * línea va sobre la del IGN en los zooms en que se trabaja, de 9 a 11 (a z11 son unos 5 px), y
 * pesa unos 37 KB con gzip; a 200 m pesaba 31 KB y a 100 m, 46 KB (05/10/2026). En
 * diezmilésimas de grado, unos 10 m: con cincomilésimas pesaba 4 KB menos, pero al redondear
 * una línea volvía sobre sí misma.
 */
export const LIMITES_DE_DETALLE: NivelDeLimites = {
  toleranciaMetros: 150,
  unidadesPorGrado: 10_000,
};

/** Qué separa un arco: España de otro país, dos comunidades autónomas o dos provincias. */
export type TipoDeLimite = "pais" | "comunidad" | "provincia";

/**
 * Hasta dónde puede quedar un arco del borde de las líneas de frontera guardadas para ser
 * frontera. Los arcos, a 50 m, y las fronteras, a 20 m, salen de las mismas líneas del IGN: en
 * frontera quedan a menos de 70 m, y la costa más cercana, a más de 200 m.
 */
export const UMBRAL_FRONTERA_METROS = 100;

/** Metros en un grado de latitud. */
const METROS_POR_GRADO = 111_195;

/** Lado de la rejilla con que se buscan los tramos cercanos, en grados. */
const REJILLA = 0.01;

/** Los vértices de una línea en diferencias, en grados. */
const enGrados = (linea: ReadonlyArray<number>, porGrado: number) => {
  const salida: Array<readonly [number, number]> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < linea.length; k += 2) {
    x += linea[k] ?? 0;
    y += linea[k + 1] ?? 0;
    salida.push([x / porGrado, y / porGrado]);
  }
  return salida;
};

/** Distancia en metros de un punto a un segmento, en el plano local del punto. */
const aLaRecta = (
  [px, py]: readonly [number, number],
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
): number => {
  const escalaX = METROS_POR_GRADO * Math.cos((py * Math.PI) / 180);
  const x1 = (ax - px) * escalaX;
  const y1 = (ay - py) * METROS_POR_GRADO;
  const dx = (bx - px) * escalaX - x1;
  const dy = (by - py) * METROS_POR_GRADO - y1;
  const largo = dx * dx + dy * dy;
  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / largo));
  return Math.hypot(x1 + t * dx, y1 + t * dy);
};

/**
 * Lo que hay, en metros, de un punto en grados a la frontera más cercana. Solo mira las celdas
 * de alrededor: más allá de un kilómetro da infinito.
 */
export const distanciaALaFrontera = (
  fronteras: FronterasDeEspana,
): ((punto: readonly [number, number]) => number) => {
  type Tramo = readonly [readonly [number, number], readonly [number, number]];
  const celdas = new Map<string, Array<Tramo>>();
  for (const { linea } of fronteras.lineas) {
    const v = enGrados(linea, fronteras.unidadesPorGrado);
    for (const [k, b] of v.slice(1).entries()) {
      const a = v[k] ?? b;
      const [i0, i1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])].map((x) =>
        Math.floor(x / REJILLA),
      );
      const [j0, j1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])].map((y) =>
        Math.floor(y / REJILLA),
      );
      for (let i = i0 ?? 0; i <= (i1 ?? 0); i++) {
        for (let j = j0 ?? 0; j <= (j1 ?? 0); j++) {
          const clave = `${i} ${j}`;
          const tramos = celdas.get(clave);
          if (tramos === undefined) celdas.set(clave, [[a, b]]);
          else tramos.push([a, b]);
        }
      }
    }
  }
  return (punto) => {
    const i = Math.floor(punto[0] / REJILLA);
    const j = Math.floor(punto[1] / REJILLA);
    let menor = Number.POSITIVE_INFINITY;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const [a, b] of celdas.get(`${i + di} ${j + dj}`) ?? []) {
          menor = Math.min(menor, aLaRecta(punto, a, b));
        }
      }
    }
    return menor;
  };
};

/**
 * Qué separa cada arco de `limites.arcos`, por su índice. Un arco que usan territorios de dos
 * provincias distintas es límite de provincia y, si sus comunidades también son distintas, de
 * comunidad. El resto no es ninguna de las dos cosas: el que queda dentro de una provincia y el
 * borde de España, que solo usa un recinto. Qué parte del borde es frontera lo dice
 * `tramosDeFrontera`.
 */
export const tiposDeLimite = (
  limites: LimitesDeMunicipios,
): ReadonlyArray<Exclude<TipoDeLimite, "pais"> | undefined> => {
  const provincias = limites.arcos.map(() => new Set<string>());
  for (const territorio of limites.territorios) {
    if (territorio.provincia === null) continue;
    for (const referencia of territorio.poligonos.flat(2)) {
      provincias[arcoDe(referencia)]?.add(territorio.provincia);
    }
  }
  return provincias.map((deArco): Exclude<TipoDeLimite, "pais"> | undefined => {
    if (deArco.size < 2) return undefined;
    const comunidades = new Set([...deArco].map((p) => COMUNIDAD_DE_PROVINCIA.get(p) ?? p));
    return comunidades.size > 1 ? "comunidad" : "provincia";
  });
};

/** Un arco, o una cadena de arcos, en vértices absolutos `[x0, y0, x1, y1, …]`. */
type Vertices = ReadonlyArray<number>;

/** Un arco en diferencias, como lo guardan los límites, con sus vértices absolutos. */
const absolutos = (arco: ReadonlyArray<number>): Array<number> => {
  const vertices: Array<number> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < arco.length; k += 2) {
    x += arco[k] ?? 0;
    y += arco[k + 1] ?? 0;
    vertices.push(x, y);
  }
  return vertices;
};

/**
 * Los tramos del borde de España que son frontera terrestre, en vértices absolutos. El borde son
 * los arcos que usa un solo recinto: la costa y las fronteras. Un arco puede ser las dos cosas,
 * como el anillo entero de Ceuta o de Melilla, así que se mira vértice a vértice: cada tramo es
 * una racha de vértices seguidos a menos de `UMBRAL_FRONTERA_METROS` de una línea de `fronteras`,
 * con el centro de cada segmento también cerca. Un segmento que se aleja, el de la costa, la
 * corta. Sin `fronteras`, ninguno.
 */
export const tramosDeFrontera = (
  limites: LimitesDeMunicipios,
  fronteras: FronterasDeEspana | undefined,
): ReadonlyArray<Vertices> => {
  if (fronteras === undefined) return [];
  const usos = limites.arcos.map(() => 0);
  for (const territorio of limites.territorios) {
    for (const referencia of territorio.poligonos.flat(2)) {
      const arco = arcoDe(referencia);
      usos[arco] = (usos[arco] ?? 0) + 1;
    }
  }
  const aLaFrontera = distanciaALaFrontera(fronteras);
  const porGrado = limites.unidadesPorGrado;
  const cerca = (x: number, y: number) =>
    aLaFrontera([x / porGrado, y / porGrado]) <= UMBRAL_FRONTERA_METROS;
  return limites.arcos.flatMap((arco, i) => {
    if (usos[i] !== 1) return [];
    const v = absolutos(arco);
    const tramos: Array<Vertices> = [];
    let racha: Array<number> = [];
    const cerrar = () => {
      if (racha.length >= 4) tramos.push(racha);
      racha = [];
    };
    for (let k = 0; k + 1 < v.length; k += 2) {
      const x = v[k] ?? 0;
      const y = v[k + 1] ?? 0;
      if (!cerca(x, y)) {
        cerrar();
        continue;
      }
      const conAnterior =
        racha.length > 0 && cerca(((racha.at(-2) ?? 0) + x) / 2, ((racha.at(-1) ?? 0) + y) / 2);
      if (racha.length > 0 && !conAnterior) cerrar();
      racha.push(x, y);
    }
    cerrar();
    return tramos;
  });
};

const invertir = (vertices: Vertices): Array<number> => {
  const invertidos: Array<number> = [];
  for (let k = vertices.length - 2; k >= 0; k -= 2) {
    invertidos.push(vertices[k] ?? 0, vertices[k + 1] ?? 0);
  }
  return invertidos;
};

const inicioDe = (vertices: Vertices): string => `${vertices[0]},${vertices[1]}`;
const finDe = (vertices: Vertices): string => `${vertices.at(-2)},${vertices.at(-1)}`;

/** Una cadena de arcos seguidos del mismo tipo. */
interface Cadena {
  readonly tipo: TipoDeLimite;
  readonly vertices: Vertices;
}

/**
 * Los arcos que son límite, encadenados. Dos arcos del mismo tipo se juntan por el extremo que
 * comparten si ningún otro límite llega a ese punto: así la simplificación no tiene que conservar
 * cada punto en que se juntan tres municipios. Donde se juntan tres límites, o uno de provincia
 * con uno de comunidad, la cadena se corta. Cada arco va en una sola cadena.
 */
const cadenasDeLimites = (
  limites: LimitesDeMunicipios,
  fronteras: FronterasDeEspana | undefined,
): ReadonlyArray<Cadena> => {
  const tipos = tiposDeLimite(limites);
  const tramos: ReadonlyArray<Cadena> = [
    ...limites.arcos.flatMap((arco, i): ReadonlyArray<Cadena> => {
      const tipo = tipos[i];
      return tipo === undefined ? [] : [{ tipo, vertices: absolutos(arco) }];
    }),
    ...tramosDeFrontera(limites, fronteras).map((vertices): Cadena => ({ tipo: "pais", vertices })),
  ];
  const porExtremo = new Map<string, Array<number>>();
  for (const [i, tramo] of tramos.entries()) {
    for (const clave of [inicioDe(tramo.vertices), finDe(tramo.vertices)]) {
      porExtremo.set(clave, [...(porExtremo.get(clave) ?? []), i]);
    }
  }
  const usados = new Uint8Array(tramos.length);
  /** La cadena alargada por su final mientras el siguiente límite sea uno solo y de su tipo. */
  const alargar = (vertices: Vertices, tipo: TipoDeLimite): Vertices => {
    const cadena = [...vertices];
    for (;;) {
      const fin = finDe(cadena);
      const alli = porExtremo.get(fin) ?? [];
      if (alli.length !== 2) return cadena;
      const siguiente = alli.find((j) => usados[j] === 0 && tramos[j]?.tipo === tipo);
      const tramo = siguiente === undefined ? undefined : tramos[siguiente];
      if (siguiente === undefined || tramo === undefined) return cadena;
      usados[siguiente] = 1;
      const desdeAqui =
        inicioDe(tramo.vertices) === fin ? tramo.vertices : invertir(tramo.vertices);
      cadena.push(...desdeAqui.slice(2));
    }
  };
  return tramos.flatMap((tramo, i) => {
    if (usados[i] === 1) return [];
    usados[i] = 1;
    const haciaElFinal = alargar(tramo.vertices, tramo.tipo);
    return [{ tipo: tramo.tipo, vertices: invertir(alargar(invertir(haciaElFinal), tramo.tipo)) }];
  });
};

/**
 * Los límites de comunidades y provincias y la frontera: cada cadena simplificada a
 * `toleranciaMetros` y en `unidadesPorGrado`, en diferencias. Una cadena que al redondear se queda
 * en un punto no va. Sin `fronteras`, no hay líneas de frontera.
 */
export const limitesDeComunidadesYProvincias = (
  limites: LimitesDeMunicipios,
  toleranciaMetros: number,
  unidadesPorGrado: number,
  fronteras?: FronterasDeEspana,
): LimitesDeComunidadesYProvincias => {
  const divisor = limites.unidadesPorGrado / unidadesPorGrado;
  const lineas = cadenasDeLimites(limites, fronteras).flatMap(({ tipo, vertices }) => {
    const simplificada = simplificarArco(vertices, toleranciaMetros, limites.unidadesPorGrado);
    const linea = codificarArco(simplificada, divisor);
    return linea.slice(2).some((d) => d !== 0) ? [{ tipo, linea }] : [];
  });
  const deTipo = (tipo: TipoDeLimite) =>
    lineas.flatMap((linea) => (linea.tipo === tipo ? [linea.linea] : []));
  return {
    fuente: limites.fuente,
    toleranciaMetros,
    unidadesPorGrado,
    pais: deTipo("pais"),
    comunidades: deTipo("comunidad"),
    provincias: deTipo("provincia"),
  };
};

/** El fichero de los límites, con la fuente, cómo se hizo y una línea por renglón. */
export const ficheroDeLimites = (limites: LimitesDeComunidadesYProvincias): string => {
  const lineas = (de: ReadonlyArray<ReadonlyArray<number>>) =>
    `[\n${de.map((linea) => JSON.stringify(linea)).join(",\n")}\n]`;
  return (
    `{"fuente":${JSON.stringify(limites.fuente)},` +
    `"toleranciaMetros":${limites.toleranciaMetros},"unidadesPorGrado":${limites.unidadesPorGrado},\n` +
    `"pais":${lineas(limites.pais)},\n` +
    `"comunidades":${lineas(limites.comunidades)},\n` +
    `"provincias":${lineas(limites.provincias)}}\n`
  );
};

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

/** Dónde escribe la orden `limites` cada fichero. */
export interface DestinosDeLimites {
  readonly general: string;
  readonly detalle: string;
}

/**
 * Lee los límites de `municipios` y las líneas de `fronteras`, y escribe los de comunidades y
 * provincias y la frontera en sus dos ficheros, el general y el de detalle. Devuelve lo escrito
 * en cada uno.
 */
export const escribirLimites = Effect.fn("Capas.escribirLimites")(function* (
  municipios: string,
  rutaDeFronteras: string,
  destinos: DestinosDeLimites,
) {
  const fs = yield* FileSystem.FileSystem;
  const deMunicipios = yield* decodificarLimites(yield* fs.readFileString(municipios));
  const fronteras = yield* leerFronteras(rutaDeFronteras);
  const escribir = Effect.fn("Capas.escribirNivelDeLimites")(function* (
    nivel: NivelDeLimites,
    destino: string,
  ) {
    const limites = limitesDeComunidadesYProvincias(
      deMunicipios,
      nivel.toleranciaMetros,
      nivel.unidadesPorGrado,
      fronteras,
    );
    const fichero = ficheroDeLimites(limites);
    yield* fs.writeFileString(destino, fichero);
    return { limites, fichero, destino };
  });
  return [
    yield* escribir(LIMITES_GENERALES, destinos.general),
    yield* escribir(LIMITES_DE_DETALLE, destinos.detalle),
  ] as const;
});
