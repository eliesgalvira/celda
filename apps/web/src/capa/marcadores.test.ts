import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";

import type { ElementoProvincia } from "./agrupacion.ts";
import {
  cajaConMargen,
  nombreDeAgrupacion,
  nombreDeMarcador,
  nombreDeProvincia,
} from "./marcadores.ts";
import { crearAgrupadorNacional } from "./nacional.ts";
import { estados, MUNDO, RESUMEN, resumenConBarcelona } from "./pruebasNacional.ts";

const en = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
});

describe("caja con margen", () => {
  it("amplía la vista un 15 % por cada lado", () => {
    const caja = cajaConMargen({
      suroeste: { longitud: 2.1, latitud: 41.38 },
      noreste: { longitud: 2.12, latitud: 41.39 },
    });
    assert.closeTo(caja.suroeste.longitud, 2.097, 1e-9);
    assert.closeTo(caja.noreste.longitud, 2.123, 1e-9);
    assert.closeTo(caja.suroeste.latitud, 41.3785, 1e-9);
    assert.closeTo(caja.noreste.latitud, 41.3915, 1e-9);
  });
});

describe("nombre accesible de un marcador", () => {
  it("dice qué compañías emiten allí, y el estado si no está verificado", () => {
    assert.strictEqual(nombreDeMarcador(en("a", 0, 0)), "Emplazamiento de Movistar");
    assert.strictEqual(
      nombreDeMarcador({
        ...en("b", 0, 0),
        companias: ["movistar", "vodafone", "orange"],
        estado: "corregido",
      }),
      "Emplazamiento compartido por Movistar, Vodafone y Orange, corregido",
    );
    assert.strictEqual(
      nombreDeMarcador({ ...en("c", 0, 0), companias: ["orange", "digi"] }),
      "Emplazamiento compartido por Orange y Digi",
    );
  });
});

describe("nombre accesible de una agrupación", () => {
  it("empieza por el número que se ve y dice qué hace al pulsarla", () => {
    assert.strictEqual(nombreDeAgrupacion(12), "12 emplazamientos, acercar");
  });
});

describe("nombre accesible de una provincia", () => {
  const hexagonos = (resumen = RESUMEN) =>
    [...crearAgrupadorNacional(resumen, estados()).escena(6, MUNDO).elementos.values()].filter(
      (e): e is ElementoProvincia => e.tipo === "provincia",
    );

  it("dice su número y qué hace al pulsarla", () => {
    const [barcelona, , lleida] = hexagonos();
    assert.strictEqual(
      barcelona && nombreDeProvincia(barcelona),
      "Barcelona, 40 emplazamientos, acercar",
    );
    assert.strictEqual(
      lleida && nombreDeProvincia(lleida),
      "Lleida, Celda aún no tiene sus emplazamientos, acercar",
    );
  });

  it("una provincia a medias dice que su número es solo de una parte", () => {
    const [barcelona] = hexagonos(resumenConBarcelona(false));
    assert.strictEqual(
      barcelona && nombreDeProvincia(barcelona),
      "Barcelona, 40 emplazamientos en la parte que Celda ya tiene, acercar",
    );
  });
});

describe("nombres accesibles con un filtro de compañías (ADR 0026)", () => {
  it("dicen de quién son los emplazamientos que se cuentan, y los de la red usada, de qué red", () => {
    assert.strictEqual(
      nombreDeAgrupacion(12, ["movistar", "vodafone"]),
      "12 emplazamientos de Movistar y Vodafone, acercar",
    );
    assert.strictEqual(
      nombreDeAgrupacion(30, ["digi"], true),
      "30 emplazamientos de Movistar, la red que usa Digi, acercar",
    );
    assert.strictEqual(
      nombreDeAgrupacion(30, ["digi", "yoigo"], true),
      "30 emplazamientos de Movistar y Orange, las redes que usan Digi y Yoigo, acercar",
    );
    assert.strictEqual(
      nombreDeMarcador({ ...en("m", 0, 0), companias: ["movistar", "vodafone"] }, ["digi"], true),
      "Emplazamiento compartido por Movistar y Vodafone, red que usa Digi",
    );
    assert.strictEqual(
      nombreDeMarcador({ ...en("m", 0, 0), companias: ["movistar", "digi"] }, ["digi"]),
      "Emplazamiento compartido por Movistar y Digi",
    );
  });

  it("el de una provincia cuenta lo del filtro, aparte la red usada, y dice si aún cuenta todas", () => {
    const [barcelona] = provinciasDeRESUMEN();
    if (barcelona === undefined) return assert.fail("sin Barcelona");
    assert.strictEqual(
      nombreDeProvincia({ ...barcelona, cuantos: 3, deLaRed: 20 }, ["digi"]),
      "Barcelona, 3 emplazamientos de Digi y 20 de Movistar, la red que usa Digi, acercar",
    );
    assert.strictEqual(
      nombreDeProvincia({ ...barcelona, sinFiltrar: true }, ["digi"]),
      `Barcelona, ${barcelona.cuantos} emplazamientos de todas las compañías, acercar`,
    );
  });
});

/** Los hexágonos de las provincias del resumen de prueba, de lejos. */
const provinciasDeRESUMEN = (): ReadonlyArray<ElementoProvincia> =>
  [...crearAgrupadorNacional(RESUMEN, estados()).escena(6, MUNDO).elementos.values()].filter(
    (e): e is ElementoProvincia => e.tipo === "provincia",
  );
