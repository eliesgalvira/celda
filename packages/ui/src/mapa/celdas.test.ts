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
import { CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { conLaFoto } from "../pruebas/foto.ts";
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

/** La opacidad final de una expresión de fundido por zoom, con la foto aérea o sin ella. */
const opacidadFinal = (
  valor: DataDrivenPropertyValueSpecification<number> | undefined,
  foto = false,
) => {
  const resuelto = conLaFoto(valor, foto);
  return Array.isArray(resuelto) ? Number(resuelto.at(-1)) : Number(resuelto);
};

describe("capas de las celdas", () => {
  const capas = capasCeldas("token:mapa-celda", "token:mapa-foto-linea");

  it("no se dibujan por debajo del zoom de las celdas y leen su fuente", () => {
    for (const capa of capas) {
      assert.strictEqual(capa.minzoom, ZOOM_CELDAS, capa.id);
      assert.strictEqual("source" in capa ? capa.source : undefined, FUENTE_CELDAS, capa.id);
    }
  });

  it("van en el estilo del mapa con su fuente vacía, por debajo de los nombres de las calles", () => {
    const estilo = estiloMapa((token) => `token:${token}`, CONTORNO_DE_PRUEBA);
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

  it("sobre la foto aérea las líneas suben de opacidad y llevan un casco claro, que sin ella no se ve", () => {
    const { mapa, filtros, pinturas } = mapaDePrueba();
    remarcarCelda(mapa, null);
    assert.strictEqual(opacidadFinal(pinturas.get("celdas.line-opacity"), true), 0.85);
    assert.strictEqual(opacidadFinal(pinturas.get("celdas-casco.line-opacity"), true), 0.5);
    assert.strictEqual(opacidadFinal(pinturas.get("celdas-casco.line-opacity"), false), 0);

    remarcarCelda(mapa, "movistar-0802532");
    assert.strictEqual(opacidadFinal(pinturas.get("celdas.line-opacity"), true), 0.22);
    assert.strictEqual(opacidadFinal(pinturas.get("celdas-casco.line-opacity"), true), 0.12);
    assert.deepStrictEqual(filtros.get("celda-seleccionada-casco"), [
      "==",
      ["get", "clave"],
      "movistar-0802532",
    ]);

    const ids = capas.map((capa) => capa.id);
    assert.isBelow(ids.indexOf("celdas-casco"), ids.indexOf("celdas"));
    assert.isBelow(ids.indexOf("celda-seleccionada-casco"), ids.indexOf("celda-seleccionada"));
    const casco = capas.find((capa) => capa.id === "celda-seleccionada-casco");
    const opacidad = casco?.type === "line" ? casco.paint?.["line-opacity"] : undefined;
    assert.strictEqual(opacidadFinal(opacidad, false), 0);
    assert.strictEqual(opacidadFinal(opacidad, true), 0.85);
  });
});
