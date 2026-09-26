// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { SECTOR_TIPICO } from "./diagramaSector.ts";
import { perdidaUrbana } from "./perdidasUrbanas.ts";
import { area, contiene } from "./poligono.ts";
import { compararConReferencia } from "./referencias.ts";
import {
  DISTANCIA_JUNTO_M,
  PASO_DEGRADADO_DB,
  type ParamsSectorServicio,
  sectorServicio,
  trozo,
} from "./sectorServicio.ts";
import { type Malla, mallaEnRumbo } from "./simulacion.ts";

/** Una celda irregular alrededor del emplazamiento, en sentido antihorario. */
const CELDA = [-150, -120, 180, -90, 220, 60, 40, 200, -170, 110];

const TRES_SECTORES: ParamsSectorServicio = {
  azimuts: [0, 120, 240],
  ...SECTOR_TIPICO,
  celda: CELDA,
};

const SIN_MALLA: Malla = { este: new Float64Array(0), norte: new Float64Array(0) };

/** Lo que dice la simulación de un solo punto. */
const desde = (params: ParamsSectorServicio, rumbo: number, metros: number) => {
  const r = sectorServicio.ejecutar(params, mallaEnRumbo(rumbo, [metros]));
  return {
    sector: r.sector[0],
    gananciaDb: r.gananciaDb[0] ?? Number.NaN,
    desviacion: r.desviacion[0] ?? Number.NaN,
    distancia: r.distancia[0] ?? Number.NaN,
    rumbo: r.rumbo[0] ?? Number.NaN,
    enCelda: r.enCelda[0],
    resultado: r,
  };
};

const areaDe = (vertices: Float64Array, inicio: Uint32Array, k: number) =>
  area(trozo(vertices, inicio, k));

describe("sector que da servicio", () => {
  it("de frente: el sector cuyo eje apunta al punto, sin pérdida", () => {
    const punto = desde(TRES_SECTORES, 120, 100);
    assert.strictEqual(punto.sector, 1);
    assert.closeTo(punto.gananciaDb, 0, 1e-9);
    assert.closeTo(punto.desviacion, 0, 1e-9);
    assert.closeTo(punto.distancia, 100, 1e-9);
    assert.closeTo(punto.rumbo, 120, 1e-9);
  });

  it("un poco fuera del eje pierde según el diagrama, con el signo del lado", () => {
    const derecha = desde(TRES_SECTORES, 32.5, 80);
    assert.strictEqual(derecha.sector, 0);
    assert.closeTo(derecha.gananciaDb, -3, 1e-9);
    assert.closeTo(derecha.desviacion, 32.5, 1e-9);
    const izquierda = desde(TRES_SECTORES, 360 - 32.5, 80);
    assert.strictEqual(izquierda.sector, 0);
    assert.closeTo(izquierda.desviacion, -32.5, 1e-9);
  });

  it("entre dos sectores pierde unos 10 dB, y en el empate exacto gana el primero", () => {
    const borde = desde(TRES_SECTORES, 60, 100);
    assert.strictEqual(borde.sector, 0);
    assert.closeTo(borde.gananciaDb, -12 * (60 / 65) ** 2, 1e-9);
    const pasado = desde(TRES_SECTORES, 61, 100);
    assert.strictEqual(pasado.sector, 1);
    assert.closeTo(pasado.desviacion, -59, 1e-9);
    // Con tres sectores, lo peor es el borde: nunca se pierden más de 10,3 dB.
    for (let rumbo = 0; rumbo < 360; rumbo += 7) {
      assert.isAtLeast(desde(TRES_SECTORES, rumbo, 100).gananciaDb, -10.3);
    }
  });

  it("detrás de la antena de un solo sector se satura en la atenuación máxima", () => {
    const uno = { ...TRES_SECTORES, azimuts: [90] };
    const detras = desde(uno, 270, 150);
    assert.strictEqual(detras.sector, 0);
    assert.strictEqual(detras.gananciaDb, -30);
    assert.closeTo(Math.abs(detras.desviacion), 180, 1e-9);
  });

  it("junto al emplazamiento no elige sector ni pérdida, pero da la distancia", () => {
    const junto = desde(TRES_SECTORES, 200, DISTANCIA_JUNTO_M - 1);
    assert.strictEqual(junto.sector, -1);
    assert.strictEqual(junto.gananciaDb, 0);
    assert.closeTo(junto.distancia, DISTANCIA_JUNTO_M - 1, 1e-9);
    assert.strictEqual(desde(TRES_SECTORES, 200, DISTANCIA_JUNTO_M + 0.01).sector, 2);
    // Justo encima, sin rumbo que valga.
    const encima = sectorServicio.ejecutar(TRES_SECTORES, {
      este: Float64Array.of(0),
      norte: Float64Array.of(0),
    });
    assert.strictEqual(encima.sector[0], -1);
    assert.strictEqual(encima.enCelda[0], 1);
  });

  it("un punto fuera de la celda sigue teniendo sector, y lo dice", () => {
    const fuera = desde(TRES_SECTORES, 0, 400);
    assert.strictEqual(fuera.sector, 0);
    assert.strictEqual(fuera.enCelda, 0);
    assert.strictEqual(desde(TRES_SECTORES, 0, 100).enCelda, 1);
    // Sin celda no sabe si está dentro.
    assert.strictEqual(desde({ ...TRES_SECTORES, celda: [] }, 0, 100).enCelda, -1);
  });

  it("reparte la celda entre los sectores sin dejarse nada", () => {
    const { sectores, inicioSectores } = sectorServicio.ejecutar(TRES_SECTORES, SIN_MALLA);
    assert.lengthOf(inicioSectores, 4);
    const suma = [0, 1, 2].reduce((t, k) => t + areaDe(sectores, inicioSectores, k), 0);
    assert.closeTo(suma, area(Float64Array.from(CELDA)), 1e-6);
    // Tres límites, en las bisectrices de los ejes: 60°, 180° y 300°.
    const { cortes } = sectorServicio.ejecutar(TRES_SECTORES, SIN_MALLA);
    const rumbos = Array.from({ length: cortes.length / 2 }, (_, i) =>
      Math.round(
        ((Math.atan2(cortes[2 * i] ?? 0, cortes[2 * i + 1] ?? 0) * 180) / Math.PI + 360) % 360,
      ),
    ).toSorted((a, b) => a - b);
    assert.deepStrictEqual(rumbos, [60, 180, 300]);
    const uno = sectorServicio.ejecutar({ ...TRES_SECTORES, azimuts: [90] }, SIN_MALLA);
    assert.lengthOf(uno.cortes, 0);
    // Un punto al este cae en el sector de 120°.
    assert.isTrue(contiene(trozo(sectores, inicioSectores, 1), 100, -20));
  });

  it("el degradado cubre el sector que da servicio en bandas cada vez más grandes", () => {
    const { resultado } = desde(TRES_SECTORES, 120, 100);
    const { bandas, inicioBandas, perdidaBandas, sectores, inicioSectores } = resultado;
    const cuantas = inicioBandas.length - 1;
    assert.isAbove(cuantas, 5);
    assert.deepStrictEqual(
      [...perdidaBandas],
      Array.from({ length: cuantas }, (_, k) => k * PASO_DEGRADADO_DB),
    );
    const areas = Array.from({ length: cuantas }, (_, k) => areaDe(bandas, inicioBandas, k));
    for (let k = 1; k < cuantas; k++) assert.isAbove(areas[k] ?? 0, areas[k - 1] ?? 0);
    // La última es el sector entero.
    assert.closeTo(areas.at(-1) ?? 0, areaDe(sectores, inicioSectores, 1), 1e-6);
    // Cada banda llega a donde las pérdidas urbanas suben su paso: un punto a 37 m no está en
    // la primera (35 m) y sí en la segunda (2 dB más, unos 39,6 m).
    const primera = trozo(bandas, inicioBandas, 0);
    const segunda = trozo(bandas, inicioBandas, 1);
    assert.isFalse(
      contiene(primera, 37 * Math.sin((2 * Math.PI) / 3), 37 * Math.cos((2 * Math.PI) / 3)),
    );
    assert.isTrue(
      contiene(segunda, 37 * Math.sin((2 * Math.PI) / 3), 37 * Math.cos((2 * Math.PI) / 3)),
    );
    assert.closeTo(perdidaUrbana(39.56, 1800) - perdidaUrbana(35, 1800), PASO_DEGRADADO_DB, 0.01);
  });

  it("sin punto, o junto al emplazamiento, el degradado cubre la celda entera", () => {
    const celda = area(Float64Array.from(CELDA));
    for (const malla of [SIN_MALLA, mallaEnRumbo(10, [2])]) {
      const { bandas, inicioBandas } = sectorServicio.ejecutar(TRES_SECTORES, malla);
      const ultima = inicioBandas.length - 2;
      assert.closeTo(areaDe(bandas, inicioBandas, ultima), celda, 1e-6);
    }
  });

  it("sin celda no hay reparto ni degradado", () => {
    const { bandas, sectores, inicioSectores } = sectorServicio.ejecutar(
      { ...TRES_SECTORES, celda: [] },
      mallaEnRumbo(0, [100]),
    );
    assert.lengthOf(bandas, 0);
    assert.lengthOf(sectores, 0);
    assert.lengthOf(inicioSectores, 4);
  });

  it.effect("coincide con su fichero de referencia", () =>
    Effect.gen(function* () {
      const diferencias = yield* compararConReferencia(
        sectorServicio,
        [
          { nombre: "de frente", params: TRES_SECTORES, malla: mallaEnRumbo(120, [100]) },
          { nombre: "entre dos sectores", params: TRES_SECTORES, malla: mallaEnRumbo(55, [90]) },
          {
            nombre: "detrás de un solo sector",
            params: { ...TRES_SECTORES, azimuts: [90] },
            malla: mallaEnRumbo(265, [120]),
          },
          {
            nombre: "sobre el emplazamiento",
            params: TRES_SECTORES,
            malla: mallaEnRumbo(0, [0]),
          },
          { nombre: "fuera de la celda", params: TRES_SECTORES, malla: mallaEnRumbo(300, [400]) },
          { nombre: "sin punto", params: TRES_SECTORES, malla: SIN_MALLA },
        ],
        1e-9,
      );
      assert.deepStrictEqual(diferencias, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
