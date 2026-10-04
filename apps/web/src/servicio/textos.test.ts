import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import { orientacionDe } from "../ficha/diagrama.ts";
import type { LecturaServicio } from "./servicio.ts";
import { textoGanancia, textosServicio } from "./textos.ts";

const SUPUESTA = orientacionDe([]);

/** Un punto a 340 m que el sector `sector` ve `desviacion` grados fuera de su eje. */
const lectura = (
  sector: number | undefined,
  desviacion: number,
  extra: Partial<LecturaServicio> = {},
): LecturaServicio => ({
  sector,
  gananciaDb: -Math.min(12 * (desviacion / 65) ** 2, 30),
  desviacion,
  distancia: 340,
  // Del emplazamiento al punto, hacia el suroeste: el emplazamiento queda al noreste.
  rumbo: 222,
  enCelda: true,
  ...extra,
});

const veredicto = (l: LecturaServicio, tipo: "gps" | "elegido" = "gps") =>
  textoPlano(textosServicio(l, tipo, SUPUESTA).veredicto);

describe("textos del sector que da servicio", () => {
  it("de frente al eje: casi de frente, con el rumbo del sector", () => {
    assert.strictEqual(
      veredicto(lectura(2, -18)),
      "Estás casi de frente al sector 3 (240°), donde su haz manda más señal.",
    );
  });

  it("algo fuera del eje dice los grados y los dB que se pierden", () => {
    assert.strictEqual(
      veredicto(lectura(0, 30)),
      "Estás a 30° del eje del sector 1 (0°) y pierdes 2,6 dB, poca cosa.",
    );
  });

  it("entre dos sectores lo dice y redondea la pérdida", () => {
    assert.strictEqual(
      veredicto(lectura(1, -55)),
      "Estás entre dos sectores, a 55° del eje del sector 2 (120°), y pierdes unos 9 dB. Es donde un sector le pasa el relevo al otro.",
    );
  });

  it("al pie del emplazamiento no elige sector", () => {
    const textos = textosServicio(lectura(undefined, 0, { distancia: 8 }), "gps", SUPUESTA);
    assert.strictEqual(
      textoPlano(textos.veredicto),
      "Estás al pie del emplazamiento. Desde tan cerca no se puede decir qué sector te da servicio.",
    );
    assert.deepStrictEqual(textos.datos[0], { valor: "Ninguno", etiqueta: "al pie" });
    assert.strictEqual(textos.enMapa, "10 m · al pie");
  });

  it("fuera de la celda avisa de que hay otro emplazamiento más cerca", () => {
    assert.match(
      veredicto(lectura(2, -18, { enCelda: false })),
      /Además, estás fuera de la celda de este emplazamiento: hay otro más cerca, que puede ser el que te da servicio\.$/u,
    );
    assert.notMatch(veredicto(lectura(2, -18, { enCelda: undefined })), /fuera/u);
  });

  it("con un punto elegido habla del punto, nunca de ti", () => {
    for (const l of [
      lectura(2, -18),
      lectura(0, 30),
      lectura(1, -55, { enCelda: false }),
      lectura(undefined, 0),
    ]) {
      const textos = textosServicio(l, "elegido", SUPUESTA);
      const todo = [
        textoPlano(textos.veredicto),
        textoPlano(textos.nota),
        ...textos.datos.flatMap((d) => [d.valor, d.etiqueta]),
      ].join(" ");
      assert.notMatch(todo, /\b(ti|te|tu|tú|estás|pierdes)\b/iu, todo);
      assert.match(textoPlano(textos.veredicto), /^El punto está/u);
    }
    assert.strictEqual(
      veredicto(lectura(0, 30), "elegido"),
      "El punto está a 30° del eje del sector 1 (0°) y se pierden 2,6 dB, poca cosa.",
    );
  });

  it("las casillas dicen el sector, la pérdida y la distancia con el rumbo hasta el emplazamiento", () => {
    const textos = textosServicio(lectura(2, -18), "gps", SUPUESTA);
    assert.deepStrictEqual(textos.datos, [
      { valor: "Sector 3", etiqueta: "te da servicio" },
      { valor: "−0,9 dB", etiqueta: "respecto al eje" },
      { valor: "340 m", etiqueta: "hacia el noreste" },
    ]);
    assert.strictEqual(textos.enMapa, "340 m · sector 3");
    assert.strictEqual(textoGanancia(-0.01), "0 dB");
  });

  it("no da el identificador del modelo y dice que la orientación es supuesta", () => {
    const textos = textosServicio(lectura(2, -18), "gps", SUPUESTA);
    assert.notProperty(textos, "modelo");
    assert.match(
      textoPlano(textos.nota),
      /^Orientación supuesta a 0°, 120° y 240°: ninguna fuente/u,
    );
    assert.match(textoPlano(textos.nota), /puede ser otro\.$/u);
  });

  it("con una orientación estimada lleva el margen de ±15°", () => {
    const estimada = orientacionDe([30, 150, 270]);
    const textos = textosServicio(lectura(0, 10), "gps", estimada);
    assert.match(textoPlano(textos.veredicto), /sector 1 \(30° ±15°\)/u);
    assert.match(
      textoPlano(textos.nota),
      /^Orientación estimada, con ±15° de margen en cada eje\./u,
    );
  });

  it("subraya cada término una vez entre el veredicto y la nota", () => {
    const textos = textosServicio(lectura(1, -55, { enCelda: false }), "gps", SUPUESTA);
    const terminos = terminosDe([textos.veredicto, textos.nota]);
    assert.deepStrictEqual(terminos, [...new Set(terminos)]);
    assert.includeMembers(
      [...terminos],
      ["sector-que-da-servicio", "decibelio", "celda", "azimut"],
    );
  });
});
