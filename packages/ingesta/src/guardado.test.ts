import { assert, describe, it } from "@effect/vitest";

import { type ObservacionGuardada, trasFicha } from "./guardado.ts";

const DIA = 24 * 60 * 60 * 1000;
const ANTES = Date.UTC(2026, 8, 30);
const HOY = ANTES + 7 * DIA;

const MEDIDAS = [
  { distanciaMetros: 47, acimutGrados: 1, microvatiosPorCm2: 0.46922 },
  { distanciaMetros: 49, acimutGrados: 90, microvatiosPorCm2: 0.12 },
];

/** Una observación del registro leída antes de que Celda guardara las medidas de exposición. */
const leidaSinMedidas: ObservacionGuardada = {
  fuente: "registro-oficial",
  clave: "TELEFONICA MOVILES ESPAÑA SAU - 0800143",
  compania: "movistar",
  codigo: "0800143",
  posicion: { longitud: 2.11, latitud: 41.39 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "Barcelona",
  bandas: [],
  url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0800143",
  fecha: ANTES,
  afirma: "presente",
  fichaLeidaEn: ANTES,
  ausencias: 0,
  retiradaEn: null,
};

describe("trasFicha", () => {
  it("las primeras medidas que lee se publican sin mover la fecha, porque el registro ya las tenía", () => {
    const { guardada, cambiada } = trasFicha(
      leidaSinMedidas,
      { bandas: [], medidasDeExposicion: MEDIDAS },
      HOY,
    );
    assert.isTrue(cambiada);
    assert.strictEqual(guardada.fecha, ANTES);
    assert.strictEqual(guardada.fichaLeidaEn, HOY);
    assert.deepStrictEqual(guardada.medidasDeExposicion, MEDIDAS);
  });

  it("una ficha sin medidas también se publica la primera vez, con la lista vacía", () => {
    const { guardada, cambiada } = trasFicha(
      leidaSinMedidas,
      { bandas: [], medidasDeExposicion: [] },
      HOY,
    );
    assert.isTrue(cambiada);
    assert.strictEqual(guardada.fecha, ANTES);
    assert.deepStrictEqual(guardada.medidasDeExposicion, []);
  });

  it("unas medidas distintas de las guardadas cambian la fecha", () => {
    const { guardada, cambiada } = trasFicha(
      { ...leidaSinMedidas, medidasDeExposicion: MEDIDAS },
      { bandas: [], medidasDeExposicion: MEDIDAS.slice(1) },
      HOY,
    );
    assert.isTrue(cambiada);
    assert.strictEqual(guardada.fecha, HOY);
    assert.deepStrictEqual(guardada.medidasDeExposicion, MEDIDAS.slice(1));
  });

  it("las mismas medidas no cambian nada más que la fecha de lectura", () => {
    const { guardada, cambiada } = trasFicha(
      { ...leidaSinMedidas, medidasDeExposicion: MEDIDAS },
      { bandas: [], medidasDeExposicion: MEDIDAS },
      HOY,
    );
    assert.isFalse(cambiada);
    assert.strictEqual(guardada.fecha, ANTES);
    assert.strictEqual(guardada.fichaLeidaEn, HOY);
  });
});
