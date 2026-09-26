import { assert, describe, it } from "@effect/vitest";

import { ANCHO_ESCRITORIO, colocarExplicacion, MARGEN, SEPARACION } from "./posicion.ts";

const ESCRITORIO = { ancho: 1400, alto: 900 };
const MOVIL = { ancho: 390, alto: 844 };
const palabra = (izquierda: number, arriba: number) => ({ izquierda, arriba, ancho: 60, alto: 20 });

describe("colocarExplicacion", () => {
  it("en escritorio va debajo del término, centrada y con 22rem de ancho", () => {
    const colocacion = colocarExplicacion(palabra(200, 300), 180, ESCRITORIO);
    assert.strictEqual(colocacion.lado, "abajo");
    assert.strictEqual(colocacion.arriba, 320 + SEPARACION);
    assert.strictEqual(colocacion.ancho, ANCHO_ESCRITORIO);
    assert.strictEqual(colocacion.izquierda, 230 - ANCHO_ESCRITORIO / 2);
    assert.strictEqual(colocacion.pico, ANCHO_ESCRITORIO / 2);
  });

  it("si no cabe debajo, va encima y no tapa el término", () => {
    const colocacion = colocarExplicacion(palabra(200, 800), 180, ESCRITORIO);
    assert.strictEqual(colocacion.lado, "arriba");
    assert.strictEqual(colocacion.arriba + 180, 800 - SEPARACION);
  });

  it("en el móvil ocupa todo el ancho menos los márgenes, con el pico sobre el término", () => {
    const colocacion = colocarExplicacion(palabra(20, 500), 220, MOVIL);
    assert.strictEqual(colocacion.izquierda, MARGEN);
    assert.strictEqual(colocacion.ancho, 390 - 2 * MARGEN);
    // El pico no se sale por la esquina cortada.
    assert.isAtLeast(colocacion.pico, 22);
    assert.isAtMost(colocacion.pico, 50 - MARGEN);
  });

  it("no se sale por la derecha", () => {
    const colocacion = colocarExplicacion(palabra(1360, 300), 180, ESCRITORIO);
    assert.strictEqual(colocacion.izquierda + colocacion.ancho, 1400 - MARGEN);
  });

  it("si no cabe en ningún lado, usa el que tiene más sitio y se desplaza por dentro", () => {
    const colocacion = colocarExplicacion(palabra(20, 250), 700, { ancho: 390, alto: 600 });
    assert.strictEqual(colocacion.lado, "abajo");
    assert.strictEqual(colocacion.altoMaximo, 600 - MARGEN - (270 + SEPARACION));
    // Aun así, empieza debajo del término: no lo tapa.
    assert.isAtLeast(colocacion.arriba, 270);
  });
});
