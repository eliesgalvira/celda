// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  type CajaDelPlano,
  celdas,
  type ParamsCeldas,
  poligonoDe,
  type PuntoDelPlano,
  repartirEnSectores,
  sectorDeRumbo,
} from "./celdas.ts";
import { diagramaSector, SECTOR_TIPICO } from "./diagramaSector.ts";
import { area, areaConSigno, contiene, type Poligono, recortar } from "./poligono.ts";
import { compararConReferencia } from "./referencias.ts";
import { type Malla, mallaEnRumbo, rumboDe } from "./simulacion.ts";

/** Números entre 0 y 1 que se repiten con la misma semilla (generador congruencial). */
const azar = (semilla: number) => {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1_664_525) + 1_013_904_223) >>> 0;
    return estado / 2 ** 32;
  };
};

const CAJA: CajaDelPlano = { oeste: -1000, sur: -600, este: 1400, norte: 900 };
const AREA_CAJA = (CAJA.este - CAJA.oeste) * (CAJA.norte - CAJA.sur);

const alAzar = (
  cuantos: number,
  semilla: number,
  caja: CajaDelPlano = CAJA,
): Array<PuntoDelPlano> => {
  const siguiente = azar(semilla);
  return Array.from({ length: cuantos }, () => ({
    este: caja.oeste + siguiente() * (caja.este - caja.oeste),
    norte: caja.sur + siguiente() * (caja.norte - caja.sur),
  }));
};

const mallaDe = (puntos: ReadonlyArray<PuntoDelPlano>): Malla => ({
  este: Float64Array.from(puntos, (p) => p.este),
  norte: Float64Array.from(puntos, (p) => p.norte),
});

const SIN_MALLA = mallaDe([]);

/** El emplazamiento más cercano comparando con todos; en un empate, el primero. */
const masCercano = (emplazamientos: ReadonlyArray<PuntoDelPlano>, punto: PuntoDelPlano) => {
  let mejor = -1;
  let distancia = Infinity;
  for (const [k, e] of emplazamientos.entries()) {
    const d = Math.hypot(e.este - punto.este, e.norte - punto.norte);
    if (d < distancia) {
      mejor = k;
      distancia = d;
    }
  }
  return mejor;
};

/** Área común de dos polígonos convexos en sentido antihorario: uno recortado por cada lado del otro. */
const areaComun = (a: Poligono, b: Poligono): number => {
  let resto: ReadonlyArray<number> = [...a];
  const m = b.length / 2;
  for (let i = 0; i < m && resto.length > 0; i++) {
    const j = (i + 1) % m;
    const [ae, an, be, bn] = [b[2 * i] ?? 0, b[2 * i + 1] ?? 0, b[2 * j] ?? 0, b[2 * j + 1] ?? 0];
    // Lo que queda a la izquierda del lado de `a` a `b`.
    resto = recortar(resto, bn - an, ae - be, (bn - an) * ae + (ae - be) * an);
  }
  return area(Float64Array.from(resto));
};

const CONFIGURACIONES: ReadonlyArray<{
  readonly nombre: string;
  readonly emplazamientos: ReadonlyArray<PuntoDelPlano>;
}> = [
  { nombre: "uno solo", emplazamientos: alAzar(1, 1) },
  { nombre: "dos", emplazamientos: alAzar(2, 2) },
  { nombre: "cuarenta al azar", emplazamientos: alAzar(40, 3) },
  {
    nombre: "cuatrocientos, con algunos fuera de la caja",
    emplazamientos: alAzar(400, 4, { oeste: -1500, sur: -900, este: 1900, norte: 1200 }),
  },
  {
    nombre: "en fila y con repetidos",
    emplazamientos: [0, 100, 100, 250, 600, 600, 610].map((este) => ({ este, norte: 50 })),
  },
  {
    nombre: "en rejilla, con empates en todas las esquinas",
    emplazamientos: Array.from({ length: 30 }, (_, i) => ({
      este: -800 + (i % 6) * 400,
      norte: -400 + Math.floor(i / 6) * 300,
    })),
  },
];

describe("celdas", () => {
  for (const { nombre, emplazamientos } of CONFIGURACIONES) {
    describe(nombre, () => {
      const puntos = [
        ...alAzar(3000, 99),
        // Las esquinas y los bordes de la caja también son de alguna celda.
        { este: CAJA.oeste, norte: CAJA.sur },
        { este: CAJA.este, norte: CAJA.norte },
        { este: CAJA.oeste, norte: 0 },
      ];
      const resultado = celdas.ejecutar({ emplazamientos, caja: CAJA }, mallaDe(puntos));
      const poligonos = emplazamientos.map((_, k) => poligonoDe(resultado, k));

      it("cubren la caja: sus áreas suman la de la caja", () => {
        const suma = poligonos.reduce((total, p) => total + area(p), 0);
        assert.closeTo(suma, AREA_CAJA, AREA_CAJA * 1e-9);
      });

      it("no se solapan: dos celdas no tienen área en común", () => {
        for (const [i, a] of poligonos.entries()) {
          for (const b of poligonos.slice(i + 1)) {
            if (a.length > 0 && b.length > 0) assert.isBelow(areaComun(a, b), 1e-6);
          }
        }
      });

      it("cada celda va en sentido antihorario y contiene los puntos más cercanos a su emplazamiento", () => {
        for (const p of poligonos) {
          if (p.length > 0) assert.isAbove(areaConSigno(p), 0);
        }
        for (const [i, punto] of puntos.entries()) {
          const cercano = masCercano(emplazamientos, punto);
          assert.strictEqual(resultado.celda[i], cercano);
          if (i < 3000) {
            // Dentro de la celda del más cercano y de ninguna otra.
            const dentro = poligonos.flatMap((p, k) =>
              contiene(p, punto.este, punto.norte) ? [k] : [],
            );
            assert.deepStrictEqual(dentro, [cercano]);
          }
        }
      });
    });
  }

  it("cuatro emplazamientos en cuadrado se reparten la caja en cuatro cuadrantes", () => {
    const caja = { oeste: -10, sur: -10, este: 10, norte: 10 };
    const resultado = celdas.ejecutar(
      {
        emplazamientos: [
          { este: 5, norte: 5 },
          { este: -5, norte: 5 },
          { este: -5, norte: -5 },
          { este: 5, norte: -5 },
        ],
        caja,
      },
      SIN_MALLA,
    );
    for (let k = 0; k < 4; k++) assert.closeTo(area(poligonoDe(resultado, k)), 100, 1e-9);
    assert.isTrue(contiene(poligonoDe(resultado, 0), 9, 9));
    assert.isTrue(contiene(poligonoDe(resultado, 2), -9, -9));
  });

  it("un emplazamiento repetido deja la celda al primero y el otro se queda sin ella", () => {
    const resultado = celdas.ejecutar(
      {
        emplazamientos: [
          { este: 0, norte: 0 },
          { este: 300, norte: 0 },
          { este: 0, norte: 0 },
        ],
        caja: CAJA,
      },
      mallaDe([{ este: -10, norte: 0 }]),
    );
    assert.isAbove(area(poligonoDe(resultado, 0)), 0);
    assert.strictEqual(poligonoDe(resultado, 2).length, 0);
    assert.strictEqual(resultado.celda[0], 0);
  });

  it("un punto fuera de la caja no es de ninguna celda, y sin emplazamientos no hay celdas", () => {
    const fuera = mallaDe([{ este: CAJA.este + 1, norte: 0 }]);
    assert.deepStrictEqual(
      [...celdas.ejecutar({ emplazamientos: [{ este: 0, norte: 0 }], caja: CAJA }, fuera).celda],
      [-1],
    );
    const vacio = celdas.ejecutar({ emplazamientos: [], caja: CAJA }, fuera);
    assert.deepStrictEqual([...vacio.inicio], [0]);
    assert.deepStrictEqual([...vacio.celda], [-1]);
  });

  it.effect("coincide con su fichero de referencia", () =>
    Effect.gen(function* () {
      const casos: ReadonlyArray<{
        readonly nombre: string;
        readonly params: ParamsCeldas;
        readonly malla: Malla;
      }> = [
        {
          nombre: "cuatro en cuadrado",
          params: {
            emplazamientos: [
              { este: 5, norte: 5 },
              { este: -5, norte: 5 },
              { este: -5, norte: -5 },
              { este: 5, norte: -5 },
            ],
            caja: { oeste: -10, sur: -10, este: 10, norte: 10 },
          },
          malla: mallaDe([
            { este: 1, norte: 1 },
            { este: -3, norte: 7 },
            { este: 11, norte: 0 },
          ]),
        },
        {
          nombre: "doce al azar",
          params: { emplazamientos: alAzar(12, 7), caja: CAJA },
          malla: mallaDe(alAzar(10, 8)),
        },
        {
          nombre: "repetidos y fuera de la caja",
          params: {
            emplazamientos: [
              { este: 0, norte: 0 },
              { este: 0, norte: 0 },
              { este: 400, norte: 200 },
              { este: 5000, norte: 5000 },
            ],
            caja: CAJA,
          },
          malla: mallaDe([
            { este: 1, norte: 1 },
            { este: 1300, norte: 850 },
          ]),
        },
      ];
      const diferencias = yield* compararConReferencia(celdas, casos, 1e-9);
      assert.deepStrictEqual(diferencias, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("reparto de una celda por sectores", () => {
  const emplazamientos = alAzar(30, 11);
  const resultado = celdas.ejecutar({ emplazamientos, caja: CAJA }, SIN_MALLA);
  const k = 5;
  const celda = poligonoDe(resultado, k);
  const sitio = emplazamientos[k] ?? { este: 0, norte: 0 };
  const puntos = alAzar(4000, 12).filter((p) => contiene(celda, p.este, p.norte));

  /** Los puntos de la celda, con el sector de cada uno según el rumbo desde el emplazamiento. */
  const comprobar = (azimuts: ReadonlyArray<number>) => {
    const sectores = repartirEnSectores(celda, sitio, azimuts);
    assert.lengthOf(sectores, azimuts.length);
    const suma = sectores.reduce((total, p) => total + area(p), 0);
    assert.closeTo(suma, area(celda), area(celda) * 1e-9);
    for (const p of sectores) {
      if (p.length > 0) assert.isAbove(areaConSigno(p), 0);
    }
    for (const punto of puntos) {
      const rumbo = rumboDe(
        mallaDe([{ este: punto.este - sitio.este, norte: punto.norte - sitio.norte }]),
        0,
      );
      const dentro = sectores.flatMap((p, s) => (contiene(p, punto.este, punto.norte) ? [s] : []));
      assert.deepStrictEqual(dentro, [sectorDeRumbo(rumbo, azimuts)]);
    }
    return sectores;
  };

  it("hay puntos de sobra en la celda para comprobarlo", () => {
    assert.isAbove(puntos.length, 50);
  });

  it("con tres sectores a 120°, cubre la celda sin solapes y cada punto va a su sector", () => {
    comprobar([0, 120, 240]);
    comprobar([35, 155, 275]);
  });

  it("con sectores desiguales, alguno de más de 180°, también", () => {
    comprobar([10, 40, 200]);
    comprobar([300, 20]);
  });

  it("un azimut repetido se queda sin polígono y uno solo se queda la celda entera", () => {
    const repetidos = comprobar([0, 0, 180]);
    assert.strictEqual(repetidos[1]?.length, 0);
    const uno = comprobar([45]);
    assert.closeTo(area(uno[0] ?? new Float64Array(0)), area(celda), 1e-6);
  });

  it("coincide con el sector que más ganancia da en el diagrama de sector", () => {
    const azimuts = [30, 150, 270];
    const [primero] = repartirEnSectores(celda, sitio, azimuts);
    const rumbos = Array.from({ length: 72 }, (_, i) => i * 5 + 2.5);
    for (const rumbo of rumbos) {
      const { sector } = diagramaSector.ejecutar(
        { azimuts, ...SECTOR_TIPICO },
        mallaEnRumbo(rumbo, [1]),
      );
      assert.strictEqual(sector[0], sectorDeRumbo(rumbo, azimuts), `rumbo ${rumbo}`);
    }
    assert.isAbove(area(primero ?? new Float64Array(0)), 0);
  });

  it("sin el emplazamiento dentro de su celda no hay reparto", () => {
    const fuera = repartirEnSectores(celda, { este: CAJA.este + 50, norte: 0 }, [0, 120, 240]);
    assert.deepStrictEqual(
      fuera.map((p) => p.length),
      [0, 0, 0],
    );
  });
});
