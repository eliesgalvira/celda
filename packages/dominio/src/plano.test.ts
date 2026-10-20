import { assert, describe, it } from "@effect/vitest";

import { distanciaMetros } from "./area.ts";
import { aPlano, desdePlano } from "./plano.ts";

const PLAZA_CATALUNYA = { longitud: 2.1701, latitud: 41.3871 };
const CAMPUS_NORD = { longitud: 2.113412, latitud: 41.389278 };

describe("plano local", () => {
  it("pone el origen en (0, 0), el este a la derecha y el norte arriba", () => {
    assert.deepStrictEqual(aPlano(PLAZA_CATALUNYA, PLAZA_CATALUNYA), { este: 0, norte: 0 });
    const campus = aPlano(PLAZA_CATALUNYA, CAMPUS_NORD);
    assert.isBelow(campus.este, 0);
    assert.isAbove(campus.norte, 0);
  });

  it("mide en metros lo mismo que distanciaMetros", () => {
    const { este, norte } = aPlano(PLAZA_CATALUNYA, CAMPUS_NORD);
    assert.closeTo(Math.hypot(este, norte), distanciaMetros(PLAZA_CATALUNYA, CAMPUS_NORD), 5);
  });

  it("vuelve al mismo punto del mapa", () => {
    const vuelta = desdePlano(PLAZA_CATALUNYA, aPlano(PLAZA_CATALUNYA, CAMPUS_NORD));
    assert.closeTo(vuelta.longitud, CAMPUS_NORD.longitud, 1e-12);
    assert.closeTo(vuelta.latitud, CAMPUS_NORD.latitud, 1e-12);
  });
});
