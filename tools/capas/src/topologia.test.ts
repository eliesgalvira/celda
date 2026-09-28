import { assert, describe, it } from "@effect/vitest";

import type { AnilloEntero } from "./gml.ts";
import { codificarArco, construirTopologia, simplificarArco } from "./topologia.ts";

const MILLON = 1_000_000;

/** Un anillo o un arco en millonésimas a partir de sus vértices en grados. */
const enteros = (...vertices: ReadonlyArray<readonly [number, number]>): AnilloEntero =>
  vertices.flatMap(([x, y]) => [Math.round(x * MILLON), Math.round(y * MILLON)]);

/** Los vértices de un arco en grados, para leer las pruebas. */
const grados = (arco: ReadonlyArray<number>) =>
  Array.from({ length: arco.length / 2 }, (_, k) => [
    (arco[2 * k] ?? 0) / MILLON,
    (arco[2 * k + 1] ?? 0) / MILLON,
  ]);

describe("arcos compartidos", () => {
  it("el lado que comparten dos vecinos es un solo arco, recorrido al revés por uno de ellos", () => {
    const oeste = enteros([1, 40], [2, 40], [2, 40.5], [2, 41], [1, 41], [1, 40]);
    const este = enteros([2, 40], [3, 40], [3, 41], [2, 41], [2, 40.5], [2, 40]);
    const { arcos, recintos } = construirTopologia([[[oeste]], [[este]]]);
    assert.lengthOf(arcos, 3);
    const [refsOeste = []] = recintos[0]?.[0] ?? [];
    const [refsEste = []] = recintos[1]?.[0] ?? [];
    const compartido = refsOeste.find((r) => refsEste.includes(~r));
    assert.isDefined(compartido);
    assert.deepStrictEqual(grados(arcos[compartido ?? 0] ?? []), [
      [2, 40],
      [2, 40.5],
      [2, 41],
    ]);
  });

  it("un enclave y el agujero que llena son el mismo arco, aunque empiecen en otro vértice", () => {
    const hueco = enteros([1.4, 40.4], [1.6, 40.4], [1.6, 40.6], [1.4, 40.6], [1.4, 40.4]);
    const enclave = enteros([1.6, 40.6], [1.6, 40.4], [1.4, 40.4], [1.4, 40.6], [1.6, 40.6]);
    const rodea = enteros([1, 40], [2, 40], [2, 41], [1, 41], [1, 40]);
    const { arcos, recintos } = construirTopologia([[[rodea, hueco]], [[enclave]]]);
    assert.lengthOf(arcos, 2);
    const [agujero] = recintos[0]?.[0]?.[1] ?? [];
    const [exterior] = recintos[1]?.[0]?.[0] ?? [];
    assert.strictEqual(agujero === exterior ? agujero : ~(agujero ?? 0), exterior);
  });

  it("donde se juntan tres recintos se parten los tres anillos", () => {
    const a = enteros([0, 40], [1, 40], [1, 41], [0, 41], [0, 40]);
    const b = enteros([1, 40], [2, 40], [2, 41], [1, 41], [1, 40]);
    const c = enteros([0, 41], [1, 41], [2, 41], [2, 42], [0, 42], [0, 41]);
    const { arcos, recintos } = construirTopologia([[[a]], [[b]], [[c]]]);
    // El límite de A y B, el de A y C, el de B y C y el resto de cada uno.
    assert.lengthOf(arcos, 6);
    assert.lengthOf(recintos[2]?.[0]?.[0] ?? [], 3);
  });
});

describe("simplificación de un arco", () => {
  it("quita lo que se aparta menos de la tolerancia, pero guarda el vértice más lejano", () => {
    // A 41° de latitud, 0,0001° son unos 11 m.
    const arco = enteros([2, 41], [2.01, 41.0001], [2.02, 41], [2.03, 41.0002], [2.04, 41]);
    assert.deepStrictEqual(grados(simplificarArco(arco, 50, MILLON)), [
      [2, 41],
      [2.03, 41.0002],
      [2.04, 41],
    ]);
  });

  it("guarda lo que se aparta más de la tolerancia", () => {
    const arco = enteros([2, 41], [2.01, 41.001], [2.02, 41], [2.03, 41.0001], [2.04, 41]);
    // El vértice a 111 m se queda, y con él el de 2,02°, a unos 74 m de la recta que queda; el
    // de 11 m, no.
    assert.deepStrictEqual(grados(simplificarArco(arco, 50, MILLON)), [
      [2, 41],
      [2.01, 41.001],
      [2.02, 41],
      [2.04, 41],
    ]);
  });

  it("un anillo cerrado más pequeño que la tolerancia sigue siendo un anillo", () => {
    const circulo = Array.from({ length: 24 }, (_, k) => {
      const angulo = (2 * Math.PI * k) / 24;
      return [2 + 0.0002 * Math.cos(angulo), 41 + 0.0002 * Math.sin(angulo)] as const;
    });
    const anillo = enteros(...circulo, circulo[0] ?? [2, 41]);
    const simplificado = simplificarArco(anillo, 50, MILLON);
    const distintos = new Set(grados(simplificado).map((v) => v.join(" ")));
    assert.isAtLeast(distintos.size, 4);
    assert.deepStrictEqual(simplificado.slice(0, 2), simplificado.slice(-2));
  });
});

describe("codificación de un arco", () => {
  it("redondea, quita los vértices repetidos y guarda diferencias", () => {
    const arco = [2_000_004, 41_000_006, 2_000_003, 41_000_008, 2_000_014, 41_000_026];
    assert.deepStrictEqual(codificarArco(arco, 10), [200_000, 4_100_001, 1, 2]);
  });

  it("un arco que cae entero en un punto conserva sus dos extremos", () => {
    assert.deepStrictEqual(
      codificarArco([2_000_001, 41_000_001, 2_000_002, 41_000_002], 10),
      [200_000, 4_100_000, 0, 0],
    );
  });
});
