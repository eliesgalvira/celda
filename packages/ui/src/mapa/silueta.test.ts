import { assert, describe, it } from "@effect/vitest";
import type { StyleSpecification } from "maplibre-gl";

import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { estiloMapa } from "./estilo.ts";
import { estiloDeReserva } from "./reserva/estilo.ts";
import { CAPAS_SILUETA, FUENTE_SILUETA, levantarSilueta, type MapaConSilueta } from "./silueta.ts";

const color = (token: string) => `token:${token}`;
const ESTILOS: ReadonlyArray<readonly [string, StyleSpecification]> = [
  ["principal", estiloMapa(color, CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA)],
  ["reserva", estiloDeReserva(color, CONTORNO_DE_PRUEBA)],
];

describe("silueta de España mientras carga el mapa base", () => {
  it("va en los dos estilos entre el suelo y los límites, con sus datos dentro", () => {
    for (const [nombre, estilo] of ESTILOS) {
      const ids = estilo.layers.map((capa) => capa.id);
      const primera = ids.indexOf(CAPAS_SILUETA[0]);
      assert.deepStrictEqual(
        ids.slice(primera, primera + CAPAS_SILUETA.length),
        [...CAPAS_SILUETA],
        nombre,
      );
      // Los límites de comunidades y provincias quedan encima: se ven con la silueta.
      assert.isBelow(primera, ids.indexOf("limites-provincias"), nombre);
      assert.isAbove(primera, ids.indexOf("fondo"), nombre);
      const fuente = estilo.sources[FUENTE_SILUETA];
      assert.deepStrictEqual(
        fuente?.type === "geojson" ? fuente.data : undefined,
        CONTORNO_DE_PRUEBA,
        nombre,
      );
    }
  });

  it("la tierra lleva el color del suelo y lo de fuera, el suyo", () => {
    const [, estilo] = ESTILOS[0] ?? ["", undefined];
    const paint = (id: string) => estilo?.layers.find((capa) => capa.id === id)?.paint ?? {};
    assert.propertyVal(paint("silueta-espana"), "fill-color", "token:mapa-fondo");
    assert.propertyVal(paint("silueta-fuera"), "fill-color", "token:mapa-silueta-fuera");
  });

  /** Un mapa que apunta lo que se le cambia y avisa de `idle` cuando se le pide. */
  const mapaDePrueba = () => {
    const cambios: Array<string> = [];
    const alQuedarQuieto: Array<() => void> = [];
    const mapa: MapaConSilueta = {
      setPaintProperty: (capa, propiedad, valor) =>
        cambios.push(`${capa} ${propiedad} ${String(valor)}`),
      setLayoutProperty: (capa, propiedad, valor) =>
        cambios.push(`${capa} ${propiedad} ${String(valor)}`),
      once: (_evento, escuchador) => alQuedarQuieto.push(escuchador),
    };
    return {
      mapa,
      cambios,
      quedarQuieto: () => {
        for (const escuchador of alQuedarQuieto.splice(0)) escuchador();
      },
    };
  };

  it("al levantarla se funde y, cuando el mapa queda quieto, se apaga", () => {
    const prueba = mapaDePrueba();
    levantarSilueta(prueba.mapa, false);
    assert.deepStrictEqual(prueba.cambios, [
      "silueta-fuera fill-opacity 0",
      "silueta-espana fill-opacity 0",
      "silueta-costa line-opacity 0",
    ]);
    prueba.quedarQuieto();
    assert.deepStrictEqual(prueba.cambios.slice(3), [
      "silueta-fuera visibility none",
      "silueta-espana visibility none",
      "silueta-costa visibility none",
    ]);
  });

  it("sin movimiento se apaga de golpe", () => {
    const prueba = mapaDePrueba();
    levantarSilueta(prueba.mapa, true);
    assert.deepStrictEqual(prueba.cambios, [
      "silueta-fuera visibility none",
      "silueta-espana visibility none",
      "silueta-costa visibility none",
    ]);
  });
});
