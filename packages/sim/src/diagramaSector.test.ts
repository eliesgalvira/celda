// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { diagramaSector, type ParamsDiagramaSector, SECTOR_TIPICO } from "./diagramaSector.ts";
import { compararConReferencia } from "./referencias.ts";
import { mallaDeRumbos, mallaEnRumbo } from "./simulacion.ts";

const UN_SECTOR: ParamsDiagramaSector = { azimuts: [0], ...SECTOR_TIPICO };
const TRES_SECTORES: ParamsDiagramaSector = { azimuts: [0, 120, 240], ...SECTOR_TIPICO };

/** Ganancia de un solo sector apuntado al norte hacia el rumbo dado. */
const gananciaHacia = (rumbo: number): number =>
  diagramaSector.ejecutar(UN_SECTOR, mallaEnRumbo(rumbo, [100])).ganancia[0] ?? Number.NaN;

describe("diagrama de sector", () => {
  it("es 0 dB en el eje", () => {
    assert.closeTo(gananciaHacia(0), 0, 1e-9);
  });

  it("pierde 3 dB a 32,5° del eje, a los dos lados", () => {
    assert.closeTo(gananciaHacia(32.5), -3, 1e-9);
    assert.closeTo(gananciaHacia(360 - 32.5), -3, 1e-9);
  });

  it("pierde unos 10 dB a 60° del eje", () => {
    assert.closeTo(gananciaHacia(60), -10, 0.25);
    assert.closeTo(gananciaHacia(300), -10, 0.25);
  });

  it("se satura en −30 dB fuera del haz, también hacia atrás", () => {
    for (const rumbo of [110, 150, 180, 210, 250]) {
      assert.strictEqual(gananciaHacia(rumbo), -30);
    }
    assert.isAbove(gananciaHacia(100), -30);
  });

  it("con tres sectores, cada rumbo lo sirve el sector más cercano a su eje", () => {
    const malla = mallaEnRumbo(0, [1]);
    const rumbos = [10, 100, 130, 200, 250, 350];
    const sectores = rumbos.map(
      (rumbo) => diagramaSector.ejecutar(TRES_SECTORES, mallaEnRumbo(rumbo, [1])).sector[0],
    );
    assert.deepStrictEqual(sectores, [0, 1, 1, 2, 2, 0]);
    // Justo entre dos sectores empatan: gana el primero.
    assert.strictEqual(diagramaSector.ejecutar(TRES_SECTORES, mallaEnRumbo(60, [1])).sector[0], 0);
    assert.strictEqual(diagramaSector.ejecutar(TRES_SECTORES, malla).gananciaMaxima[0], 0);
  });

  it("guarda la ganancia de cada sector en su tramo", () => {
    const malla = mallaDeRumbos(90);
    const { ganancia } = diagramaSector.ejecutar(TRES_SECTORES, malla);
    assert.strictEqual(ganancia.length, 3 * 4);
    // El sector 2 (240°) hacia el oeste (270°): 30° fuera del eje.
    assert.closeTo(ganancia[2 * 4 + 3] ?? Number.NaN, -12 * (30 / 65) ** 2, 1e-9);
  });

  it.effect("coincide con su fichero de referencia", () =>
    Effect.gen(function* () {
      const diferencias = yield* compararConReferencia(
        diagramaSector,
        [
          { nombre: "tres sectores cada 5°", params: TRES_SECTORES, malla: mallaDeRumbos(5) },
          {
            nombre: "dos sectores torcidos y un haz de 90°",
            params: { azimuts: [35, 215], anchoHazGrados: 90, atenuacionMaximaDb: 25 },
            malla: mallaDeRumbos(15),
          },
        ],
        1e-9,
      );
      assert.deepStrictEqual(diferencias, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
