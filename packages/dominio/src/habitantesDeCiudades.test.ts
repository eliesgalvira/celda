import { assert, describe, it } from "@effect/vitest";

import { centroVisual, habitantesDeProvincia } from "./centroVisual.ts";
import { CIUDADES, habitantesDeRotulo, indiceDeCiudades } from "./habitantesDeCiudades.ts";

describe("habitantes de un rótulo de ciudad", () => {
  it("salen del municipio con su nombre de lugar más cercano", () => {
    // El rótulo de OpenStreetMap no cae en la etiqueta del IGN, pero sí cerca.
    assert.isAbove(
      habitantesDeRotulo("València", { longitud: -0.376, latitud: 39.47 }, CIUDADES),
      750_000,
    );
    assert.isAbove(
      habitantesDeRotulo("Alacant", { longitud: -0.481, latitud: 38.345 }, CIUDADES),
      300_000,
    );
  });

  it("cuentan 0 si no casa con ningún municipio: otra forma, lejos o de fuera de España", () => {
    assert.strictEqual(
      habitantesDeRotulo("Valencia", { longitud: -0.376, latitud: 39.47 }, CIUDADES),
      0,
    );
    assert.strictEqual(
      habitantesDeRotulo("València", { longitud: -3.7, latitud: 40.4 }, CIUDADES),
      0,
    );
    assert.strictEqual(
      habitantesDeRotulo("Perpignan", { longitud: 2.89, latitud: 42.7 }, CIUDADES),
      0,
    );
  });

  it("el primer índice que tiene el nombre manda, como las capas de provincia sobre la tabla", () => {
    const deCapa = indiceDeCiudades([
      { nombre: "Utebo", etiqueta: { longitud: -1, latitud: 41.71 }, habitantes: 19_000 },
    ]);
    const tabla = indiceDeCiudades([
      { nombre: "Utebo", etiqueta: { longitud: -1, latitud: 41.71 }, habitantes: 5 },
      { nombre: "Zaragoza", etiqueta: { longitud: -0.88, latitud: 41.65 }, habitantes: 680_000 },
    ]);
    const posicion = { longitud: -0.99, latitud: 41.7 };
    assert.strictEqual(habitantesDeRotulo("Utebo", posicion, deCapa, tabla), 19_000);
    assert.strictEqual(habitantesDeRotulo("Zaragoza", posicion, deCapa, tabla), 680_000);
  });
});

describe("centro visual de una provincia", () => {
  it("Illes Balears va en Mallorca y Las Palmas en Gran Canaria, no en su etiqueta del IGN", () => {
    const baleares = centroVisual("07");
    assert.closeTo(baleares?.longitud ?? 0, 3.017, 0.003);
    assert.closeTo(baleares?.latitud ?? 0, 39.578, 0.003);
    const palmas = centroVisual("35");
    assert.closeTo(palmas?.longitud ?? 0, -15.583, 0.003);
    assert.closeTo(palmas?.latitud ?? 0, 27.946, 0.003);
  });

  it("una provincia que no está en la tabla no tiene centro ni habitantes", () => {
    assert.isUndefined(centroVisual("99"));
    assert.strictEqual(habitantesDeProvincia("99"), 0);
    assert.isAbove(habitantesDeProvincia("28"), 6_000_000);
  });
});
