import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { Desplegable } from "./Desplegable.tsx";

const montar = () => {
  const pantalla = render(() => (
    <Desplegable titulo="Datos técnicos">
      <p>Expediente B B -2300445</p>
    </Desplegable>
  ));
  flush();
  return pantalla;
};

describe("Desplegable", () => {
  it("empieza cerrado, con su contenido oculto", () => {
    const { getByRole, getByText } = montar();
    const boton = getByRole("button", { name: "Datos técnicos" });
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    const contenido = getByText("Expediente B B -2300445").parentElement;
    assert.strictEqual(boton.getAttribute("aria-controls"), contenido?.id);
    assert.isTrue(contenido?.hidden);
  });

  it("se abre y se cierra con el botón, que es un control de teclado", () => {
    const { getByRole, getByText } = montar();
    const boton = getByRole("button", { name: "Datos técnicos" });
    // Un <button> de verdad: Intro y Espacio lo pulsan sin código propio.
    assert.strictEqual(boton.tagName, "BUTTON");
    assert.strictEqual(boton.getAttribute("type"), "button");

    fireEvent.click(boton);
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    assert.isFalse(getByText("Expediente B B -2300445").parentElement?.hidden);

    fireEvent.click(boton);
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    assert.isTrue(getByText("Expediente B B -2300445").parentElement?.hidden);
  });

  it("con «abierto» empieza abierto y se puede cerrar", () => {
    const { getByRole, getByText } = render(() => (
      <Desplegable titulo="¿Qué le pasa a mi móvil?" abierto variante="recuadro">
        <p>No se instala nada</p>
      </Desplegable>
    ));
    flush();
    const boton = getByRole("button", { name: "¿Qué le pasa a mi móvil?" });
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    assert.isFalse(getByText("No se instala nada").parentElement?.hidden);

    fireEvent.click(boton);
    flush();
    assert.isTrue(getByText("No se instala nada").parentElement?.hidden);
  });
});
