import { assert, describe, it } from "@effect/vitest";

import { DURACION_DEL_VUELO_MS, LLEGADA_AL_JUNTARSE, momentoDelVuelo } from "./vuelo.ts";

describe("el vuelo de los puntos al cambiar de vista", () => {
  const junta = { sentido: "junta", opacidad: 0.8, fundidoMs: 0 } as const;
  const separa = { sentido: "separa", opacidad: 0.8, fundidoMs: 250 } as const;

  it("al juntarse salen de su sitio enteros y se apagan al llegar a su hexágono", () => {
    assert.deepStrictEqual(momentoDelVuelo(junta, 0), { t: 0, opacidad: 0.8, acabado: false });
    const llegando = momentoDelVuelo(junta, LLEGADA_AL_JUNTARSE * DURACION_DEL_VUELO_MS);
    assert.isAbove(llegando.t, 0.5);
    assert.closeTo(llegando.opacidad, 0.8, 1e-9);
    assert.deepStrictEqual(momentoDelVuelo(junta, DURACION_DEL_VUELO_MS), {
      t: 1,
      opacidad: 0,
      acabado: true,
    });
  });

  it("al separarse salen del hexágono, se encienden y, tras el fundido, acaban", () => {
    assert.deepStrictEqual(momentoDelVuelo(separa, 0), { t: 0, opacidad: 0, acabado: false });
    const mitad = momentoDelVuelo(separa, DURACION_DEL_VUELO_MS / 2);
    assert.closeTo(mitad.t, 0.5, 1e-9);
    assert.closeTo(mitad.opacidad, 0.8, 1e-9);
    assert.isFalse(momentoDelVuelo(separa, DURACION_DEL_VUELO_MS + 100).acabado);
    assert.deepStrictEqual(momentoDelVuelo(separa, DURACION_DEL_VUELO_MS + 250), {
      t: 1,
      opacidad: 0,
      acabado: true,
    });
    assert.isTrue(momentoDelVuelo({ ...separa, fundidoMs: 0 }, DURACION_DEL_VUELO_MS).acabado);
  });

  it("va siempre hacia delante, sin pasarse", () => {
    let antes = -1;
    for (let ms = 0; ms <= DURACION_DEL_VUELO_MS + 100; ms += 10) {
      const { t } = momentoDelVuelo(junta, ms);
      assert.isAtLeast(t, antes);
      assert.isAtMost(t, 1);
      antes = t;
    }
  });
});
