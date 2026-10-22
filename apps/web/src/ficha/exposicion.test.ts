import { type Baremo, CORTES, FORMATO_DEL_BAREMO, type ZonaDelBaremo } from "@celda/dominio/baremo";
import type { EstacionDeFicha, Ficha } from "@celda/dominio/ficha";
import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import { textosExposicion } from "./exposicion.ts";

const NOCHE = Date.UTC(2026, 9, 20, 22, 30, 2);

const estacion = (
  compania: EstacionDeFicha["compania"],
  cambios: Partial<EstacionDeFicha> = {},
): EstacionDeFicha => ({
  compania,
  codigos: ["1"],
  bandas: [],
  bandasSinLeer: false,
  origenes: [
    {
      fuente: "registro-oficial",
      clave: `${compania} - 1`,
      url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=1",
      fecha: NOCHE,
      afirma: "presente",
      historial: [],
    },
  ],
  ...cambios,
});

/** El emplazamiento compartido de C/ Sant Lluís 52, en Gavà, con sus medidas del registro. */
const GAVA: Ficha = {
  clave: "orange-CATR1012D",
  posicion: { longitud: 2.0, latitud: 41.3 },
  direccion: "CL SANT LLUIS, 52. GAVÀ, BARCELONA",
  municipio: "GAVÀ",
  lugar: {
    municipio: { codigo: "08089", nombre: "Gavà" },
    provincia: { codigo: "08", nombre: "Barcelona" },
  },
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    estacion("orange", {
      medidasDeExposicion: [
        { distanciaMetros: 80, acimutGrados: 25, microvatiosPorCm2: 0.53487 },
        { distanciaMetros: 55, acimutGrados: 227, microvatiosPorCm2: 2.15456 },
      ],
    }),
    estacion("vodafone", {
      medidasDeExposicion: [{ distanciaMetros: 69, acimutGrados: 188, microvatiosPorCm2: 0.46219 }],
    }),
  ],
  datosDel: NOCHE,
  version: NOCHE,
};

/** Una zona cuyas desviaciones van de −4,9 a 4,9, con lo típico en la recta. */
const zona = (codigo: string): ZonaDelBaremo => ({
  codigo,
  medidas: 19_595,
  emplazamientos: 2865,
  cortes: Array.from({ length: CORTES }, (_, i) => Math.round((i - 49) * 10) / 100),
});

/** Lo típico de la provincia, unos 0,2 µW/cm² a cualquier distancia, y la mitad a 4 dB de ello. */
const BAREMO: Baremo = {
  formato: FORMATO_DEL_BAREMO,
  version: "sitios@2026-10-20T22:30:02Z",
  provincia: "08",
  tipica: { nivel: -7, pendiente: 0 },
  separacion: { nivel: Math.log10(4), pendiente: 0 },
  zonaProvincial: zona("08"),
  municipios: [],
};

const frases = (ficha: Ficha, baremo: Baremo | undefined) =>
  textosExposicion(ficha, baremo).frases.map(textoPlano);

describe("las medidas de exposición de la ficha", () => {
  it("dicen la más alta frente a 200 µW/cm² y, con el baremo, frente a las de su zona", () => {
    const [maxima, norma, procedencia] = frases(GAVA, BAREMO);
    // 2,15 µW/cm² son 3,3 dB, 10,3 dB sobre lo típico: 2,6 desviaciones.
    assert.strictEqual(
      maxima,
      "La medida más alta es de 2,15 µW/cm², el 1,1 % de 200 µW/cm². Teniendo en cuenta la " +
        "distancia a la antena, es más alta que 75 de cada 100 medidas de la provincia de " +
        "Barcelona y unas 11 veces la típica.",
    );
    assert.strictEqual(
      norma,
      "Cada medida suma todo lo que llega a ese punto, de todas las compañías y también de la " +
        "radio y la televisión, y por eso la norma la compara con 200 µW/cm², su nivel de " +
        "referencia más bajo. Por lo mismo, las de dos compañías no se suman.",
    );
    assert.match(procedencia ?? "", /^Son comprobaciones de las Jefaturas de Inspección/u);
    assert.match(procedencia ?? "", /no dicen nada de cómo funciona un móvil allí\.$/u);
  });

  it("dan cada medida por compañía, con su distancia, su dirección, su valor y su comparación", () => {
    const [orange, vodafone] = textosExposicion(GAVA, BAREMO).estaciones;
    assert.strictEqual(orange?.nombre, "Orange");
    assert.deepStrictEqual(orange?.filas, [
      {
        distancia: "80 m",
        direccion: "noreste",
        valor: "0,535",
        comparacion: { tipica: "0,2", masAltaQue: "60 de cada 100" },
      },
      {
        distancia: "55 m",
        direccion: "suroeste",
        valor: "2,15",
        comparacion: { tipica: "0,2", masAltaQue: "75 de cada 100" },
      },
    ]);
    assert.deepStrictEqual(
      vodafone?.filas.map((f) => [f.distancia, f.direccion, f.valor]),
      [["69 m", "sur", "0,462"]],
    );
  });

  it("sin el baremo, enseñan las mismas medidas sin compararlas", () => {
    const sin = textosExposicion(GAVA, undefined);
    assert.strictEqual(
      textoPlano(sin.frases[0] ?? []),
      "La medida más alta es de 2,15 µW/cm², el 1,1 % de 200 µW/cm².",
    );
    assert.lengthOf(sin.frases, 3);
    assert.isTrue(sin.estaciones.flatMap((e) => e.filas).every((f) => f.comparacion === undefined));
  });

  it("con su municipio como zona, lo nombran; y de una sola compañía no hablan de sumar", () => {
    const enBarcelona: Ficha = {
      ...GAVA,
      lugar: {
        municipio: { codigo: "08019", nombre: "Barcelona" },
        provincia: { codigo: "08", nombre: "Barcelona" },
      },
      estaciones: [
        estacion("vodafone", {
          medidasDeExposicion: [{ distanciaMetros: 7, acimutGrados: 320, microvatiosPorCm2: 0.2 }],
        }),
      ],
    };
    const [maxima, norma] = frases(enBarcelona, { ...BAREMO, municipios: [zona("08019")] });
    // Cerca de la típica: sin «veces».
    assert.strictEqual(
      maxima,
      "La medida más alta es de 0,2 µW/cm², el 0,1 % de 200 µW/cm². Teniendo en cuenta la " +
        "distancia a la antena, es más alta que 50 de cada 100 medidas de Barcelona.",
    );
    assert.notInclude(norma ?? "", "no se suman");
  });

  it("si la provincia tiene medidas de pocos emplazamientos, dicen que no las comparan", () => {
    const enCeuta: Ficha = {
      ...GAVA,
      lugar: {
        municipio: { codigo: "51001", nombre: "Ceuta" },
        provincia: { codigo: "51", nombre: "Ceuta" },
      },
    };
    const textos = textosExposicion(enCeuta, { ...BAREMO, provincia: "51", zonaProvincial: null });
    assert.strictEqual(
      textoPlano(textos.frases[1] ?? []),
      "Celda no las compara con las de su zona porque en Ceuta hay medidas de pocos emplazamientos.",
    );
    assert.isTrue(
      textos.estaciones.flatMap((e) => e.filas).every((f) => f.comparacion === undefined),
    );
  });

  it("de una estación sin medidas dicen si Celda aún no las ha leído o si el registro no publica ninguna", () => {
    const ficha: Ficha = {
      ...GAVA,
      estaciones: [
        estacion("movistar"),
        estacion("orange", { medidasDeExposicion: [] }),
        estacion("vodafone", { sinFichaEnRegistro: NOCHE }),
        estacion("digi", { origenes: [] }),
      ],
    };
    const textos = textosExposicion(ficha, BAREMO);
    assert.deepStrictEqual(textos.frases, []);
    assert.deepStrictEqual(
      textos.estaciones.map((e) => [e.filas.length, e.sinMedidas]),
      [
        [0, "Celda aún no ha leído sus medidas de exposición en el registro oficial."],
        [0, "El registro oficial no publica sus medidas de exposición."],
        [
          0,
          "El registro no tiene ficha para este emplazamiento (comprobado el 21 oct 2026), así " +
            "que no se conocen sus medidas de exposición.",
        ],
        [0, "No está en el registro oficial, así que no se conocen sus medidas de exposición."],
      ],
    );
  });

  it("subrayan el nivel de referencia, y no el término del título de la sección", () => {
    assert.deepStrictEqual(terminosDe(textosExposicion(GAVA, BAREMO).frases), [
      "nivel-de-referencia",
    ]);
  });
});
