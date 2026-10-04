import { assert, describe, it } from "@effect/vitest";
import type { DataDrivenPropertyValueSpecification, LayerSpecification } from "maplibre-gl";

import { BORDE, CLASES_DE_VIAS, capasVias, valorEnZoom } from "./vias.ts";

const capas = capasVias("fuente", (token) => token);
const capa = (id: string): LayerSpecification | undefined => capas.find((c) => c.id === id);

/** Los valores de un `interpolate` de zoom con un `match` por clase en cada parada. */
const valoresEnParadas = (
  expresion: DataDrivenPropertyValueSpecification<number> | undefined,
  clase: string,
): ReadonlyMap<number, number> => {
  const resultado = new Map<number, number>();
  if (!Array.isArray(expresion)) return resultado;
  for (let k = 3; k + 1 < expresion.length; k += 2) {
    const caso: unknown = expresion[k + 1];
    if (!Array.isArray(caso)) continue;
    const i = caso.indexOf(clase, 2);
    resultado.set(Number(expresion[k]), Number(i === -1 ? caso.at(-1) : caso[i + 1]));
  }
  return resultado;
};

describe("capas de las vías", () => {
  it("interpola como MapLibre: exacto en las paradas y por debajo de la recta entre ellas", () => {
    const pares = [10, 2, 13, 4.5, 16, 10];
    assert.strictEqual(valorEnZoom(pares, 9, 1.5), 2);
    assert.strictEqual(valorEnZoom(pares, 13, 1.5), 4.5);
    assert.strictEqual(valorEnZoom(pares, 20, 1.5), 10);
    assert.isBelow(valorEnZoom(pares, 11.5, 1.5), 3.25);
    assert.isAbove(valorEnZoom(pares, 11.5, 1.5), 2);
    assert.strictEqual(valorEnZoom(pares, 11.5, 1), 3.25);
  });

  it("cada clase tiene su grosor en sus paradas y su borde sobresale `BORDE` de su relleno", () => {
    for (const via of CLASES_DE_VIAS) {
      const relleno = capa(`vias-${via.clase}`);
      const anchos = relleno?.type === "line" ? relleno.paint?.["line-width"] : undefined;
      assert.deepStrictEqual(anchos, [
        "interpolate",
        ["exponential", 1.5],
        ["zoom"],
        ...via.grosor,
      ]);
      const borde = capa(`vias-borde-${via.clase}`);
      if (!Number.isFinite(via.bordeDesde)) {
        assert.isUndefined(borde, via.clase);
        continue;
      }
      const conBorde = borde?.type === "line" ? borde.paint?.["line-width"] : undefined;
      assert.deepStrictEqual(conBorde, [
        "interpolate",
        ["exponential", 1.5],
        ["zoom"],
        ...via.grosor.map((valor, k) => (k % 2 === 0 ? valor : valor + BORDE)),
      ]);
    }
  });

  it("dibuja los bordes debajo y los rellenos encima, de la clase menor a la autopista, y otra sobre la foto", () => {
    const ids = capas.map((c) => c.id);
    const conBorde = CLASES_DE_VIAS.filter((via) => Number.isFinite(via.bordeDesde));
    assert.deepStrictEqual(ids, [
      "tren",
      "caminos",
      ...conBorde.map((via) => `vias-borde-${via.clase}`),
      ...CLASES_DE_VIAS.map((via) => `vias-${via.clase}`),
      "vias-foto",
    ]);
    assert.strictEqual(CLASES_DE_VIAS.at(-1)?.clase, "motorway");
    assert.strictEqual(CLASES_DE_VIAS.at(-2)?.clase, "trunk");
  });

  it("el borde y el relleno de una clase salen del mismo cubo: el mismo filtro, la misma disposición y los mismos zooms", () => {
    for (const via of CLASES_DE_VIAS) {
      const borde = capa(`vias-borde-${via.clase}`);
      const relleno = capa(`vias-${via.clase}`);
      if (borde === undefined) continue;
      assert.deepStrictEqual(
        borde.type === "line" ? [borde.filter, borde.layout, borde.minzoom] : undefined,
        relleno?.type === "line" ? [relleno.filter, relleno.layout, relleno.minzoom] : undefined,
        via.clase,
      );
    }
  });

  it("ningún color, grosor ni opacidad de las vías depende de cada vía: MapLibre no los guarda por vértice", () => {
    for (const una of capas) {
      if (una.type !== "line" || una.id === "vias-foto") continue;
      assert.notInclude(JSON.stringify(una.paint), '"get"', una.id);
    }
  });

  it("sobre la foto cada clase tiene en su capa el grosor fino que le toca en sus paradas", () => {
    const foto = capa("vias-foto");
    const anchos = foto?.type === "line" ? foto.paint?.["line-width"] : undefined;
    for (const via of CLASES_DE_VIAS) {
      const valores = valoresEnParadas(anchos, via.clase);
      const { grosor } = via.sobreLaFoto;
      for (let k = 0; k + 1 < grosor.length; k += 2) {
        assert.closeTo(valores.get(grosor[k] ?? 0) ?? -1, grosor[k + 1] ?? 0, 0.01, via.clase);
        assert.isBelow(grosor[k + 1] ?? 0, valorEnZoom(via.grosor, grosor[k] ?? 0, 1.5) + 0.5);
      }
    }
  });
});
