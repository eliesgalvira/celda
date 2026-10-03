import { assert, describe, it } from "@effect/vitest";
import type { FilterSpecification, LayerSpecification } from "maplibre-gl";

import { remarcarCelda } from "./celdas.ts";
import { CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { estiloMapa } from "./estilo.ts";
import { FUENTE_INTERFERENCIA, mostrarInterferencia } from "./interferencia.ts";

/** Un mapa que apunta la visibilidad y los filtros que recibe. */
const mapaDePrueba = () => {
  const visibles = new Map<string, "visible" | "none">();
  const filtros = new Map<string, FilterSpecification>();
  return {
    visibles,
    filtros,
    mapa: {
      setLayoutProperty: (capa: string, _propiedad: "visibility", valor: "visible" | "none") => {
        visibles.set(capa, valor);
      },
      setFilter: (capa: string, filtro: FilterSpecification) => {
        filtros.set(capa, filtro);
      },
      setPaintProperty: () => undefined,
    },
  };
};

describe("capa de la vista de interferencia", () => {
  const estilo = estiloMapa((token) => `token:${token}`, CONTORNO_DE_PRUEBA);
  const ids = estilo.layers.map((capa: LayerSpecification) => capa.id);

  it("va en el estilo, escondida, con su fuente vacía y por debajo de las celdas", () => {
    const trama = estilo.layers.find((capa) => capa.id === "interferencia");
    assert.strictEqual(trama?.layout?.visibility, "none");
    assert.deepStrictEqual(estilo.sources[FUENTE_INTERFERENCIA], {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    assert.isBelow(ids.indexOf("interferencia"), ids.indexOf("celda-seleccionada-contorno"));
    assert.isBelow(ids.indexOf("interferencia"), ids.indexOf("nombres-de-calles"));
  });

  it("colorea cada hexágono por su tramo con los seis tokens de la escala, del peor al mejor", () => {
    const trama = estilo.layers.find((capa) => capa.id === "interferencia");
    const color = trama?.type === "fill" ? trama.paint?.["fill-color"] : undefined;
    assert.deepStrictEqual(color, [
      "step",
      ["get", "sinr"],
      "token:mapa-sinr-1",
      0,
      "token:mapa-sinr-2",
      5,
      "token:mapa-sinr-3",
      10,
      "token:mapa-sinr-4",
      15,
      "token:mapa-sinr-5",
      20,
      "token:mapa-sinr-6",
    ]);
  });

  it("al activarla oculta las celdas y deja solo el contorno discontinuo de la seleccionada", () => {
    const { mapa, visibles, filtros } = mapaDePrueba();
    remarcarCelda(mapa, "movistar-0802532");
    assert.deepStrictEqual(filtros.get("celda-seleccionada-contorno"), [
      "==",
      ["get", "clave"],
      "movistar-0802532",
    ]);
    const contorno = estilo.layers.find((capa) => capa.id === "celda-seleccionada-contorno");
    assert.deepStrictEqual(
      contorno?.type === "line" ? contorno.paint?.["line-dasharray"] : undefined,
      [2, 2],
    );

    mostrarInterferencia(mapa, true);
    assert.deepStrictEqual(Object.fromEntries(visibles), {
      interferencia: "visible",
      celdas: "none",
      "celda-seleccionada": "none",
      "celda-seleccionada-contorno": "visible",
      // El degradado del sector que da servicio, sus límites y la línea al punto se apartan.
      "servicio-sectores": "none",
      "servicio-degradado": "none",
      "servicio-cortes": "none",
      "servicio-linea": "none",
    });

    mostrarInterferencia(mapa, false);
    assert.deepStrictEqual(Object.fromEntries(visibles), {
      interferencia: "none",
      celdas: "visible",
      "celda-seleccionada": "visible",
      "celda-seleccionada-contorno": "none",
      "servicio-sectores": "visible",
      "servicio-degradado": "visible",
      "servicio-cortes": "visible",
      "servicio-linea": "visible",
    });
  });
});
