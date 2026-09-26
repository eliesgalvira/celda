import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { celdas } from "@celda/sim/celdas";
import { contiene } from "@celda/sim/poligono";
import { assert, describe, it } from "@effect/vitest";

import {
  type CeldaEnMapa,
  celdasEnMapa,
  MARGEN_CELDAS_M,
  pedirCeldas,
  pistaDeCeldas,
} from "./celdas.ts";

const emplazamiento = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
});

const EMPLAZAMIENTOS: ReadonlyArray<EmplazamientoDeCapa> = [
  emplazamiento("campus-nord", 2.113412, 41.389278),
  emplazamiento("placa-catalunya", 2.1701, 41.3871),
  emplazamiento("sagrada-familia", 2.1744, 41.4036),
  emplazamiento("repetido", 2.1701, 41.3871),
  emplazamiento("port", 2.18, 41.37),
];

/** El anillo de una celda como polígono en grados, sin repetir el primer vértice. */
const enGrados = (celda: CeldaEnMapa): Float64Array =>
  Float64Array.from((celda.geometry.coordinates[0] ?? []).slice(0, -1).flat());

describe("celdas de la capa", () => {
  const { origen, params } = pedirCeldas(EMPLAZAMIENTOS);
  const mapa = celdasEnMapa(
    celdas.ejecutar(params, { este: new Float64Array(0), norte: new Float64Array(0) }),
    EMPLAZAMIENTOS,
    origen,
  );

  it("rodean todos los emplazamientos con el margen, en un plano centrado en la capa", () => {
    const { caja, emplazamientos } = params;
    assert.lengthOf(emplazamientos, EMPLAZAMIENTOS.length);
    const estes = emplazamientos.map((e) => e.este);
    const nortes = emplazamientos.map((e) => e.norte);
    assert.closeTo(Math.min(...estes) - caja.oeste, MARGEN_CELDAS_M, 1e-9);
    assert.closeTo(caja.norte - Math.max(...nortes), MARGEN_CELDAS_M, 1e-9);
    // Centrado: tanto a un lado del origen como al otro.
    assert.closeTo(Math.min(...estes) + Math.max(...estes), 0, 1e-6);
  });

  it("dan una celda cerrada por emplazamiento que lo contiene, salvo al repetido", () => {
    assert.deepStrictEqual(
      mapa.features.map((celda) => celda.properties.clave),
      ["campus-nord", "placa-catalunya", "sagrada-familia", "port"],
    );
    for (const celda of mapa.features) {
      const anillo = celda.geometry.coordinates[0] ?? [];
      assert.deepStrictEqual(anillo[0], anillo.at(-1));
      const propio = EMPLAZAMIENTOS.find((e) => e.clave === celda.properties.clave);
      assert.isTrue(
        contiene(enGrados(celda), propio?.posicion.longitud ?? 0, propio?.posicion.latitud ?? 0),
        celda.properties.clave,
      );
    }
  });

  it("un punto del mapa cae en la celda del emplazamiento más cercano", () => {
    // Entre el Campus Nord y la plaza de Catalunya, más cerca del campus.
    const punto = { longitud: 2.13, latitud: 41.388 };
    const dentro = mapa.features.filter((celda) =>
      contiene(enGrados(celda), punto.longitud, punto.latitud),
    );
    assert.deepStrictEqual(
      dentro.map((celda) => celda.properties.clave),
      ["campus-nord"],
    );
  });
});

describe("pista de las celdas", () => {
  it("no dice nada lejos del zoom de las celdas", () => {
    for (const calculo of ["sin-pedir", "calculando", "listas", "fallo"] as const) {
      assert.isUndefined(pistaDeCeldas(false, calculo));
    }
  });

  it("dice que se calculan, que son un modelo con su versión o que han fallado", () => {
    assert.strictEqual(pistaDeCeldas(true, "calculando")?.texto, "Calculando las celdas…");
    assert.strictEqual(pistaDeCeldas(true, "sin-pedir")?.texto, "Calculando las celdas…");
    const listas = pistaDeCeldas(true, "listas");
    assert.strictEqual(listas?.modelo, "celdas@1");
    assert.isFalse(listas?.reintentar);
    const fallo = pistaDeCeldas(true, "fallo");
    assert.isUndefined(fallo?.modelo);
    assert.isTrue(fallo?.reintentar);
  });
});
