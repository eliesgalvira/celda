import { assert, describe, it } from "@effect/vitest";

import {
  alturaConTecla,
  alturaTrasArrastre,
  alturaTrasToque,
  altoDuranteArrastre,
  pixelesDeAltura,
} from "./hoja.ts";

/** Un móvil de 390 × 844 px. */
const ALTO = 844;

describe("alturas de la hoja inferior", () => {
  it("resumen deja ver el mapa, media llega a la mitad y completa deja la cabecera a la vista", () => {
    const resumen = pixelesDeAltura("resumen", ALTO);
    const media = pixelesDeAltura("media", ALTO);
    const completa = pixelesDeAltura("completa", ALTO);
    assert.isBelow(resumen, ALTO / 4);
    assert.isAbove(media, ALTO / 2);
    assert.isBelow(media, ALTO * 0.6);
    assert.strictEqual(completa, ALTO - 64);
  });

  it("en una ventana muy baja las tres alturas siguen en orden y caben", () => {
    for (const alto of [320, 400, 600, 1200]) {
      const [resumen, media, completa] = (["resumen", "media", "completa"] as const).map((a) =>
        pixelesDeAltura(a, alto),
      );
      assert.isBelow(resumen ?? 0, media ?? 0, `${alto}`);
      assert.isAtMost(media ?? 0, completa ?? 0, `${alto}`);
      assert.isAtMost(completa ?? 0, alto, `${alto}`);
    }
  });

  it("un toque en el tirador sube una altura, y desde completa vuelve al resumen", () => {
    assert.strictEqual(alturaTrasToque("resumen"), "media");
    assert.strictEqual(alturaTrasToque("media"), "completa");
    assert.strictEqual(alturaTrasToque("completa"), "resumen");
  });

  it("al soltar despacio se queda en la altura más cercana", () => {
    const soltar = (pixeles: number) =>
      alturaTrasArrastre({ pixeles, velocidad: 0, altoVentana: ALTO });
    assert.strictEqual(soltar(200), "resumen");
    assert.strictEqual(soltar(pixelesDeAltura("media", ALTO) - 30), "media");
    assert.strictEqual(soltar(pixelesDeAltura("media", ALTO) + 60), "media");
    assert.strictEqual(soltar(ALTO - 100), "completa");
  });

  it("al soltar con impulso sigue hacia donde iba, aunque esté más cerca de la otra", () => {
    const media = pixelesDeAltura("media", ALTO);
    // Un poco por encima de la media, lanzada hacia arriba: completa.
    assert.strictEqual(
      alturaTrasArrastre({ pixeles: media + 20, velocidad: 1.2, altoVentana: ALTO }),
      "completa",
    );
    // Un poco por encima de la media, lanzada hacia abajo: media, la siguiente por debajo.
    assert.strictEqual(
      alturaTrasArrastre({ pixeles: media + 20, velocidad: -1.2, altoVentana: ALTO }),
      "media",
    );
    // Desde el resumen hacia abajo no hay nada más bajo: se queda en el resumen.
    assert.strictEqual(
      alturaTrasArrastre({ pixeles: 150, velocidad: -2, altoVentana: ALTO }),
      "resumen",
    );
    // Desde casi arriba hacia arriba: completa.
    assert.strictEqual(
      alturaTrasArrastre({ pixeles: ALTO - 50, velocidad: 2, altoVentana: ALTO }),
      "completa",
    );
  });

  it("mientras se arrastra, la hoja sigue al dedo sin salirse de la pantalla", () => {
    const inicio = pixelesDeAltura("resumen", ALTO);
    assert.strictEqual(altoDuranteArrastre(inicio, 100, ALTO), inicio + 100);
    assert.strictEqual(altoDuranteArrastre(inicio, 5000, ALTO), ALTO - 40);
    assert.strictEqual(altoDuranteArrastre(inicio, -5000, ALTO), 120);
  });

  it("con el teclado, las flechas suben y bajan una altura, e Inicio y Fin van a los extremos", () => {
    assert.strictEqual(alturaConTecla("resumen", "ArrowUp"), "media");
    assert.strictEqual(alturaConTecla("completa", "ArrowUp"), "completa");
    assert.strictEqual(alturaConTecla("media", "ArrowDown"), "resumen");
    assert.strictEqual(alturaConTecla("resumen", "ArrowDown"), "resumen");
    assert.strictEqual(alturaConTecla("media", "Home"), "resumen");
    assert.strictEqual(alturaConTecla("resumen", "End"), "completa");
    assert.isUndefined(alturaConTecla("media", "a"));
  });
});
