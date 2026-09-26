import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";

import { cajaConMargen, nombreDeAgrupacion, nombreDeMarcador } from "./marcadores.ts";

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
