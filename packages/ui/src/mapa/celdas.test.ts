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

/** La opacidad final de una expresión de fundido por zoom, con la foto aérea o sin ella. */
const opacidadFinal = (
  valor: DataDrivenPropertyValueSpecification<number> | undefined,
  foto = false,
) => {
  const resuelto = conLaFoto(valor, foto);
  return Array.isArray(resuelto) ? Number(resuelto.at(-1)) : Number(resuelto);
};

/** Si una pintura lee algo de cada celda (`get`, `has`, `properties`…), en cualquier nivel. */
const leeLaCelda = (valor: DataDrivenPropertyValueSpecification<number> | undefined): boolean =>
  /\["(?:get|has|properties|feature-state|id|geometry-type)"/u.test(JSON.stringify(valor ?? null));

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

  it("las celdas de la red usada van en sus capas, a la mitad de opacidad, con selección y sin ella", () => {
    const filtroDe = (id: string) => {
      const capa = capas.find((una) => una.id === id);
      return capa?.type === "line" ? capa.filter : undefined;
    };
    const deLaRedUsada: FilterSpecification = ["==", ["get", "redUsada"], true];
    assert.deepStrictEqual(filtroDe("celdas-red-usada"), deLaRedUsada);
    assert.deepStrictEqual(filtroDe("celdas-red-usada-casco"), deLaRedUsada);
    assert.deepStrictEqual(filtroDe("celdas"), ["!=", ["get", "redUsada"], true]);
    assert.deepStrictEqual(filtroDe("celdas-casco"), ["!=", ["get", "redUsada"], true]);

    const { mapa, pinturas } = mapaDePrueba();
    for (const clave of [null, "movistar-0802532"]) {
      remarcarCelda(mapa, clave);
      for (const capa of ["celdas", "celdas-casco"]) {
        for (const foto of [false, true]) {
          const propia = opacidadFinal(pinturas.get(`${capa}.line-opacity`), foto);
          const redUsada = capa.replace("celdas", "celdas-red-usada");
          const clara = opacidadFinal(pinturas.get(`${redUsada}.line-opacity`), foto);
          assert.closeTo(clara, propia / 2, 0.02, `${capa} ${clave}`);
        }
      }
    }
  });

  it("remarcar no cambia ninguna pintura que lea cada celda, que MapLibre volvería a maquetar", () => {
    // Una pintura que depende de cada celda vuelve a maquetar en los workers de MapLibre todas las
    // teselas de la fuente con cada `setPaintProperty`, sin fundido. Las celdas de la red usada se
    // separan con el filtro de sus capas, que no cambia.
    const { mapa, pinturas } = mapaDePrueba();
    for (const clave of [null, "movistar-0802532"]) {
      remarcarCelda(mapa, clave);
      for (const [capa, valor] of pinturas) assert.isFalse(leeLaCelda(valor), capa);
    }
    for (const capa of capas) {
      const pintura = capa.type === "line" ? capa.paint?.["line-opacity"] : undefined;
      assert.isFalse(leeLaCelda(pintura), capa.id);
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
    assert.isBelow(ids.indexOf("celdas-red-usada-casco"), ids.indexOf("celdas-red-usada"));
    assert.isBelow(ids.indexOf("celda-seleccionada-casco"), ids.indexOf("celda-seleccionada"));
    const casco = capas.find((capa) => capa.id === "celda-seleccionada-casco");
    const opacidad = casco?.type === "line" ? casco.paint?.["line-opacity"] : undefined;
    assert.strictEqual(opacidadFinal(opacidad, false), 0);
    assert.strictEqual(opacidadFinal(opacidad, true), 0.85);
  });
});
