import type { Compania } from "@celda/dominio/compania";
import { assert, describe, it } from "@effect/vitest";

import type { ElementoBarrio } from "./agrupacion.ts";
import { formasDeBarrios } from "./etiquetas.ts";
import { nombreDeBarrio } from "./marcadores.ts";

/** Un barrio cuya etiqueta cae en el píxel (x, 100) de una proyección de prueba. */
const barrio = (
  codigo: string,
  x: number,
  emplazamientos: number,
  ausentes: ReadonlyArray<Compania> = [],
): ElementoBarrio => ({
  tipo: "barrio",
  clave: `b:${codigo}`,
  posicion: { longitud: x, latitud: 0 },
  resumen: {
    barrio: { codigo, nombre: `Barrio ${codigo}`, etiqueta: { longitud: x, latitud: 0 } },
    emplazamientos,
    ausentes,
  },
});

const proyectar = (b: ElementoBarrio) => ({ x: b.posicion.longitud, y: 100 });

describe("forma de las etiquetas de barrio", () => {
  it("las que caben sin pisarse van completas", () => {
    const formas = formasDeBarrios([barrio("01", 0, 5), barrio("02", 400, 3)], proyectar);
    assert.deepStrictEqual(
      [...formas],
      [
        ["b:01", "completa"],
        ["b:02", "completa"],
      ],
    );
  });

  it("si dos se pisan, la del barrio con más emplazamientos va completa y la otra, compacta", () => {
    const formas = formasDeBarrios(
      [barrio("01", 0, 5), barrio("02", 60, 30, ["digi"]), barrio("03", 120, 1)],
      proyectar,
    );
    assert.strictEqual(formas.get("b:02"), "completa");
    assert.strictEqual(formas.get("b:01"), "compacta");
    assert.strictEqual(formas.get("b:03"), "compacta");
  });

  it("ningún barrio se queda sin dibujar, aunque su forma compacta pise otra", () => {
    const encima = [barrio("01", 0, 5), barrio("02", 1, 5), barrio("03", 2, 5)];
    const formas = formasDeBarrios(encima, proyectar);
    assert.strictEqual(formas.size, 3);
    // A igualdad de emplazamientos, manda el código: la forma no baila de una vez a otra.
    assert.strictEqual(formas.get("b:01"), "completa");
    assert.deepStrictEqual(formasDeBarrios(encima.toReversed(), proyectar), formas);
  });
});

describe("nombre accesible de un barrio", () => {
  it("dice lo que se ve en la etiqueta y qué hace al pulsarla", () => {
    assert.strictEqual(
      nombreDeBarrio(barrio("07", 0, 94, ["digi"]).resumen),
      "Barrio 07, 94 emplazamientos, sin Digi, acercar",
    );
    assert.strictEqual(
      nombreDeBarrio(barrio("18", 0, 19).resumen),
      "Barrio 18, 19 emplazamientos, acercar",
    );
    assert.strictEqual(
      nombreDeBarrio(barrio("56", 0, 0, ["movistar", "vodafone"]).resumen),
      "Barrio 56, ningún emplazamiento, sin Movistar ni Vodafone, acercar",
    );
  });
});
