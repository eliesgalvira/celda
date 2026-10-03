import { assert, describe, it } from "@effect/vitest";
import type { LayerSpecification } from "maplibre-gl";

import { ZOOM_CELDAS } from "./celdas.ts";
import { CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { estiloMapa } from "./estilo.ts";
import {
  CAPAS_SERVICIO,
  FUENTE_SERVICIO,
  FUENTE_SERVICIO_LINEA,
  opacidadDelDegradado,
  opacidadesDelDegradado,
} from "./servicio.ts";

/** La opacidad que se ve donde se apilan las bandas de `desde` en adelante. */
const apiladas = (opacidades: ReadonlyArray<number>, desde: number) =>
  1 - opacidades.slice(desde).reduce((resto, o) => resto * (1 - o), 1);

describe("degradado del sector que da servicio", () => {
  it("se apaga con la pérdida y nunca se va del todo", () => {
    const perdidas = [0, 3, 6, 10, 20, 30, 40, 60];
    const opacidades = perdidas.map(opacidadDelDegradado);
    for (let i = 1; i < opacidades.length; i++) {
      assert.isAtMost(opacidades[i] ?? 1, opacidades[i - 1] ?? 0);
    }
    assert.closeTo(opacidades[0] ?? 0, 0.5, 1e-9);
    assert.isAbove(opacidades.at(-1) ?? 0, 0);
  });

  it("las bandas apiladas dan la opacidad de su borde", () => {
    const perdidas = Array.from({ length: 16 }, (_, k) => k * 3);
    const opacidades = opacidadesDelDegradado(perdidas);
    for (const [k, perdida] of perdidas.entries()) {
      assert.isAtLeast(opacidades[k] ?? -1, 0);
      assert.closeTo(apiladas(opacidades, k), opacidadDelDegradado(perdida), 1e-9);
    }
  });

  it("sus capas van en el estilo desde el zoom de las celdas, los rellenos debajo de las líneas", () => {
    const estilo = estiloMapa((token) => `token:${token}`, CONTORNO_DE_PRUEBA);
    const ids = estilo.layers.map((capa: LayerSpecification) => capa.id);
    for (const id of CAPAS_SERVICIO) {
      const capa = estilo.layers.find((c: LayerSpecification) => c.id === id);
      assert.strictEqual(capa?.minzoom, ZOOM_CELDAS, id);
      assert.isBelow(ids.indexOf(id), ids.indexOf("nombres-de-calles"), id);
    }
    assert.isBelow(ids.indexOf("servicio-degradado"), ids.indexOf("celdas"));
    assert.isAbove(ids.indexOf("servicio-linea"), ids.indexOf("celda-seleccionada"));
    for (const fuente of [FUENTE_SERVICIO, FUENTE_SERVICIO_LINEA]) {
      assert.deepStrictEqual(estilo.sources[fuente], {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
  });
});
