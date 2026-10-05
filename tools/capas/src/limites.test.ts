import type { LimitesDeMunicipios } from "@celda/dominio/municipio";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { unidadesDelGml } from "./gml.ts";
import type { FronterasDeEspana } from "./fronteras.ts";
import {
  ficheroDeLimites,
  limitesDeComunidadesYProvincias,
  tiposDeLimite,
  tramosDeFrontera,
} from "./limites.ts";
import { limitesDelIgn } from "./municipios.ts";
import {
  FUENTE_DE_PRUEBA,
  gmlDe,
  rectangulo,
  type UnidadDePrueba,
  type Vertice,
} from "./pruebas.ts";

/**
 * Las provincias de prueba: Barcelona y Girona, de Cataluña; Castelló, de la Comunitat
 * Valenciana, y la «provincia» del IGN de los territorios sin ninguna.
 */
const PROVINCIAS = [
  {
    codigoNacional: "34090800000",
    nombre: "Barcelona",
    poligonos: [[rectangulo(2, 41, 2.04, 41.02)]],
  },
  {
    codigoNacional: "34091700000",
    nombre: "Girona",
    poligonos: [[rectangulo(2.04, 41, 2.06, 41.02)]],
  },
  {
    codigoNacional: "34101200000",
    nombre: "Castelló",
    poligonos: [[rectangulo(2.06, 41, 2.08, 41.02)]],
  },
  {
    codigoNacional: "34205400000",
    nombre: "Territorios no asociados a ninguna provincia",
    poligonos: [[rectangulo(1.98, 41, 2, 41.02)]],
  },
] satisfies ReadonlyArray<UnidadDePrueba>;

/** Un municipio de prueba: `codigo` es su código INE, que empieza por el de su provincia. */
const municipio = (
  comunidad: string,
  codigo: string,
  ...anillo: ReadonlyArray<Vertice>
): UnidadDePrueba => ({
  codigoNacional: `34${comunidad}${codigo.slice(0, 2)}${codigo}`,
  nombre: `Municipio ${codigo}`,
  poligonos: [[[...anillo, anillo[0] ?? [0, 0]]]],
});

const limitesDe = (municipios: ReadonlyArray<UnidadDePrueba>) =>
  Result.getOrThrow(
    limitesDelIgn(
      Result.getOrThrow(unidadesDelGml(gmlDe(municipios))),
      Result.getOrThrow(unidadesDelGml(gmlDe(PROVINCIAS))),
      FUENTE_DE_PRUEBA,
    ),
  );

/**
 * De oeste a este, en una franja de 41° a 41,02°: un territorio sin provincia, dos municipios de
 * Barcelona, dos de Girona, uno encima del otro, y uno de Castelló. El resto es costa. Los de los
 * lados de Girona llevan el vértice en que se juntan los dos de Girona, como en el IGN.
 */
const LIMITES = limitesDe([
  {
    codigoNacional: "34205454001",
    nombre: "Territorio sin provincia",
    poligonos: [[rectangulo(1.98, 41, 2, 41.02)]],
  },
  municipio("09", "08001", [2, 41], [2.02, 41], [2.02, 41.02], [2, 41.02]),
  municipio("09", "08002", [2.02, 41], [2.04, 41], [2.04, 41.01], [2.04, 41.02], [2.02, 41.02]),
  municipio("09", "17001", [2.04, 41], [2.06, 41], [2.06, 41.01], [2.04, 41.01]),
  municipio("09", "17002", [2.04, 41.01], [2.06, 41.01], [2.06, 41.02], [2.04, 41.02]),
  municipio("10", "12001", [2.06, 41], [2.08, 41], [2.08, 41.02], [2.06, 41.02], [2.06, 41.01]),
]);

/** Los vértices de una línea en diferencias, en grados. */
const vertices = (linea: ReadonlyArray<number>, porGrado = 1000): Array<Vertice> => {
  const salida: Array<Vertice> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < linea.length; k += 2) {
    x += linea[k] ?? 0;
    y += linea[k + 1] ?? 0;
    salida.push([x / porGrado, y / porGrado]);
  }
  return salida;
};

/** Los extremos de una línea, en el mismo orden la vaya hacia donde vaya. */
const extremos = (linea: ReadonlyArray<number>): Array<string> => {
  const todos = vertices(linea);
  return [todos[0], todos.at(-1)].map((v) => String(v)).toSorted();
};

describe("límites de comunidades y provincias", () => {
  it("un arco entre provincias de la misma comunidad es de provincia; de comunidades distintas, de comunidad", () => {
    const tipos = tiposDeLimite(LIMITES);
    const delPar = (a: string, b: string) => {
      const usos = LIMITES.territorios
        .filter((t) => t.codigo === a || t.codigo === b)
        .map((t) => new Set(t.poligonos.flat(2).map((r) => (r >= 0 ? r : ~r))));
      const [deA = new Set<number>(), deB = new Set<number>()] = usos;
      return [...deA].filter((arco) => deB.has(arco)).map((arco) => tipos[arco]);
    };
    assert.deepStrictEqual(delPar("08002", "17001"), ["provincia"]);
    assert.deepStrictEqual(delPar("08002", "17002"), ["provincia"]);
    assert.deepStrictEqual(delPar("17001", "12001"), ["comunidad"]);
    assert.deepStrictEqual(delPar("08001", "08002"), [undefined], "dentro de Barcelona");
    assert.deepStrictEqual(delPar("17001", "17002"), [undefined], "dentro de Girona");
    assert.deepStrictEqual(
      delPar("08001", "34205454001"),
      [undefined],
      "sin provincia al otro lado",
    );
  });

  it("encadena los arcos del mismo tipo y deja fuera la costa, la frontera y lo de dentro", () => {
    const limites = limitesDeComunidadesYProvincias(LIMITES, 1000, 1000);
    // Cada límite es una sola línea: los dos arcos que lo forman, juntos.
    assert.deepStrictEqual(limites.provincias.map(extremos), [["2.04,41", "2.04,41.02"]]);
    assert.deepStrictEqual(limites.comunidades.map(extremos), [["2.06,41", "2.06,41.02"]]);
  });

  it("sin simplificar, cada arco sale una vez y en una sola línea", () => {
    const limites = limitesDeComunidadesYProvincias(LIMITES, 0, 1000);
    const segmentos = [...limites.comunidades, ...limites.provincias].flatMap((linea) =>
      vertices(linea)
        .slice(1)
        .map((v, k) => [String(vertices(linea)[k]), String(v)].toSorted().join(" ")),
    );
    assert.deepStrictEqual(segmentos.toSorted(), [
      "2.04,41 2.04,41.01",
      "2.04,41.01 2.04,41.02",
      "2.06,41 2.06,41.01",
      "2.06,41.01 2.06,41.02",
    ]);
  });

  it("corta la cadena donde se juntan tres límites", () => {
    // Barcelona abajo, Girona arriba a la izquierda y Castelló arriba a la derecha.
    const limites = limitesDeComunidadesYProvincias(
      limitesDe([
        municipio("09", "08001", [2, 41], [2.08, 41], [2.08, 41.01], [2.06, 41.01], [2, 41.01]),
        municipio("09", "17001", [2, 41.01], [2.06, 41.01], [2.06, 41.02], [2, 41.02]),
        municipio("10", "12001", [2.06, 41.01], [2.08, 41.01], [2.08, 41.02], [2.06, 41.02]),
      ]),
      1000,
      1000,
    );
    assert.deepStrictEqual(limites.provincias.map(extremos), [["2,41.01", "2.06,41.01"]]);
    assert.deepStrictEqual(limites.comunidades.map(extremos).toSorted(), [
      ["2.06,41.01", "2.06,41.02"],
      ["2.06,41.01", "2.08,41.01"],
    ]);
  });

  it("el fichero lleva la fuente, cómo se hizo y una línea por renglón", () => {
    const limites = limitesDeComunidadesYProvincias(LIMITES, 1000, 1000);
    const fichero = ficheroDeLimites(limites);
    assert.deepStrictEqual(JSON.parse(fichero), {
      fuente: FUENTE_DE_PRUEBA,
      toleranciaMetros: 1000,
      unidadesPorGrado: 1000,
      pais: [],
      comunidades: limites.comunidades,
      provincias: limites.provincias,
    });
    // La cabecera, la apertura y el cierre de cada grupo con su línea (la frontera, vacía), y el
    // salto del final.
    assert.strictEqual(fichero.split("\n").length, 1 + 3 + 3 + 3 + 1);
  });
});

describe("tramos de frontera", () => {
  /**
   * Un recinto de una sola pieza, como Ceuta: un anillo cerrado de un solo arco, con el lado oeste
   * en tierra, junto a otro país, y el resto en la costa. En cienmilésimas de grado.
   */
  const anillo = [
    [0, 0],
    [0, 500],
    [0, 1000],
    [1000, 1000],
    [1000, 0],
    [0, 0],
  ] as const;
  const recinto: LimitesDeMunicipios = {
    fuente: FUENTE_DE_PRUEBA,
    toleranciaMetros: 50,
    unidadesPorGrado: 100_000,
    provincias: [],
    territorios: [
      {
        codigo: "51001",
        tipo: "municipio",
        nombre: "Recinto",
        provincia: "51",
        etiqueta: { longitud: 0.005, latitud: 0.005 },
        areaKm2: 1,
        poligonos: [[[0]]],
      },
    ],
    arcos: [
      anillo.flatMap(([x, y], k) =>
        k === 0 ? [x, y] : [x - (anillo[k - 1]?.[0] ?? 0), y - (anillo[k - 1]?.[1] ?? 0)],
      ),
    ],
  };
  /** La frontera del IGN: el lado oeste, de (0, 0) a (0, 0,01). */
  const fronteras: FronterasDeEspana = {
    fuente: FUENTE_DE_PRUEBA,
    toleranciaMetros: 20,
    unidadesPorGrado: 100_000,
    lineas: [{ vecino: "MA", linea: [0, 0, 0, 1000] }],
  };

  it("de un anillo con costa y frontera solo toma la parte que va por la frontera", () => {
    assert.deepStrictEqual(tramosDeFrontera(recinto, fronteras), [[0, 0, 0, 500, 0, 1000]]);
  });

  it("sin fronteras, o con un arco que comparten dos recintos, no hay ninguno", () => {
    assert.deepStrictEqual(tramosDeFrontera(recinto, undefined), []);
    const [solo] = recinto.territorios;
    assert.isDefined(solo);
    if (solo === undefined) return;
    const compartido: LimitesDeMunicipios = {
      ...recinto,
      territorios: [solo, { ...solo, codigo: "51002" }],
    };
    assert.deepStrictEqual(tramosDeFrontera(compartido, fronteras), []);
  });

  it("la frontera sale en el fichero en su propia lista", () => {
    const limites = limitesDeComunidadesYProvincias(recinto, 0, 100_000, fronteras);
    assert.deepStrictEqual(limites.pais, [[0, 0, 0, 500, 0, 500]]);
    assert.deepStrictEqual(limites.comunidades, []);
    assert.deepStrictEqual(limites.provincias, []);
  });
});
