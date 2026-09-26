import { assert, describe, expect, it } from "@effect/vitest";

import type { Coordenada } from "./area.ts";
import {
  type EmplazamientoDelEjercicio,
  type EntradaDelEjercicio,
  resolverEjercicio,
  type ResultadoDelEjercicio,
} from "./ejercicio.ts";

const ORIGEN: Coordenada = { longitud: 2.16, latitud: 41.39 };

/** El punto que queda `metros` al este del origen, con la misma aproximación que la distancia. */
const alEste = (metros: number): Coordenada => ({
  longitud:
    ORIGEN.longitud +
    metros / (6_371_008.8 * Math.cos((ORIGEN.latitud * Math.PI) / 180) * (Math.PI / 180)),
  latitud: ORIGEN.latitud,
});

const emplazamiento = (
  clave: string,
  metros: number,
  companias: EmplazamientoDelEjercicio["companias"],
): EmplazamientoDelEjercicio => ({ clave, posicion: alEste(metros), companias });

// Tres emplazamientos en la zona, en fila, y dos fuera: uno a 300 m al oeste del primero y otro
// a 400 m al este del último.
const A = emplazamiento("a", 0, ["movistar", "vodafone"]);
const B = emplazamiento("b", 400, ["movistar", "orange"]);
const C = emplazamiento("c", 1000, ["movistar", "vodafone", "yoigo"]);
const OESTE = emplazamiento("oeste", -300, ["movistar"]);
const ESTE = emplazamiento("este", 1400, ["orange"]);

const ENTRADA: EntradaDelEjercicio = {
  habitantes: 10_000,
  areaKm2: 0.5,
  enZona: [A, B, C],
  todos: [OESTE, A, B, C, ESTE],
  bandas: new Map([
    ["a", { movistar: [800, 1800, 3500], vodafone: [] }],
    ["b", { movistar: [900, null], orange: [2600] }],
  ]),
  parametros: {
    penetracion: 120,
    cuotas: { movistar: 30, vodafone: 20, masorange: 40, digi: 10 },
  },
};

const de = (resultado: ResultadoDelEjercicio, compania: string) => {
  const encontrado = resultado.companias.find((c) => c.compania === compania);
  if (encontrado === undefined) throw new Error(`falta ${compania}`);
  return encontrado;
};

/** Redondea a milímetros y milésimas para comparar con el fichero sin ruido de coma flotante. */
const r = (valor: number | undefined) =>
  valor === undefined ? null : Math.round(valor * 1000) / 1000;

const redondeado = (resultado: ResultadoDelEjercicio) => ({
  ...resultado,
  densidad: r(resultado.densidad),
  companias: resultado.companias.map((c) => ({
    ...c,
    vecinas: c.vecinas.map((v) => ({ ...v, metros: r(v.metros) })),
    distanciaMedia: r(c.distanciaMedia),
    radio: r(c.radio),
    habitantesPorEstacion: r(c.habitantesPorEstacion),
    lineasDelGrupo: r(c.lineasDelGrupo),
    usuariosPorEstacion: r(c.usuariosPorEstacion),
  })),
});

describe("ejercicio de emplazamientos", () => {
  it("el radio es la mitad de la distancia media a la vecina, que puede estar fuera de la zona", () => {
    const movistar = de(resolverEjercicio(ENTRADA), "movistar");
    assert.strictEqual(movistar.estaciones, 3);
    assert.deepStrictEqual(
      movistar.vecinas.map((v) => [v.desde, v.hasta, Math.round(v.metros)]),
      [
        ["a", "oeste", 300],
        ["b", "a", 400],
        ["c", "b", 600],
      ],
    );
    assert.closeTo(movistar.distanciaMedia ?? 0, 1300 / 3, 0.01);
    assert.closeTo(movistar.radio ?? 0, 1300 / 6, 0.01);
  });

  it("la vecina es de la misma compañía, aunque haya otra más cerca", () => {
    const vodafone = de(resolverEjercicio(ENTRADA), "vodafone");
    assert.deepStrictEqual(
      vodafone.vecinas.map((v) => v.hasta),
      ["c", "a"],
    );
    assert.closeTo(vodafone.radio ?? 0, 500, 0.01);
  });

  it("sin otra estación de la compañía no hay radio, y sin estaciones no hay nada por estación", () => {
    const resultado = resolverEjercicio(ENTRADA);
    const yoigo = de(resultado, "yoigo");
    assert.strictEqual(yoigo.estaciones, 1);
    assert.lengthOf(yoigo.vecinas, 0);
    assert.isUndefined(yoigo.radio);
    const digi = de(resultado, "digi");
    assert.strictEqual(digi.estaciones, 0);
    assert.isUndefined(digi.radio);
    assert.isUndefined(digi.habitantesPorEstacion);
    assert.isUndefined(digi.usuariosPorEstacion);
    assert.closeTo(digi.lineasDelGrupo, 1200, 1e-9);
  });

  it("reparte habitantes y usuarios por estación base", () => {
    const resultado = resolverEjercicio(ENTRADA);
    assert.strictEqual(resultado.lineas, 12_000);
    assert.strictEqual(resultado.densidad, 20_000);
    const movistar = de(resultado, "movistar");
    assert.closeTo(movistar.habitantesPorEstacion ?? 0, 10_000 / 3, 1e-9);
    // 12.000 líneas × 30 % = 3.600, entre 3 estaciones.
    assert.closeTo(movistar.usuariosPorEstacion ?? 0, 1200, 1e-9);
    assert.closeTo(de(resultado, "vodafone").usuariosPorEstacion ?? 0, 1200, 1e-9);
  });

  it("Orange y Yoigo se reparten las líneas de su grupo entre las estaciones de las dos", () => {
    const resultado = resolverEjercicio(ENTRADA);
    // 12.000 × 40 % = 4.800 líneas, entre una estación de Orange y una de Yoigo.
    assert.closeTo(de(resultado, "orange").usuariosPorEstacion ?? 0, 2400, 1e-9);
    assert.closeTo(de(resultado, "yoigo").usuariosPorEstacion ?? 0, 2400, 1e-9);
    assert.strictEqual(de(resultado, "orange").lineasDelGrupo, 4800);
  });

  it("las tecnologías salen de las bandas conocidas y nunca son seguras", () => {
    const movistar = de(resolverEjercicio(ENTRADA), "movistar");
    assert.deepStrictEqual(movistar.bandas, [800, 900, 1800, 3500]);
    assert.deepStrictEqual(movistar.tecnologias, {
      "2G": "posible",
      "3G": "posible",
      "4G": "probable",
      "5G": "probable",
    });
    // La de c no se ha leído: no se afirma nada de ella.
    assert.strictEqual(movistar.conBandas, 2);
    assert.strictEqual(movistar.sinFicha, 1);
    const vodafone = de(resolverEjercicio(ENTRADA), "vodafone");
    assert.strictEqual(vodafone.conBandas, 0);
    assert.strictEqual(vodafone.tecnologias["4G"], "no-consta");
  });

  it("da el resultado de referencia", async () => {
    const json = `${JSON.stringify(redondeado(resolverEjercicio(ENTRADA)), null, 2)}\n`;
    await expect(json).toMatchFileSnapshot("./referencia/ejercicio-emplazamientos.json");
  });
});
