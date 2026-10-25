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
  espana: { medidas: 244_227, bajoElUnoPorCiento: 229_688, maxima: 49.93179 },
};

const plano = (textos: ReadonlyArray<Parameters<typeof textoPlano>[0]>) => textos.map(textoPlano);

describe("las medidas de exposición de la ficha", () => {
  it("dan la más alta frente al nivel de referencia y a la más alta de España, y frente a las de su zona", () => {
    const { maxima, explicacion } = textosExposicion(GAVA, BAREMO);
    assert.strictEqual(maxima?.valor, "2,15");
    assert.deepStrictEqual(maxima?.companias, ["orange"]);
    assert.strictEqual(maxima?.quien, "Orange, a 55\u00a0m de la antena");
    assert.deepStrictEqual(maxima?.barra, { parte: 2.15456 / 49.93179, final: "49,9" });
    assert.strictEqual(
      textoPlano(maxima?.nota ?? []),
      "Es el 1,1\u00a0% del nivel de referencia, que es 200\u00a0µW/cm². La barra llega hasta la medida " +
        "más alta de España, 49,9\u00a0µW/cm². 94 de cada 100 medidas de España no llegan al 1\u00a0% del " +
        "nivel de referencia.",
    );
    // 2,15 µW/cm² son 3,3 dB, 10,3 dB sobre lo típico: 2,6 desviaciones.
    assert.deepStrictEqual(maxima?.frente, {
      tipo: "comparada",
      masAltaQue: 75,
      nota:
        "Se compara con las medidas de la provincia de Barcelona, porque en Gavà hay pocas. La " +
        "típica a 55\u00a0m de la antena es 0,2\u00a0µW/cm², y esta es unas 11 veces mayor.",
    });
    const [norma, procedencia, porQueBajas] = plano(explicacion);
    assert.strictEqual(
      norma,
      "Cada medida suma todo lo que llega a ese punto, de todas las compañías y también de la " +
        "radio y la televisión, y por eso la norma la compara con 200\u00a0µW/cm², su nivel de " +
        "referencia más bajo. Por lo mismo, las de dos compañías no se suman.",
    );
    assert.match(procedencia ?? "", /^Son comprobaciones de las Jefaturas de Inspección/u);
    assert.match(procedencia ?? "", /no dicen nada de cómo funciona un móvil allí\.$/u);
    assert.strictEqual(
      porQueBajas,
      "Casi todas las medidas quedan muy por debajo del nivel de referencia porque las antenas " +
        "emiten en un haz estrecho que apunta casi al horizonte. En la calle, cerca del edificio " +
        "de la antena, ese haz suele pasar por encima. Además, al doble de distancia llega la " +
        "cuarta parte de la potencia.",
    );
  });

  it("dan cada medida por compañía, con su distancia, su dirección, su valor y su puesto", () => {
    const [orange, vodafone] = textosExposicion(GAVA, BAREMO).estaciones;
    assert.strictEqual(orange?.nombre, "Orange");
    assert.deepStrictEqual(orange?.filas, [
      { distancia: "80 m", direccion: "noreste", valor: "0,535", comparacion: { masAltaQue: 60 } },
      { distancia: "55 m", direccion: "suroeste", valor: "2,15", comparacion: { masAltaQue: 75 } },
    ]);
    assert.deepStrictEqual(
      vodafone?.filas.map((f) => [f.distancia, f.direccion, f.valor]),
      [["69 m", "sur", "0,462"]],
    );
  });

  it("sin el baremo, enseñan las mismas medidas sin barra y sin compararlas", () => {
    const { maxima, estaciones, explicacion } = textosExposicion(GAVA, undefined);
    assert.strictEqual(
      textoPlano(maxima?.nota ?? []),
      "Es el 1,1\u00a0% del nivel de referencia, que es 200\u00a0µW/cm².",
    );
    assert.isUndefined(maxima?.barra);
    assert.isUndefined(maxima?.frente);
    assert.lengthOf(explicacion, 3);
    assert.isTrue(estaciones.flatMap((e) => e.filas).every((f) => f.comparacion === undefined));
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
    const { maxima, explicacion } = textosExposicion(enBarcelona, {
      ...BAREMO,
      municipios: [zona("08019")],
    });
    // Cerca de la típica: sin «veces».
    assert.deepStrictEqual(maxima?.frente, {
      tipo: "comparada",
      masAltaQue: 50,
      nota: "Se compara con las medidas de Barcelona. La típica a 7\u00a0m de la antena es 0,2\u00a0µW/cm².",
    });
    assert.notInclude(textoPlano(explicacion[0] ?? []), "no se suman");
  });

  it("si la provincia tiene medidas de pocos emplazamientos, dicen que no la comparan", () => {
    const enCeuta: Ficha = {
      ...GAVA,
      lugar: {
        municipio: { codigo: "51001", nombre: "Ceuta" },
        provincia: { codigo: "51", nombre: "Ceuta" },
      },
    };
    const textos = textosExposicion(enCeuta, { ...BAREMO, provincia: "51", zonaProvincial: null });
    assert.deepStrictEqual(textos.maxima?.frente, {
      tipo: "sin-zona",
      nota: "No se compara con otras medidas porque en Ceuta hay medidas de pocos emplazamientos.",
    });
    assert.isDefined(textos.maxima?.barra);
    assert.isTrue(
      textos.estaciones.flatMap((e) => e.filas).every((f) => f.comparacion === undefined),
    );
  });

  it("la más alta de un emplazamiento compartido es de las dos compañías, y a 0 m está a menos de 1", () => {
    const compartida = { distanciaMetros: 6, acimutGrados: 180, microvatiosPorCm2: 47.13344 };
    const tarradellas: Ficha = {
      ...GAVA,
      estaciones: [
        estacion("digi", { medidasDeExposicion: [compartida] }),
        estacion("movistar", { medidasDeExposicion: [compartida] }),
        estacion("vodafone", {
          medidasDeExposicion: [{ distanciaMetros: 18, acimutGrados: 225, microvatiosPorCm2: 0.5 }],
        }),
      ],
    };
    const { maxima } = textosExposicion(tarradellas, BAREMO);
    assert.deepStrictEqual(maxima?.companias, ["digi", "movistar"]);
    assert.strictEqual(maxima?.quien, "Digi y Movistar, a 6\u00a0m de la antena");

    const enLaAzotea: Ficha = {
      ...GAVA,
      estaciones: [
        estacion("orange", {
          medidasDeExposicion: [{ distanciaMetros: 0, acimutGrados: 0, microvatiosPorCm2: 3.23 }],
        }),
      ],
    };
    const deLaAzotea = textosExposicion(enLaAzotea, BAREMO).maxima;
    assert.strictEqual(deLaAzotea?.quien, "Orange, a menos de 1\u00a0m de la antena");
    assert.include(
      deLaAzotea?.frente?.nota ?? "",
      "La típica a menos de 1\u00a0m de la antena es 0,2\u00a0µW/cm², y esta es unas 16 veces mayor.",
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
    assert.isUndefined(textos.maxima);
    assert.deepStrictEqual(textos.explicacion, []);
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

  it("subrayan el nivel de referencia una vez fuera y otra en el plegable, y no el término del título", () => {
    const { maxima, explicacion } = textosExposicion(GAVA, BAREMO);
    assert.deepStrictEqual(terminosDe([maxima?.nota ?? []]), ["nivel-de-referencia"]);
    assert.deepStrictEqual(terminosDe(explicacion), ["nivel-de-referencia"]);
  });
});
