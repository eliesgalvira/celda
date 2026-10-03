import { COMUNIDAD_DE_PROVINCIA } from "@celda/dominio/barrido";
import type { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import { arcoDe, LimitesDeMunicipios } from "@celda/dominio/municipio";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { codificarArco, simplificarArco } from "./topologia.ts";

/**
 * Los límites de comunidades autónomas y provincias que pinta el mapa (ADR 0023), sacados de los
 * límites de municipios del IGN del repositorio sin descargar nada. La orden `limites` los vuelve
 * a escribir cuando cambian.
 */

/**
 * Tolerancia de la simplificación. A 1 km el fichero pesa unos 8 KB con gzip y la línea se ve
 * en su sitio hasta el zoom 11, donde ceden el sitio a los límites municipales del mapa base
 * (prototipo del 02/10/2026).
 */
export const TOLERANCIA_LIMITES_METROS = 1000;

/** Milésimas de grado: unos 100 m, de sobra para una tolerancia de 1 km. */
export const UNIDADES_LIMITES_POR_GRADO = 1000;

/** Qué separa un arco: dos comunidades autónomas o dos provincias de la misma. */
export type TipoDeLimite = "comunidad" | "provincia";

/**
 * Qué separa cada arco de `limites.arcos`, por su índice. Un arco que usan territorios de dos
 * provincias distintas es límite de provincia y, si sus comunidades también son distintas, de
 * comunidad. El resto no es ninguna de las dos cosas: el que queda dentro de una provincia, la
 * costa y la frontera con otro país o con un territorio sin provincia, que solo usa un recinto
 * con provincia.
 */
export const tiposDeLimite = (
  limites: LimitesDeMunicipios,
): ReadonlyArray<TipoDeLimite | undefined> => {
  const provincias = limites.arcos.map(() => new Set<string>());
  for (const territorio of limites.territorios) {
    if (territorio.provincia === null) continue;
    for (const referencia of territorio.poligonos.flat(2)) {
      provincias[arcoDe(referencia)]?.add(territorio.provincia);
    }
  }
  return provincias.map((deArco): TipoDeLimite | undefined => {
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
const cadenasDeLimites = (limites: LimitesDeMunicipios): ReadonlyArray<Cadena> => {
  const tipos = tiposDeLimite(limites);
  const tramos = limites.arcos.flatMap((arco, i) => {
    const tipo = tipos[i];
    return tipo === undefined ? [] : [{ tipo, vertices: absolutos(arco) }];
  });
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
 * Los límites de comunidades y provincias: cada cadena simplificada a `toleranciaMetros` y en
 * `unidadesPorGrado`, en diferencias. Una cadena que al redondear se queda en un punto no va.
 */
export const limitesDeComunidadesYProvincias = (
  limites: LimitesDeMunicipios,
  toleranciaMetros: number,
  unidadesPorGrado: number,
): LimitesDeComunidadesYProvincias => {
  const divisor = limites.unidadesPorGrado / unidadesPorGrado;
  const lineas = cadenasDeLimites(limites).flatMap(({ tipo, vertices }) => {
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
    `"comunidades":${lineas(limites.comunidades)},\n` +
    `"provincias":${lineas(limites.provincias)}}\n`
  );
};

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

/**
 * Lee los límites de `municipios` y escribe en `destino` los de comunidades y provincias.
 * Devuelve lo escrito y el fichero.
 */
export const escribirLimites = Effect.fn("Capas.escribirLimites")(function* (
  municipios: string,
  destino: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const deMunicipios = yield* decodificarLimites(yield* fs.readFileString(municipios));
  const limites = limitesDeComunidadesYProvincias(
    deMunicipios,
    TOLERANCIA_LIMITES_METROS,
    UNIDADES_LIMITES_POR_GRADO,
  );
  const fichero = ficheroDeLimites(limites);
  yield* fs.writeFileString(destino, fichero);
  return { limites, fichero };
});
