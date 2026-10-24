import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { GraficaDeTramos } from "./Referencias.tsx";

const montar = () => {
  const pantalla = render(() => (
    <GraficaDeTramos
      nombre="Lo que se pierde en interiores"
      maximo={35}
      marcas={[
        { valor: 10, lineas: ["10 dB", "1/10"] },
        { valor: 30, lineas: ["30 dB", "1/1000"] },
      ]}
      filas={[
        {
          etiqueta: "Junto a una ventana",
          desde: 8,
          hasta: 16,
          cifra: "8–16 dB",
          explicacion: "Junto a una ventana: de 8 a 16 dB.",
        },
        {
          etiqueta: "Cristales metalizados",
          desde: 18,
          hasta: 32,
          cifra: "18–32 dB",
          explicacion: "Con vidrio metalizado: de 18 a 32 dB.",
        },
        {
          etiqueta: "Dentro de un coche",
          desde: 9,
          hasta: 9,
          cifra: "9 dB",
          explicacion: "Dentro de un coche: 9 dB.",
        },
      ]}
    />
  ));
  flush();
  return pantalla;
};

const cifra = (svg: Element, texto: string) =>
  Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === texto);

describe("GraficaDeTramos", () => {
  it("es una imagen con nombre, y cada fila explica su cifra al pasar por encima", () => {
    const { getByRole } = montar();
    const svg = getByRole("img", { name: "Lo que se pierde en interiores" });
    assert.deepStrictEqual(
      Array.from(svg.querySelectorAll("g > title"), (t) => t.textContent),
      [
        "Junto a una ventana: de 8 a 16 dB.",
        "Con vidrio metalizado: de 18 a 32 dB.",
        "Dentro de un coche: 9 dB.",
      ],
    );
    assert.isDefined(cifra(svg, "1/1000"));
  });

  it("pone la cifra tras el tramo y, si no cabe, delante; un valor solo es un punto", () => {
    const { getByRole } = montar();
    const svg = getByRole("img", { name: "Lo que se pierde en interiores" });
    assert.strictEqual(cifra(svg, "8–16 dB")?.getAttribute("text-anchor"), "start");
    assert.strictEqual(cifra(svg, "18–32 dB")?.getAttribute("text-anchor"), "end");
    assert.lengthOf(svg.querySelectorAll("circle"), 1);
  });
});
