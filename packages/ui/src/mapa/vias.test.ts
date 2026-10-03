import { assert, describe, it } from "@effect/vitest";
import type { DataDrivenPropertyValueSpecification, LayerSpecification } from "maplibre-gl";

import { CLASES_DE_VIAS, capasVias, valorEnZoom } from "./vias.ts";

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

  it("cada clase tiene en la capa común el grosor que le toca en cada una de sus paradas", () => {
    const relleno = capa("vias");
    const anchos = relleno?.type === "line" ? relleno.paint?.["line-width"] : undefined;
    for (const via of CLASES_DE_VIAS) {
      const valores = valoresEnParadas(anchos, via.clase);
      for (let k = 0; k + 1 < via.grosor.length; k += 2) {
        assert.closeTo(
          valores.get(via.grosor[k] ?? 0) ?? -1,
          via.grosor[k + 1] ?? 0,
          0.01,
          via.clase,
        );
      }
    }
  });

  it("dibuja los bordes debajo y la autopista encima de todo, en dos capas", () => {
    const ids = capas.map((c) => c.id);
    assert.deepStrictEqual(ids, ["tren", "caminos", "vias-borde", "vias"]);
    assert.strictEqual(CLASES_DE_VIAS.at(-1)?.clase, "motorway");
    assert.strictEqual(CLASES_DE_VIAS.at(-2)?.clase, "trunk");
  });
});
