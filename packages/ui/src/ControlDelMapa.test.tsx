import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { ControlDelMapa } from "./ControlDelMapa.tsx";

describe("ControlDelMapa", () => {
  it("se nombra por su etiqueta visible y refleja si está activo", () => {
    const [activo, setActivo] = createSignal(false);
    const { getByRole } = render(() => (
      <ControlDelMapa etiqueta="Interferencia" icono="≈" activo={activo()} />
    ));

    const boton = getByRole("button", { name: "Interferencia" });
    assert.strictEqual(boton.getAttribute("aria-pressed"), "false");

    setActivo(true);
    flush();
    assert.strictEqual(boton.getAttribute("aria-pressed"), "true");
  });

  it("sin estado de encendido no anuncia aria-pressed", () => {
    const { getByRole } = render(() => <ControlDelMapa etiqueta="Acercar" icono="+" />);
    assert.isNull(getByRole("button", { name: "Acercar" }).getAttribute("aria-pressed"));
  });
});
