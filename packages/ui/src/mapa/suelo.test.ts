import { assert, describe, it } from "@effect/vitest";

import { capasSuelo } from "./suelo.ts";

const capas = capasSuelo("fuente", (token) => `token:${token}`);
const ids = capas.map((capa) => capa.id);

describe("capas del suelo", () => {
  it("los verdes van de la arena a los parques, cada uno en su capa", () => {
    assert.deepStrictEqual(
      ids.filter((id) => id.startsWith("verdes-")),
      ["verdes-arena", "verdes-bosque", "verdes-hierba", "verdes-parques"],
    );
  });

  it("las zonas urbanas van debajo de los usos que se tiñen de cerca, desde el zoom 12", () => {
    assert.isBelow(ids.indexOf("usos"), ids.indexOf("usos-de-cerca"));
    assert.strictEqual(capas.find((capa) => capa.id === "usos-de-cerca")?.minzoom, 12);
  });

  it("ningún color ni opacidad de los verdes ni de las zonas urbanas depende de cada polígono: MapLibre no los guarda por vértice", () => {
    for (const capa of capas) {
      if (!(capa.id.startsWith("verdes-") || capa.id === "usos") || capa.type !== "fill") continue;
      assert.notInclude(JSON.stringify(capa.paint), '"get"', capa.id);
    }
  });
});
