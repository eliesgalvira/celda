import { assert, describe, it } from "@effect/vitest";

import { enLaComunitatValenciana } from "./comunitatValenciana.ts";

describe("contorno de la Comunitat Valenciana", () => {
  it("tiene dentro sus ciudades y el Rincón de Ademuz, y fuera las de al lado", () => {
    const casos: ReadonlyArray<readonly [string, number, number, boolean]> = [
      ["València", -0.3763, 39.4699, true],
      ["Alacant", -0.481, 38.3452, true],
      ["Castelló de la Plana", -0.0513, 39.9864, true],
      ["Elx", -0.6982, 38.2669, true],
      ["Ademuz", -1.2858, 40.0614, true],
      ["Teruel", -1.1065, 40.3456, false],
      ["Cuenca", -2.1374, 40.0704, false],
      ["Murcia", -1.1307, 37.9922, false],
      ["Tortosa", 0.5216, 40.8125, false],
      ["Pamplona", -1.6432, 42.8169, false],
      ["Palma", 2.6502, 39.5696, false],
    ];
    for (const [lugar, longitud, latitud, dentro] of casos) {
      assert.strictEqual(enLaComunitatValenciana({ longitud, latitud }), dentro, lugar);
    }
  });
});
