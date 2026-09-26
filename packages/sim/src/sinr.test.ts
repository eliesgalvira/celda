// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { gananciaSector, SECTOR_TIPICO } from "./diagramaSector.ts";
import { perdidaUrbana } from "./perdidasUrbanas.ts";
import { compararConReferencia } from "./referencias.ts";
import {
  diferenciaDeRumbo,
  type Malla,
  mallaEnRumbo,
  mallaHexagonal,
  rumboDe,
} from "./simulacion.ts";
import { type EstacionSinr, type ParamsSinr, RED_TIPICA, sinr } from "./sinr.ts";

/** Números entre 0 y 1 que se repiten con la misma semilla (generador congruencial). */
const azar = (semilla: number) => {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1_664_525) + 1_013_904_223) >>> 0;
    return estado / 2 ** 32;
  };
};

const SUPUESTOS = [0, 120, 240];

const estacion = (este: number, norte: number, azimuts = SUPUESTOS): EstacionSinr => ({
  este,
  norte,
  azimuts,
  potenciaDbm: RED_TIPICA.potenciaDbm,
});

const params = (
  estaciones: ReadonlyArray<EstacionSinr>,
  ocupacion: number,
  frecuenciaMhz = 1800,
): ParamsSinr => ({ estaciones, frecuenciaMhz, ocupacion, ruidoDbm: RED_TIPICA.ruidoDbm });

/** Un emplazamiento en el centro y seis alrededor a `distancia` metros, como una red en panal. */
const panal = (distancia: number): Array<EstacionSinr> => [
  estacion(0, 0),
  ...Array.from({ length: 6 }, (_, k) => {
    const radianes = ((30 + 60 * k) * Math.PI) / 180;
    return estacion(distancia * Math.sin(radianes), distancia * Math.cos(radianes));
  }),
];

const alAzar = (cuantas: number, semilla: number): Array<EstacionSinr> => {
  const siguiente = azar(semilla);
  return Array.from({ length: cuantas }, () =>
    estacion(-1500 + 3000 * siguiente(), -1500 + 3000 * siguiente(), [
      360 * siguiente(),
      360 * siguiente(),
      360 * siguiente(),
    ]),
  );
};

const puntosAlAzar = (cuantos: number, semilla: number): Malla => {
  const siguiente = azar(semilla);
  const este = new Float64Array(cuantos);
  const norte = new Float64Array(cuantos);
  for (let i = 0; i < cuantos; i++) {
    este[i] = -1500 + 3000 * siguiente();
    norte[i] = -1500 + 3000 * siguiente();
  }
  return { este, norte };
};

const valores = (array: Float64Array): Array<number> => Array.from(array);

describe("SINR", () => {
  it("con una sola estación, en el eje de un sector solo estorban los otros dos por detrás", () => {
    const resultado = sinr.ejecutar(params([estacion(0, 0)], 1), mallaEnRumbo(0, [200]));
    // Los sectores de 120° y 240° llegan con −30 dB, la saturación del diagrama.
    const senal = RED_TIPICA.potenciaDbm - perdidaUrbana(200, 1800);
    const esperada =
      senal - 10 * Math.log10(2 * 10 ** ((senal - 30) / 10) + 10 ** (RED_TIPICA.ruidoDbm / 10));
    assert.closeTo(resultado.sinrDb[0] ?? Number.NaN, esperada, 1e-9);
    assert.closeTo(resultado.sinrDb[0] ?? Number.NaN, 10 * Math.log10(500), 0.05);
    assert.strictEqual(resultado.estacion[0], 0);
    assert.strictEqual(resultado.sector[0], 0);
  });

  it("sin ocupación solo queda el ruido: la SINR es la señal menos el ruido", () => {
    const resultado = sinr.ejecutar(params(panal(500), 0), mallaEnRumbo(120, [150]));
    const senal = RED_TIPICA.potenciaDbm - perdidaUrbana(150, 1800);
    assert.closeTo(resultado.sinrDb[0] ?? Number.NaN, senal - RED_TIPICA.ruidoDbm, 1e-9);
    assert.strictEqual(resultado.estacion[0], 0);
    assert.strictEqual(resultado.sector[0], 1);
  });

  it("empeora al subir la ocupación en cada punto, en configuraciones al azar", () => {
    const ocupaciones = [0, 0.05, 0.25, 0.5, 0.75, 1];
    for (const semilla of [1, 2, 3]) {
      const estaciones = alAzar(12, semilla);
      const malla = puntosAlAzar(300, semilla + 100);
      const porOcupacion = ocupaciones.map((o) => sinr.ejecutar(params(estaciones, o), malla));
      for (let i = 0; i < 300; i++) {
        const serie = porOcupacion.map((r) => r.sinrDb[i] ?? Number.NaN);
        for (let k = 1; k < serie.length; k++) {
          assert.isBelow(serie[k] ?? Number.NaN, serie[k - 1] ?? Number.NaN);
        }
      }
    }
  });

  it("al subir la ocupación crecen los bordes donde manda la interferencia", () => {
    const malla = mallaHexagonal({ oeste: -600, sur: -600, este: 600, norte: 600 }, 20);
    const malos = [0.2, 0.5, 1].map(
      (o) =>
        valores(sinr.ejecutar(params(panal(500), o), malla).sinrDb).filter((v) => v < 0).length,
    );
    assert.isAbove(malos[0] ?? 0, 0);
    assert.isBelow(malos[0] ?? 0, malos[1] ?? 0);
    assert.isBelow(malos[1] ?? 0, malos[2] ?? 0);
  });

  it("mejora al acercarse al emplazamiento que da servicio", () => {
    // Desde el emplazamiento del centro hacia el norte, por el eje de su sector 0, hasta la mitad
    // del camino hacia los vecinos.
    const malla = mallaEnRumbo(0, [40, 60, 90, 120, 160, 200, 240]);
    const resultado = sinr.ejecutar(params(panal(500), 0.7), malla);
    assert.deepStrictEqual(Array.from(resultado.estacion), [0, 0, 0, 0, 0, 0, 0]);
    const serie = valores(resultado.sinrDb);
    for (let k = 1; k < serie.length; k++) {
      assert.isBelow(serie[k] ?? Number.NaN, serie[k - 1] ?? Number.NaN);
    }
    // Junto al emplazamiento la señal es limpia; en el borde entre celdas, no.
    assert.isAbove(serie[0] ?? Number.NaN, 15);
    const borde = sinr.ejecutar(params(panal(500), 0.7), mallaEnRumbo(30, [250])).sinrDb[0];
    assert.isBelow(borde ?? Number.NaN, 3);
  });

  it("coincide con el diagrama de sector y las pérdidas urbanas, sector a sector", () => {
    const estaciones = alAzar(8, 7).map((e, k) => ({ ...e, potenciaDbm: 52 + k }));
    const malla = puntosAlAzar(200, 8);
    for (const [frecuenciaMhz, ocupacion] of [
      [800, 0.3],
      [2600, 1],
    ] as const) {
      const resultado = sinr.ejecutar(params(estaciones, ocupacion, frecuenciaMhz), malla);
      for (let i = 0; i < 200; i++) {
        const este = malla.este[i] ?? 0;
        const norte = malla.norte[i] ?? 0;
        const recibidas = estaciones.flatMap((e, s) => {
          const rumbo = rumboDe(
            { este: Float64Array.of(este - e.este), norte: Float64Array.of(norte - e.norte) },
            0,
          );
          const perdida = perdidaUrbana(Math.hypot(este - e.este, norte - e.norte), frecuenciaMhz);
          return e.azimuts.map((azimut, k) => ({
            s,
            k,
            mw:
              10 **
              ((e.potenciaDbm +
                gananciaSector(
                  diferenciaDeRumbo(rumbo, azimut),
                  SECTOR_TIPICO.anchoHazGrados,
                  SECTOR_TIPICO.atenuacionMaximaDb,
                ) -
                perdida) /
                10),
          }));
        });
        const mejor = recibidas.reduce((a, b) => (b.mw > a.mw ? b : a));
        const interferencia = recibidas.reduce((suma, r) => suma + r.mw, 0) - mejor.mw;
        const esperada =
          10 *
          Math.log10(mejor.mw / (ocupacion * interferencia + 10 ** (RED_TIPICA.ruidoDbm / 10)));
        assert.deepStrictEqual([resultado.estacion[i], resultado.sector[i]], [mejor.s, mejor.k]);
        assert.closeTo(resultado.sinrDb[i] ?? Number.NaN, esperada, 1e-9);
      }
    }
  });

  it("sin estaciones no da ningún valor", () => {
    const resultado = sinr.ejecutar(params([], 0.5), mallaEnRumbo(0, [10, 100]));
    assert.isTrue(valores(resultado.sinrDb).every(Number.isNaN));
    assert.deepStrictEqual(Array.from(resultado.estacion), [-1, -1]);
  });

  it.effect("coincide con su fichero de referencia", () =>
    Effect.gen(function* () {
      const malla = mallaHexagonal({ oeste: -700, sur: -700, este: 700, norte: 700 }, 120);
      const diferencias = yield* compararConReferencia(
        sinr,
        [
          {
            nombre: "una estación con tres sectores, red llena",
            params: params([estacion(0, 0)], 1),
            malla,
          },
          { nombre: "panal de 500 m, ocupación 0", params: params(panal(500), 0), malla },
          { nombre: "panal de 500 m, ocupación 0,5", params: params(panal(500), 0.5), malla },
          { nombre: "panal de 500 m, ocupación 1", params: params(panal(500), 1), malla },
          {
            nombre: "panal de 300 m a 800 MHz, ocupación 0,3",
            params: params(panal(300), 0.3, 800),
            malla,
          },
          {
            nombre: "estaciones al azar con potencias distintas, a 3500 MHz",
            params: {
              ...params(alAzar(6, 5), 0.8, 3500),
              estaciones: alAzar(6, 5).map((e, k) => ({ ...e, potenciaDbm: 50 + 2 * k })),
            },
            malla,
          },
        ],
        1e-9,
      );
      assert.deepStrictEqual(diferencias, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("malla hexagonal", () => {
  const RECTANGULO = { oeste: -310, sur: -205, este: 480, norte: 390 };

  it("solo tiene puntos dentro del rectángulo, a la distancia de la trama de sus vecinos", () => {
    const radio = 25;
    const malla = mallaHexagonal(RECTANGULO, radio);
    const n = malla.este.length;
    // Un hexágono de radio r ocupa 3·√3/2·r².
    const esperados = (790 * 595) / ((3 * Math.sqrt(3) * radio * radio) / 2);
    assert.closeTo(n, esperados, esperados * 0.05);
    for (let i = 0; i < n; i++) {
      const [e, no] = [malla.este[i] ?? 0, malla.norte[i] ?? 0];
      assert.isTrue(e >= RECTANGULO.oeste && e <= RECTANGULO.este);
      assert.isTrue(no >= RECTANGULO.sur && no <= RECTANGULO.norte);
      let cercano = Infinity;
      for (let j = 0; j < n; j++) {
        if (j !== i) {
          cercano = Math.min(
            cercano,
            Math.hypot(e - (malla.este[j] ?? 0), no - (malla.norte[j] ?? 0)),
          );
        }
      }
      assert.closeTo(cercano, Math.sqrt(3) * radio, 1e-9);
    }
  });

  it("está anclada al origen: dos rectángulos que se solapan comparten los puntos comunes", () => {
    const clave = (malla: Malla) =>
      Array.from(malla.este, (e, i) => `${e.toFixed(6)} ${(malla.norte[i] ?? 0).toFixed(6)}`);
    const uno = new Set(
      clave(mallaHexagonal({ oeste: -300, sur: -300, este: 300, norte: 300 }, 30)),
    );
    const otro = clave(mallaHexagonal({ oeste: 0, sur: 0, este: 600, norte: 600 }, 30));
    const comunes = otro.filter((p) => {
      const [e, n] = p.split(" ").map(Number);
      return (e ?? 0) <= 300 && (n ?? 0) <= 300;
    });
    assert.isAbove(comunes.length, 20);
    assert.isTrue(comunes.every((p) => uno.has(p)));
    assert.isTrue(uno.has(`${(0).toFixed(6)} ${(0).toFixed(6)}`));
  });
});
