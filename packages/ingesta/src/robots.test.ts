import { assert, describe, it } from "@effect/vitest";

import { leerRobots, permitido, SIN_RESTRICCIONES } from "./robots.ts";

const ANTENASMOVILES = `User-agent: *
Disallow: /api
Disallow: /archive
Disallow: /assets
`;

describe("robots.txt", () => {
  it("sin fichero todo está permitido", () => {
    assert.isTrue(permitido(SIN_RESTRICCIONES, "/VCTEL/infoantenasGeoJSON.do?bbox=1,2,3,4"));
  });

  it("aplica el grupo * si no hay uno propio", () => {
    const robots = leerRobots(ANTENASMOVILES, "Celda");
    assert.isTrue(permitido(robots, "/v1/markers?id=000455"));
    assert.isFalse(permitido(robots, "/assets/propios/mapFunctions.js"));
  });

  it("un grupo propio sustituye al de *", () => {
    const robots = leerRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: celda\nUser-agent: otro\nDisallow: /VCTEL/detalleEstacion.do\n`,
      "Celda",
    );
    assert.isTrue(permitido(robots, "/VCTEL/infoantenasGeoJSON.do"));
    assert.isFalse(permitido(robots, "/VCTEL/detalleEstacion.do?emplazamiento=1"));
  });

  it("gana la regla más larga, y Allow si empatan", () => {
    const robots = leerRobots(
      "User-agent: *\nDisallow: /VCTEL/\nAllow: /VCTEL/infoantenas\n# comentario\n",
      "Celda",
    );
    assert.isTrue(permitido(robots, "/VCTEL/infoantenasGeoJSON.do"));
    assert.isFalse(permitido(robots, "/VCTEL/detalleEstacion.do"));
  });

  it("un Disallow vacío no prohíbe nada", () => {
    assert.isTrue(permitido(leerRobots("User-agent: *\nDisallow:\n", "Celda"), "/"));
  });
});
