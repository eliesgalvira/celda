import { assert, describe, it } from "@effect/vitest";
import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import {
  capasCeldas,
  FUENTE_CELDAS,
  type MapaConCeldas,
  remarcarCelda,
  ZOOM_CELDAS,
} from "./celdas.ts";
import { estiloMapa } from "./estilo.ts";

/** Un mapa que apunta los filtros y las opacidades que recibe. */
const mapaDePrueba = () => {
  const filtros = new Map<string, FilterSpecification>();
  const pinturas = new Map<string, DataDrivenPropertyValueSpecification<number>>();
  const mapa: MapaConCeldas = {
    setFilter: (capa, filtro) => {
      filtros.set(capa, filtro);
    },
    setPaintProperty: (capa, propiedad, valor) => {
      pinturas.set(`${capa}.${propiedad}`, valor);
    },
  };
  return { mapa, filtros, pinturas };
};

/** La opacidad final de una expresión de fundido por zoom. */
const opacidadFinal = (valor: DataDrivenPropertyValueSpecification<number> | undefined) =>
  Array.isArray(valor) ? Number(valor.at(-1)) : Number(valor);

describe("capas de las celdas", () => {
  const capas = capasCeldas("token:mapa-celda");

  it("no se dibujan por debajo del zoom de las celdas y leen su fuente", () => {
    for (const capa of capas) {
      assert.strictEqual(capa.minzoom, ZOOM_CELDAS, capa.id);
      assert.strictEqual("source" in capa ? capa.source : undefined, FUENTE_CELDAS, capa.id);
    }
  });

  it("van en el estilo del mapa con su fuente vacía, por debajo de los nombres de las calles", () => {
    const estilo = estiloMapa((token) => `token:${token}`);
    const ids = estilo.layers.map((capa: LayerSpecification) => capa.id);
    const calles = ids.indexOf("nombres-de-calles");
    for (const capa of capas) {
      const indice = ids.indexOf(capa.id);
      assert.isAbove(indice, -1, capa.id);
      assert.isBelow(indice, calles, capa.id);
    }
    assert.deepStrictEqual(estilo.sources[FUENTE_CELDAS], {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  });

  it("al seleccionar un emplazamiento remarca su celda y apaga las demás; sin selección vuelven", () => {
    const { mapa, filtros, pinturas } = mapaDePrueba();
    remarcarCelda(mapa, null);
    const normal = opacidadFinal(pinturas.get("celdas.line-opacity"));
    assert.deepStrictEqual(filtros.get("celda-seleccionada"), ["==", ["get", "clave"], ""]);

    remarcarCelda(mapa, "movistar-0802532");
    const apagada = opacidadFinal(pinturas.get("celdas.line-opacity"));
    assert.deepStrictEqual(filtros.get("celda-seleccionada"), [
      "==",
      ["get", "clave"],
      "movistar-0802532",
    ]);
    assert.isBelow(apagada, normal / 2);

    remarcarCelda(mapa, null);
    assert.strictEqual(opacidadFinal(pinturas.get("celdas.line-opacity")), normal);
  });
});
