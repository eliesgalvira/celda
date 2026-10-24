import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import {
  type Baremo,
  bajoElUnoDeCadaCien,
  CORTES,
  compararMedida,
  desviacionDe,
  ficheroDeBaremo,
  FORMATO_DEL_BAREMO,
  generarBaremo,
  leerBaremo,
  puntoDeMedida,
  zonaDeComparacion,
  type ZonaDelBaremo,
} from "./baremo.ts";

const VERSION = "sitios@2026-10-20T22:30:02Z";

/** Una zona cuyas desviaciones van de −4,9 a 4,9 de 0,1 en 0,1, con la mediana en `mediana`. */
const zona = (codigo: string, mediana = 0): ZonaDelBaremo => ({
  codigo,
  medidas: 1000,
  emplazamientos: 150,
  cortes: Array.from({ length: CORTES }, (_, i) => Math.round((i - 49) * 10) / 100 + mediana),
});

/** Lo típico baja 3 dB por década desde −5 dB a 1 m, y la mitad se aparta 4 dB a cualquier distancia. */
const BAREMO: Baremo = {
  formato: FORMATO_DEL_BAREMO,
  version: VERSION,
  provincia: "08",
  tipica: { nivel: -5, pendiente: -3 },
  separacion: { nivel: Math.log10(4), pendiente: 0 },
  zonaProvincial: zona("08"),
  municipios: [zona("08019", 1)],
  espana: { medidas: 244_227, bajoElUnoPorCiento: 229_688, maxima: 49.93179 },
};

const BARCELONA = { codigo: "08", nombre: "Barcelona" };

describe("el fichero del baremo", () => {
  it("va por formato, versión y provincia", () => {
    assert.strictEqual(
      ficheroDeBaremo(VERSION, "08"),
      `baremos/${FORMATO_DEL_BAREMO}/2026-10-20T22:30:02Z/08.json`,
    );
  });

  it("se lee como se escribe, y no como si fuera de otra versión o de otra provincia", () => {
    const contenido = generarBaremo(BAREMO);
    assert.deepStrictEqual(Result.getOrThrow(leerBaremo(contenido, VERSION, "08")), BAREMO);
    assert.isTrue(Result.isFailure(leerBaremo(contenido, "sitios@2026-10-19T22:30:02Z", "08")));
    assert.isTrue(Result.isFailure(leerBaremo(contenido, VERSION, "28")));
    assert.isTrue(
      Result.isFailure(
        leerBaremo(
          contenido.replace(`"formato":${FORMATO_DEL_BAREMO}`, '"formato":0'),
          VERSION,
          "08",
        ),
      ),
    );
  });
});

describe("las medidas de España", () => {
  it("dicen de cada 100 cuántas no llegan al 1 % del nivel de referencia, sin redondear hacia arriba", () => {
    assert.strictEqual(bajoElUnoDeCadaCien(BAREMO.espana), 94);
    assert.strictEqual(
      bajoElUnoDeCadaCien({ medidas: 1000, bajoElUnoPorCiento: 949, maxima: 1 }),
      94,
    );
  });
});

describe("una medida en el baremo", () => {
  it("a menos de 1 m cuenta a 1 m, y un valor de 0 cuenta como 0,00001 µW/cm²", () => {
    assert.deepStrictEqual(puntoDeMedida({ distanciaMetros: 0, microvatiosPorCm2: 0 }), {
      x: 0,
      y: -50,
    });
    assert.deepStrictEqual(puntoDeMedida({ distanciaMetros: 100, microvatiosPorCm2: 1 }), {
      x: 2,
      y: 0,
    });
  });

  it("se aparta de lo típico a su distancia en unidades de lo que se aparta allí la mitad", () => {
    // A 10 m lo típico es −8 dB: 4 dB más es una desviación de 1.
    const a10 = 10 ** (-4 / 10);
    assert.closeTo(desviacionDe(BAREMO, { distanciaMetros: 10, microvatiosPorCm2: a10 }), 1, 1e-12);
  });

  it("se compara con su municipio si es zona, y si no, con su provincia", () => {
    const enBarcelona = zonaDeComparacion(BAREMO, {
      municipio: { codigo: "08019", nombre: "Barcelona" },
      provincia: BARCELONA,
    });
    assert.deepStrictEqual(enBarcelona, {
      tipo: "municipio",
      lugar: { codigo: "08019", nombre: "Barcelona" },
      zona: BAREMO.municipios[0],
    });
    const enGava = zonaDeComparacion(BAREMO, {
      municipio: { codigo: "08089", nombre: "Gavà" },
      provincia: BARCELONA,
    });
    assert.deepStrictEqual(enGava?.tipo, "provincia");
    assert.deepStrictEqual(enGava?.lugar, BARCELONA);
    assert.isUndefined(
      zonaDeComparacion(
        { ...BAREMO, zonaProvincial: null },
        {
          municipio: { codigo: "08089", nombre: "Gavà" },
          provincia: BARCELONA,
        },
      ),
    );
  });

  it("dice de cada 100 medidas de la zona cuántas quedan por debajo y cuál es la típica allí", () => {
    const provincial = BAREMO.zonaProvincial ?? assert.fail("sin zona provincial");
    // Lo típico de la provincia a 10 m: −8 dB, con la mediana de las desviaciones en 0.
    const tipica = 10 ** (-8 / 10);
    const enLaTipica = compararMedida(BAREMO, provincial, {
      distanciaMetros: 10,
      microvatiosPorCm2: tipica,
    });
    assert.strictEqual(enLaTipica.masAltaQue, 49);
    assert.closeTo(enLaTipica.tipica, tipica, 1e-12);
    // 1 µW/cm² son 0 dB, 8 dB por encima: 2 desviaciones, más que las que se apartan menos de 2.
    const alta = compararMedida(BAREMO, provincial, {
      distanciaMetros: 10,
      microvatiosPorCm2: 1,
    });
    assert.strictEqual(alta.masAltaQue, 69);
    // En un municipio con la mediana una desviación más arriba, lo típico allí es 4 dB más.
    const municipal = BAREMO.municipios[0] ?? assert.fail("sin municipio");
    assert.closeTo(
      compararMedida(BAREMO, municipal, { distanciaMetros: 10, microvatiosPorCm2: tipica }).tipica,
      10 ** (-4 / 10),
      1e-9,
    );
    assert.strictEqual(
      compararMedida(BAREMO, provincial, { distanciaMetros: 10, microvatiosPorCm2: 0 }).masAltaQue,
      0,
    );
    assert.strictEqual(
      compararMedida(BAREMO, provincial, { distanciaMetros: 10, microvatiosPorCm2: 1e6 })
        .masAltaQue,
      CORTES,
    );
  });
});
