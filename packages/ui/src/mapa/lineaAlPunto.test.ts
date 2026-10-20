import { assert, describe, it } from "@effect/vitest";
import type { LayerSpecification } from "maplibre-gl";

import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { estiloMapa } from "./estilo.ts";
import { FUENTE_LINEA_AL_PUNTO, ZOOM_LINEA_AL_PUNTO } from "./lineaAlPunto.ts";

describe("línea hasta el punto de referencia", () => {
  it("va en el estilo desde el zoom de los logos, bajo los nombres de las calles, con su fuente vacía", () => {
    const estilo = estiloMapa((token) => `token:${token}`, CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA);
    const ids = estilo.layers.map((capa: LayerSpecification) => capa.id);
    const capa = estilo.layers.find((c: LayerSpecification) => c.id === FUENTE_LINEA_AL_PUNTO);
    assert.strictEqual(capa?.minzoom, ZOOM_LINEA_AL_PUNTO);
    assert.strictEqual(
      capa?.type === "line" ? capa.paint?.["line-color"] : undefined,
      "token:mapa-referencia",
    );
    assert.isBelow(ids.indexOf(FUENTE_LINEA_AL_PUNTO), ids.indexOf("nombres-de-calles"));
    assert.deepStrictEqual(estilo.sources[FUENTE_LINEA_AL_PUNTO], {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  });
});
