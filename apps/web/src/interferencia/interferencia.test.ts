import { type Coordenada, distanciaMetros } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { aPlano, desdePlano } from "@celda/dominio/plano";
import { sinr } from "@celda/sim/sinr";
import { assert, describe, it } from "@effect/vitest";

import {
  bandaInicial,
  companiasDeLaCapa,
  type Encuadre,
  type EntradaSinr,
  type SinrPedida,
  metrosPorPixel,
  mismaTrama,
  origenDeLaTrama,
  palabraDeSinr,
  pedidasDeSinr,
  pedirSinr,
  provinciasParaSinr,
  RADIO_HEXAGONO_PX,
  recuentoDe,
  textoDb,
  tramaEnMapa,
  tratoDe,
  valorEnPunto,
  ZOOM_INTERFERENCIA,
} from "./interferencia.ts";
import { EMPLAZAMIENTOS_POR_PROVINCIA, RESUMEN } from "../capa/pruebasNacional.ts";
import { textoDeEstaciones } from "./textos.ts";

/** El centro de una casilla de la rejilla de los orígenes, en Barcelona: el origen de la trama. */
const ORIGEN: Coordenada = { longitud: 2.15, latitud: 41.35 };

/** Un punto a tantos metros al este y al norte del origen. */
const en = (este: number, norte: number): Coordenada => desdePlano(ORIGEN, { este, norte });

const emplazamiento = (
  clave: string,
  este: number,
  norte: number,
  resto: Partial<EmplazamientoDeCapa> = {},
): EmplazamientoDeCapa => ({
  clave,
  posicion: en(este, norte),
  estado: "verificado",
  companias: ["movistar"],
  ...resto,
});

/** Un panal de Movistar cada 400 m: uno en 1800 confirmado y el resto sin bandas leídas. */
const PANAL: ReadonlyArray<EmplazamientoDeCapa> = [
  emplazamiento("centro", 0, 0, { bandas: [{ compania: "movistar", mhz: [800, 1800] }] }),
  ...Array.from({ length: 6 }, (_, k) => {
    const radianes = ((30 + 60 * k) * Math.PI) / 180;
    return emplazamiento(`vecino-${k}`, 400 * Math.sin(radianes), 400 * Math.cos(radianes));
  }),
];

const ENCUADRE: Encuadre = { suroeste: en(-600, -400), noreste: en(600, 400), zoom: 16 };

const entrada = (resto: Partial<EntradaSinr> = {}): EntradaSinr => ({
  emplazamientos: PANAL,
  eleccion: { compania: "movistar", mhz: 1800, ocupacion: 0.5 },
  encuadre: ENCUADRE,
  referencia: en(50, 120),
  ...resto,
});

const calcular = (datos: EntradaSinr) => {
  const pedida = pedirSinr(datos);
  if (pedida === undefined) throw new Error("no hay nada que calcular");
  return { pedida, resultado: sinr.ejecutar(pedida.params, pedida.malla) };
};

describe("estaciones de la vista de interferencia", () => {
  it("entran las confirmadas en la banda y las que no tienen bandas leídas, no las de otras", () => {
    const conBandas = emplazamiento("a", 0, 0, {
      companias: ["movistar", "orange"],
      bandas: [{ compania: "movistar", mhz: [800] }],
    });
    assert.strictEqual(tratoDe(conBandas, "movistar", 800), "confirmada");
    assert.strictEqual(tratoDe(conBandas, "movistar", 1800), "otra-banda");
    assert.strictEqual(tratoDe(conBandas, "orange", 1800), "supuesta");
    assert.strictEqual(tratoDe(conBandas, "vodafone", 1800), undefined);
    assert.deepStrictEqual(recuentoDe([...PANAL, conBandas], "movistar", 1800), {
      confirmada: 1,
      supuesta: 6,
      "otra-banda": 1,
    });
  });

  it("la cuenta de estaciones dice qué se supone, con el recuento", () => {
    assert.strictEqual(
      textoDeEstaciones({ confirmada: 3, supuesta: 820, "otra-banda": 32 }, "movistar", 1800),
      "El registro confirma 3 estaciones base de Movistar en 1800 MHz. Las 820 que aún no tienen bandas leídas se suponen en esa banda. No cuentan las 32 que solo emiten en otras bandas.",
    );
    assert.strictEqual(
      textoDeEstaciones({ confirmada: 0, supuesta: 1, "otra-banda": 0 }, "digi", 3500),
      "El registro aún no confirma ninguna estación base de Digi en 3500 MHz. La que aún no tiene bandas leídas se supone en esa banda.",
    );
    assert.strictEqual(
      textoDeEstaciones({ confirmada: 12, supuesta: 0, "otra-banda": 1 }, "orange", 800),
      "Entran las 12 estaciones base de Orange que el registro da en 800 MHz. No cuenta la que solo emite en otras bandas.",
    );
    assert.strictEqual(
      textoDeEstaciones({ confirmada: 0, supuesta: 0, "otra-banda": 4 }, "vodafone", 700),
      "El registro no da ninguna estación base de Vodafone en 700 MHz.",
    );
  });

  it("ofrece las compañías de la capa y abre en la banda con más estaciones confirmadas", () => {
    const capa = [
      ...PANAL,
      emplazamiento("d1", 0, 900, {
        companias: ["digi"],
        bandas: [{ compania: "digi", mhz: [2100, 3500] }],
      }),
      emplazamiento("d2", 0, 1200, {
        companias: ["digi"],
        bandas: [{ compania: "digi", mhz: [3500] }],
      }),
    ];
    assert.deepStrictEqual(companiasDeLaCapa(capa), ["movistar", "digi"]);
    assert.strictEqual(bandaInicial(capa, "digi"), 3500);
    assert.strictEqual(bandaInicial(capa, "movistar"), 800);
    // Sin ninguna confirmada, 1800 MHz.
    assert.strictEqual(bandaInicial([emplazamiento("x", 0, 0)], "movistar"), 1800);
  });

  it("añadir una estación base de otra compañía o de otra banda no cambia nada", () => {
    const antes = calcular(entrada());
    for (const extra of [
      emplazamiento("orange", 120, 60, { companias: ["orange"] }),
      emplazamiento("otra-banda", -80, 150, { bandas: [{ compania: "movistar", mhz: [2600] }] }),
      emplazamiento("compartido", 200, -90, {
        companias: ["movistar", "vodafone"],
        bandas: [{ compania: "movistar", mhz: [700, 3500] }],
      }),
    ]) {
      const despues = calcular(entrada({ emplazamientos: [...PANAL, extra] }));
      assert.deepStrictEqual(despues.pedida.params, antes.pedida.params, extra.clave);
      assert.deepStrictEqual(
        Array.from(despues.resultado.sinrDb),
        Array.from(antes.resultado.sinrDb),
        extra.clave,
      );
    }
    // Una de la misma compañía en la misma banda sí cambia la vista.
    const misma = calcular(
      entrada({ emplazamientos: [...PANAL, emplazamiento("nueva", 120, 60)] }),
    );
    assert.notDeepEqual(Array.from(misma.resultado.sinrDb), Array.from(antes.resultado.sinrDb));
  });

  it("solo cuentan las estaciones cercanas a lo que se ve o al punto", () => {
    const lejos = emplazamiento("lejos", 9000, 9000);
    const { pedida } = calcular(entrada({ emplazamientos: [...PANAL, lejos] }));
    assert.strictEqual(pedida.params.estaciones.length, PANAL.length);
    // Con el punto junto a ella, entra.
    const conPunto = calcular(
      entrada({ emplazamientos: [...PANAL, lejos], referencia: en(9000, 9100) }),
    );
    assert.strictEqual(conPunto.pedida.params.estaciones.length, PANAL.length + 1);
    assert.deepStrictEqual(conPunto.pedida.params.estaciones.at(-1)?.azimuts, [0, 120, 240]);
  });
});

describe("trama y valor en el punto", () => {
  it("cubre lo que se ve con un margen, con hexágonos de 13 px al zoom del mapa", () => {
    const { pedida, resultado } = calcular(entrada());
    const radio = RADIO_HEXAGONO_PX * metrosPorPixel(16, ORIGEN.latitud);
    assert.closeTo(pedida.radio, radio, 1e-9);
    assert.strictEqual(pedida.malla.este.length, pedida.hexagonos + 1);
    const trama = tramaEnMapa(pedida, resultado);
    assert.strictEqual(trama.features.length, pedida.hexagonos);
    const este = pedida.malla.este.slice(0, pedida.hexagonos);
    assert.isBelow(Math.min(...este), -600);
    assert.isAbove(Math.max(...este), 600);
    const anillo = trama.features[0]?.geometry.coordinates[0] ?? [];
    assert.strictEqual(anillo.length, 7);
    assert.deepStrictEqual(anillo[0], anillo[6]);
  });

  it("empeora al subir la ocupación, en la trama y en el punto", () => {
    const valores = [0.1, 0.5, 1].map((ocupacion) => {
      const { pedida, resultado } = calcular(
        entrada({ eleccion: { compania: "movistar", mhz: 1800, ocupacion } }),
      );
      const trama = tramaEnMapa(pedida, resultado).features.map((f) => f.properties.sinr);
      return {
        punto: valorEnPunto(pedida, resultado) ?? Number.NaN,
        malos: trama.filter((v) => v < 0).length,
      };
    });
    assert.isAbove(valores[0]?.punto ?? Number.NaN, valores[1]?.punto ?? Number.NaN);
    assert.isAbove(valores[1]?.punto ?? Number.NaN, valores[2]?.punto ?? Number.NaN);
    assert.isBelow(valores[0]?.malos ?? 0, valores[2]?.malos ?? 0);
  });

  it("un arrastre corto o acercarse dentro del medio nivel usan la trama calculada", () => {
    const corrido = (este: number, norte: number, zoom = ENCUADRE.zoom): Encuadre => ({
      suroeste: en(-600 + este, -400 + norte),
      noreste: en(600 + este, 400 + norte),
      zoom,
    });
    assert.isTrue(mismaTrama(ENCUADRE, corrido(150, -50)));
    assert.isTrue(mismaTrama(ENCUADRE, { ...corrido(0, 0), zoom: 16.2 }));
    // Fuera de lo que cubre, o con hexágonos de otro tamaño, hay que calcular otra.
    assert.isFalse(mismaTrama(ENCUADRE, corrido(400, 0)));
    assert.isFalse(mismaTrama(ENCUADRE, { ...corrido(0, 0), zoom: 16.5 }));
    assert.isFalse(mismaTrama(ENCUADRE, undefined));
  });

  it("lejos del zoom de la vista solo calcula el punto, y sin punto nada", () => {
    const alejado = { ...ENCUADRE, zoom: ZOOM_INTERFERENCIA - 0.5 };
    const soloPunto = pedirSinr(entrada({ encuadre: alejado }));
    assert.strictEqual(soloPunto?.hexagonos, 0);
    assert.strictEqual(soloPunto?.malla.este.length, 1);
    assert.isUndefined(pedirSinr(entrada({ encuadre: alejado, referencia: undefined })));
    assert.isUndefined(pedirSinr(entrada({ encuadre: undefined, referencia: undefined })));
  });

  it("sin estaciones cerca no hay valor en el punto", () => {
    const { pedida, resultado } = calcular(
      entrada({ encuadre: undefined, referencia: en(20_000, 0) }),
    );
    assert.strictEqual(pedida.params.estaciones.length, 0);
    assert.isUndefined(valorEnPunto(pedida, resultado));
  });

  it("interpreta el valor con una palabra y lo escribe en dB enteros", () => {
    assert.deepStrictEqual(
      [-3, 0, 3.4, 7, 12, 25].map((db) => `${textoDb(db)} · ${palabraDeSinr(db)}`),
      [
        "−3 dB · mala",
        "0 dB · regular",
        "3 dB · regular",
        "7 dB · aceptable",
        "12 dB · buena",
        "25 dB · excelente",
      ],
    );
  });
});

describe("interferencia junto al borde entre dos provincias", () => {
  // Barcelona al oeste y Girona al este (`pruebasNacional.ts`), todas de Movistar y sin bandas
  // leídas, así que todas entran en la vista.
  const deMovistar = (codigo: string) =>
    (EMPLAZAMIENTOS_POR_PROVINCIA.get(codigo) ?? []).map((e) => ({
      ...e,
      companias: ["movistar" as const],
    }));
  const barcelona = deMovistar("08");
  const girona = deMovistar("17");
  const vista = (longitud: number): Encuadre => ({
    suroeste: { longitud, latitud: 41.91 },
    noreste: { longitud: longitud + 0.008, latitud: 41.925 },
    zoom: 16,
  });
  const ELECCION = { compania: "movistar" as const, mhz: 1800 as const, ocupacion: 0.5 };
  const estaciones = (emplazamientos: ReadonlyArray<EmplazamientoDeCapa>, encuadre: Encuadre) =>
    pedirSinr({ emplazamientos, eleccion: ELECCION, encuadre, referencia: undefined })?.params
      .estaciones.length;

  it("junto al borde necesita las dos provincias; lejos, solo la suya", () => {
    assert.deepStrictEqual(provinciasParaSinr(RESUMEN.provincias, vista(2.477), undefined), [
      "08",
      "17",
    ]);
    assert.deepStrictEqual(provinciasParaSinr(RESUMEN.provincias, vista(2.4), undefined), ["08"]);
    // Un punto de referencia junto al borde también, aunque el mapa esté lejos.
    const alejado = { ...vista(2.4), zoom: ZOOM_INTERFERENCIA - 1 };
    assert.deepStrictEqual(
      provinciasParaSinr(RESUMEN.provincias, alejado, { longitud: 2.49, latitud: 41.92 }),
      ["08", "17"],
    );
    assert.deepStrictEqual(provinciasParaSinr(RESUMEN.provincias, alejado, undefined), []);
  });

  it("con las provincias que pide, da lo mismo que con todas en una sola capa", () => {
    const juntas = [...barcelona, ...girona];
    // Junto al borde, sin Girona faltarían estaciones: por eso la vista espera a que llegue.
    assert.isBelow(estaciones(barcelona, vista(2.477)) ?? 0, estaciones(juntas, vista(2.477)) ?? 0);
    // Lejos, Girona no añade ninguna: no hace falta esperarla.
    assert.strictEqual(estaciones(barcelona, vista(2.4)), estaciones(juntas, vista(2.4)));
    assert.deepStrictEqual(
      pedirSinr({
        emplazamientos: barcelona,
        eleccion: ELECCION,
        encuadre: vista(2.4),
        referencia: undefined,
      })?.params,
      pedirSinr({
        emplazamientos: juntas,
        eleccion: ELECCION,
        encuadre: vista(2.4),
        referencia: undefined,
      })?.params,
    );
  });
});

describe("la vista mide bien lejos de Barcelona", () => {
  const LUGARES = {
    "Las Palmas de Gran Canaria": { longitud: -15.4363, latitud: 28.1235 },
    "A Coruña": { longitud: -8.4115, latitud: 43.3623 },
    Maó: { longitud: 4.2658, latitud: 39.8885 },
  };
  /** Un emplazamiento de Movistar 1 km al este de `p`, una distancia conocida. */
  const alEste = (p: Coordenada): EmplazamientoDeCapa => ({
    clave: "este",
    posicion: {
      longitud: p.longitud + 1000 / (111_195 * Math.cos((p.latitud * Math.PI) / 180)),
      latitud: p.latitud,
    },
    estado: "verificado",
    companias: ["movistar"],
  });
  const vistaEn = (p: Coordenada): Encuadre => ({
    suroeste: { longitud: p.longitud - 0.01, latitud: p.latitud - 0.006 },
    noreste: { longitud: p.longitud + 0.01, latitud: p.latitud + 0.006 },
    zoom: 16,
  });
  /** La distancia del punto a la estación en el plano de la simulación, frente a la del mapa. */
  const errorDe = (pedida: SinrPedida, real: number) => {
    const [estacion] = pedida.params.estaciones;
    const n = pedida.malla.este.length - 1;
    const enPlano = Math.hypot(
      (estacion?.este ?? 0) - (pedida.malla.este[n] ?? 0),
      (estacion?.norte ?? 0) - (pedida.malla.norte[n] ?? 0),
    );
    return Math.abs(enPlano / real - 1);
  };

  it("en Canarias, Galicia y Menorca, 1 km sale 1 km; con el origen en Barcelona, no", () => {
    for (const [lugar, p] of Object.entries(LUGARES)) {
      const estacion = alEste(p);
      const real = distanciaMetros(p, estacion.posicion);
      const [pedida] = pedidasDeSinr(
        entrada({ emplazamientos: [estacion], encuadre: vistaEn(p), referencia: p }),
      );
      if (pedida === undefined) return assert.fail(lugar);
      assert.isTrue(pedida.conPunto, lugar);
      assert.isBelow(errorDe(pedida, real), 0.0026, lugar);
      // En el plano de antes, con el origen fijo en Barcelona, la misma distancia sale mal.
      const a = aPlano(ORIGEN, p);
      const b = aPlano(ORIGEN, estacion.posicion);
      const enBarcelona = Math.hypot(b.este - a.este, b.norte - a.norte);
      assert.isAbove(Math.abs(enBarcelona / real - 1), 0.02, lugar);
    }
  });

  it("la trama se dibuja donde se ve, con su origen en la casilla de lo que se ve", () => {
    const coruna = LUGARES["A Coruña"];
    const vista = vistaEn(coruna);
    assert.isBelow(Math.abs(origenDeLaTrama(vista).latitud - coruna.latitud), 0.05);
    const { pedida, resultado } = calcular(
      entrada({ emplazamientos: [alEste(coruna)], encuadre: vista, referencia: coruna }),
    );
    const trama = tramaEnMapa(pedida, resultado);
    const [primero] = trama.features;
    const [lon = 0, lat = 0] = primero?.geometry.coordinates[0]?.[0] ?? [];
    assert.isBelow(Math.abs(lon - coruna.longitud), 0.03);
    assert.isBelow(Math.abs(lat - coruna.latitud), 0.02);
  });

  it("con el punto lejos de lo que se ve, lo calcula en su propio plano", () => {
    const coruna = LUGARES["A Coruña"];
    const palmas = LUGARES["Las Palmas de Gran Canaria"];
    const estacion = alEste(palmas);
    const pedidas = pedidasDeSinr(
      entrada({
        emplazamientos: [alEste(coruna), estacion],
        encuadre: vistaEn(coruna),
        referencia: palmas,
      }),
    );
    assert.lengthOf(pedidas, 2);
    const [trama, punto] = pedidas;
    assert.isFalse(trama?.conPunto);
    assert.isAbove(trama?.hexagonos ?? 0, 0);
    assert.strictEqual(punto?.hexagonos, 0);
    assert.isTrue(punto?.conPunto);
    if (punto === undefined) return;
    assert.isBelow(errorDe(punto, distanciaMetros(palmas, estacion.posicion)), 0.0026);
    // pedirSinr da solo la de lo que se ve.
    assert.isFalse(pedirSinr(entrada({ encuadre: vistaEn(coruna), referencia: palmas }))?.conPunto);
  });

  it("al pasar a otra casilla de la rejilla, la trama se vuelve a calcular", () => {
    const junto = (longitud: number): Encuadre => ({
      suroeste: { longitud: longitud - 0.005, latitud: 41.375 },
      noreste: { longitud: longitud + 0.005, latitud: 41.385 },
      zoom: 16,
    });
    assert.isTrue(mismaTrama(junto(2.195), junto(2.1951)));
    assert.isFalse(mismaTrama(junto(2.1999), junto(2.2001)));
  });
});
