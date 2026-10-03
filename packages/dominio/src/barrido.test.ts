import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  type Caja,
  cajaDeCuadro,
  cuadroDe,
  cubrenElCuadro,
  dividir,
  divisiones,
  zonaDeBarrido,
  zonaDelCuadro,
  ZONAS_DE_BARRIDO,
} from "./barrido.ts";
import { cuadrosDelRegistro } from "./cuadrosDelRegistro.ts";

describe("rejilla de cuadros del barrido", () => {
  it("un punto cae en el cuadro de su esquina suroeste, también con longitudes negativas", () => {
    assert.strictEqual(cuadroDe({ longitud: 2.113628, latitud: 41.388344 }), "2,41");
    assert.strictEqual(cuadroDe({ longitud: -3.7038, latitud: 40.4168 }), "-4,40");
    assert.strictEqual(cuadroDe({ longitud: -0.5, latitud: 39.47 }), "-1,39");
    // En el borde oeste o sur, el punto es del cuadro.
    assert.strictEqual(cuadroDe({ longitud: 2, latitud: 41 }), "2,41");
    assert.strictEqual(cuadroDe({ longitud: -18, latitud: 27.99 }), "-18,27");
  });

  it("la caja de un cuadro mide 1° y dividirla da cuatro cuartos que la cubren", () => {
    assert.deepStrictEqual(cajaDeCuadro("-4,40"), [-4, 40, -3, 41]);
    const cuartos = dividir(cajaDeCuadro("2,41"));
    assert.deepStrictEqual(cuartos, [
      [2, 41, 2.5, 41.5],
      [2.5, 41, 3, 41.5],
      [2, 41.5, 2.5, 42],
      [2.5, 41.5, 3, 42],
    ]);
    assert.isTrue(cubrenElCuadro("2,41", cuartos));
    assert.deepStrictEqual(cuartos.map(divisiones), [1, 1, 1, 1]);
    assert.strictEqual(divisiones(cajaDeCuadro("2,41")), 0);
  });

  it("solo sirven las cajas guardadas que caen en el cuadro y lo cubren entero", () => {
    const [suroeste, ...resto] = dividir(cajaDeCuadro("2,41"));
    assert.isDefined(suroeste);
    const hondas: ReadonlyArray<Caja> = [...dividir(suroeste), ...resto];
    assert.isTrue(cubrenElCuadro("2,41", hondas));
    assert.strictEqual(divisiones(hondas[0] ?? suroeste), 2);
    // Falta un cuarto, sobran cajas o son de otro cuadro.
    assert.isFalse(cubrenElCuadro("2,41", resto));
    assert.isFalse(cubrenElCuadro("2,41", [...hondas, suroeste]));
    assert.isFalse(cubrenElCuadro("1,41", hondas));
    assert.isFalse(cubrenElCuadro("2,41", []));
  });
});

describe("zonas de barrido", () => {
  it("Cataluña son 9 cuadros y cada cuadro está en una sola zona", () => {
    assert.strictEqual(zonaDeBarrido("cataluna")?.cuadros.length, 9);
    const cuadros = ZONAS_DE_BARRIDO.flatMap((zona) => zona.cuadros);
    assert.strictEqual(cuadros.length, 94);
    assert.strictEqual(new Set(cuadros).size, cuadros.length);
    assert.strictEqual(ZONAS_DE_BARRIDO.length, 7);
    assert.strictEqual(new Set(ZONAS_DE_BARRIDO.map((zona) => zona.nombre)).size, 7);
    assert.isUndefined(zonaDeBarrido("catalunya"));
  });

  it("Barcelona, Madrid, Valencia, Tenerife y Ceuta caen en la zona que les toca", () => {
    const zonaDe = (longitud: number, latitud: number) =>
      ZONAS_DE_BARRIDO.find((zona) => zona.cuadros.includes(cuadroDe({ longitud, latitud })))
        ?.nombre;
    assert.strictEqual(zonaDe(2.17, 41.39), "cataluna");
    assert.strictEqual(zonaDe(0.52, 40.71), "cataluna");
    assert.strictEqual(zonaDe(-3.7, 40.42), "centro");
    assert.strictEqual(zonaDe(-0.38, 39.47), "levante");
    assert.strictEqual(zonaDe(-16.25, 28.46), "oeste-y-canarias");
    assert.strictEqual(zonaDe(-5.32, 35.89), "andalucia");
  });
});

describe("cuadros de las zonas, sacados del registro oficial (ADR 0019)", () => {
  it("un cuadro va a la comunidad con más registros, sumando sus provincias y no su zona", () => {
    // El de Ávila y Segovia: Madrid tiene más registros que cada provincia de Castilla y León,
    // pero Castilla y León suma más.
    const zona = zonaDelCuadro({
      porProvincia: { "05": 281, "28": 407, "40": 222, "45": 208 },
      toca: ["05", "28", "40", "45"],
    });
    assert.strictEqual(zona?.nombre, "ebro-y-duero");
    // País Vasco gana aunque La Rioja y Navarra, de la misma zona, sumen más.
    assert.strictEqual(
      zonaDelCuadro({ porProvincia: { "01": 40, "26": 30, "31": 30 }, toca: [] })?.nombre,
      "norte",
    );
  });

  it("un cuadro que toca Cataluña va a Cataluña, tenga los registros que tenga", () => {
    const zona = zonaDelCuadro({
      porProvincia: { "12": 399, "43": 282, "44": 26 },
      toca: ["12", "43", "44"],
    });
    assert.strictEqual(zona?.nombre, "cataluna");
  });

  it("a igualdad gana la comunidad de código menor, y sin registros, la primera que toca", () => {
    assert.strictEqual(
      zonaDelCuadro({ porProvincia: { "13": 10, "14": 10 }, toca: [] })?.nombre,
      "andalucia",
    );
    assert.strictEqual(
      zonaDelCuadro({ porProvincia: {}, toca: ["10", "06"] })?.nombre,
      "oeste-y-canarias",
    );
    assert.isUndefined(zonaDelCuadro({ porProvincia: {}, toca: [] }));
  });

  it.effect(
    "ZONAS_DE_BARRIDO lleva los cuadros del registro, cada uno en la zona de su regla",
    () =>
      Effect.gen(function* () {
        const registro = yield* cuadrosDelRegistro;
        const enZonas = new Map(
          ZONAS_DE_BARRIDO.flatMap((zona) => zona.cuadros.map((cuadro) => [cuadro, zona.nombre])),
        );
        assert.deepStrictEqual(new Map(registro.cuadros.map((c) => [c.cuadro, c.zona])), enZonas);
        for (const cuadro of registro.cuadros) {
          assert.strictEqual(zonaDelCuadro(cuadro)?.nombre, cuadro.zona, cuadro.cuadro);
          assert.isAbove(cuadro.registros, 0, cuadro.cuadro);
        }
        assert.strictEqual(
          registro.registros,
          registro.cuadros.reduce((suma, c) => suma + c.registros, 0),
        );
        // Los cuadros de borde que trajeron algo están en las zonas.
        for (const borde of registro.borde?.cuadros ?? []) {
          assert.strictEqual(enZonas.has(borde.cuadro), borde.registros > 0, borde.cuadro);
        }
      }),
  );
});
