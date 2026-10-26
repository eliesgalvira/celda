import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import type { Movimiento } from "./Deslizable.tsx";
import { MarcadorAgrupacion } from "./MarcadorAgrupacion.tsx";
import type { TamanoDeMarcador } from "./tamano.ts";

describe("MarcadorAgrupacion", () => {
  it("es un botón con el número a la vista y un nombre que dice qué hace", () => {
    let pulsado = 0;
    const { getByRole } = render(() => (
      <MarcadorAgrupacion
        x={120}
        y={80}
        cuantos={12}
        nombre="12 emplazamientos, acercar"
        onClick={() => {
          pulsado += 1;
        }}
      />
    ));

    const boton = getByRole("button", { name: "12 emplazamientos, acercar" });
    assert.strictEqual(boton.textContent, "12");
    assert.isFalse(boton.hasAttribute("inert"));

    boton.focus();
    assert.strictEqual(document.activeElement, boton);
    fireEvent.click(boton);
    assert.strictEqual(pulsado, 1);
  });

  it("de lejos encoge y se aclara, pero el botón y el número siguen igual", () => {
    const boton = (tamano: TamanoDeMarcador) =>
      render(() => (
        <MarcadorAgrupacion x={0} y={0} cuantos={40} nombre="40 emplazamientos" tamano={tamano} />
      )).getByRole("button");
    const medio = boton("medio");
    const normal = boton("normal");
    const dibujo = (boton: HTMLElement) => boton.querySelector("svg");
    const escala = (boton: HTMLElement) => dibujo(boton)?.parentElement?.parentElement?.className;
    assert.strictEqual(medio.getAttribute("data-tamano"), "medio");
    assert.notStrictEqual(escala(medio), escala(normal));
    assert.notStrictEqual(
      dibujo(medio)?.getAttribute("class"),
      dibujo(normal)?.getAttribute("class"),
    );
    assert.strictEqual(medio.className, normal.className);
    assert.strictEqual(medio.textContent, "40");
  });

  it("mientras sale hacia otra agrupación no se puede pulsar ni enfocar", () => {
    const [movimiento, setMovimiento] = createSignal<Movimiento>({
      tipo: "entra",
      desde: { x: -30, y: 12 },
    });
    const { getByRole } = render(() => (
      <MarcadorAgrupacion
        x={0}
        y={0}
        cuantos={3}
        nombre="3 emplazamientos, acercar"
        movimiento={movimiento()}
      />
    ));
    const boton = getByRole("button", { name: "3 emplazamientos, acercar" });
    assert.isFalse(boton.hasAttribute("inert"));

    setMovimiento({ tipo: "sale", hacia: { x: 40, y: -8 } });
    flush();
    assert.isTrue(boton.hasAttribute("inert"));
  });
});
