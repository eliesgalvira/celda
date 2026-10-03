import { assert, describe, expect, it } from "@effect/vitest";

import type { Coordenada } from "./area.ts";
import {
  type EmplazamientoDelEjercicio,
  type EntradaDelEjercicio,
  type ProvinciaConVecinas,
  provinciasParaLasVecinas,
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
    assert.closeTo(digi.lineasDelGrupo ?? 0, 1200, 1e-9);
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

  it("las estaciones sin ficha en el registro cuentan aparte de las que tienen bandas y de las que no se han leído", () => {
    const resultado = resolverEjercicio({
      ...ENTRADA,
      bandas: new Map([...ENTRADA.bandas, ["c", { movistar: [] }]]),
      sinFichaEnRegistro: new Map([
        ["a", ["vodafone"]],
        ["c", ["movistar"]],
      ]),
    });
    const movistar = de(resultado, "movistar");
    assert.deepStrictEqual(
      [movistar.estaciones, movistar.conBandas, movistar.sinFicha, movistar.sinFichaEnRegistro],
      [3, 2, 0, 1],
    );
    const vodafone = de(resultado, "vodafone");
    assert.deepStrictEqual(
      [vodafone.estaciones, vodafone.conBandas, vodafone.sinFicha, vodafone.sinFichaEnRegistro],
      [2, 0, 0, 1],
    );
    // Sin el dato, ninguna.
    assert.strictEqual(de(resolverEjercicio(ENTRADA), "movistar").sinFichaEnRegistro, 0);
  });

  it("sin habitantes en el padrón no divide por cero: no hay nada por habitante", () => {
    const resultado = resolverEjercicio({ ...ENTRADA, habitantes: null });
    assert.isNull(resultado.habitantes);
    assert.isUndefined(resultado.densidad);
    assert.isUndefined(resultado.lineas);
    const movistar = de(resultado, "movistar");
    assert.strictEqual(movistar.estaciones, 3);
    assert.closeTo(movistar.radio ?? 0, 1300 / 6, 0.01);
    assert.isUndefined(movistar.habitantesPorEstacion);
    assert.isUndefined(movistar.lineasDelGrupo);
    assert.isUndefined(movistar.usuariosPorEstacion);
  });

  it("con área cero no hay densidad", () => {
    assert.isUndefined(resolverEjercicio({ ...ENTRADA, areaKm2: 0 }).densidad);
  });

  it("da el resultado de referencia", async () => {
    const json = `${JSON.stringify(redondeado(resolverEjercicio(ENTRADA)), null, 2)}\n`;
    await expect(json).toMatchFileSnapshot("./referencia/ejercicio-emplazamientos.json");
  });
});

/** Una provincia a lo largo del eje, de `desde` a `hasta` metros al este del origen. */
const provincia = (
  codigo: string,
  desde: number,
  hasta: number,
  otras: Partial<ProvinciaConVecinas> = {},
): ProvinciaConVecinas => ({
  codigo,
  caja: {
    suroeste: { ...alEste(desde), latitud: ORIGEN.latitud - 0.01 },
    noreste: { ...alEste(hasta), latitud: ORIGEN.latitud + 0.01 },
  },
  companias: ["movistar", "vodafone", "orange"],
  cubierta: true,
  conCapa: true,
  ...otras,
});

describe("provincias para las vecinas", () => {
  // La zona está en la provincia «Z», que acaba 200 m al este de C; «E» empieza allí.
  const ZONA = provincia("Z", -5000, 1200);
  const AL_ESTE = provincia("E", 1200, 9000);
  const LEJANA = provincia("L", 50_000, 60_000);

  it("pide la vecina de al lado si su caja queda más cerca que la vecina encontrada", () => {
    // Sin el emplazamiento del este, la vecina de C en Vodafone es A, a 1000 m, y «E» queda a 200 m.
    const { faltan, incompletas } = provinciasParaLasVecinas({
      enZona: ENTRADA.enZona,
      todos: [OESTE, A, B, C],
      provincias: [ZONA, AL_ESTE, LEJANA],
      cargadas: new Set(["Z"]),
    });
    assert.deepStrictEqual(faltan, ["E"]);
    assert.deepStrictEqual(incompletas, []);
  });

  it("con la vecina ya más cerca que el borde, no pide nada", () => {
    const { faltan } = provinciasParaLasVecinas({
      enZona: [A, B],
      todos: [OESTE, A, B],
      provincias: [ZONA, provincia("E", 5000, 9000, { companias: ["movistar"] })],
      cargadas: new Set(["Z"]),
    });
    assert.deepStrictEqual(faltan, []);
  });

  it("una provincia ya cargada o sin capa no se pide, y una a medias se dice", () => {
    const { faltan, incompletas } = provinciasParaLasVecinas({
      enZona: ENTRADA.enZona,
      todos: [OESTE, A, B, C],
      provincias: [ZONA, { ...AL_ESTE, cubierta: false, conCapa: false }],
      cargadas: new Set(["Z"]),
    });
    assert.deepStrictEqual(faltan, []);
    assert.deepStrictEqual(incompletas, ["E"]);
  });

  it("sin ninguna otra estación de la compañía, pide solo la provincia más cercana que la tenga", () => {
    // Yoigo solo está en C: de las dos provincias con Yoigo, la de al lado.
    const conYoigo = { companias: ["yoigo"] as const };
    const { faltan } = provinciasParaLasVecinas({
      enZona: [C],
      todos: [C],
      provincias: [
        ZONA,
        provincia("E", 1200, 9000, conYoigo),
        provincia("L", 50_000, 60_000, conYoigo),
      ],
      cargadas: new Set(["Z"]),
    });
    assert.deepStrictEqual(faltan, ["E"]);
  });

  it("una zona sin emplazamientos no pide nada", () => {
    const { faltan, incompletas } = provinciasParaLasVecinas({
      enZona: [],
      todos: [OESTE],
      provincias: [ZONA, AL_ESTE, LEJANA],
      cargadas: new Set(["Z"]),
    });
    assert.deepStrictEqual(faltan, []);
    assert.deepStrictEqual(incompletas, []);
  });
});
