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
import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
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

/**
 * La opacidad final de una expresión de fundido por zoom, con la foto aérea o sin ella, de una
 * celda propia o de la red usada.
 */
const opacidadFinal = (
  valor: DataDrivenPropertyValueSpecification<number> | undefined,
  foto = false,
  redUsada = false,
) => {
  const resuelto = conLaFoto(valor, foto);
  const final: unknown = Array.isArray(resuelto) ? resuelto.at(-1) : resuelto;
  if (!Array.isArray(final)) return Number(final);
  // `["case", ["==", ["get", "redUsada"], true], deLaRedUsada, propia]`
  assert.deepStrictEqual(final.slice(0, 2), ["case", ["==", ["get", "redUsada"], true]]);
  return Number(redUsada ? final[2] : final[3]);
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
    const estilo = estiloMapa((token) => `token:${token}`, CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA);
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

  it("las celdas de la red usada van a la mitad de opacidad, con selección y sin ella", () => {
    const { mapa, pinturas } = mapaDePrueba();
    for (const clave of [null, "movistar-0802532"]) {
      remarcarCelda(mapa, clave);
      for (const capa of ["celdas", "celdas-casco"]) {
        for (const foto of [false, true]) {
          const valor = pinturas.get(`${capa}.line-opacity`);
          const propia = opacidadFinal(valor, foto);
          assert.closeTo(opacidadFinal(valor, foto, true), propia / 2, 0.02, `${capa} ${clave}`);
        }
      }
    }
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
