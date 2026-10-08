import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { Interruptor } from "./Eleccion.tsx";

const montarInterruptor = (inicial: boolean, disabled = false) => {
  const [encendido, setEncendido] = createSignal(inicial);
  const cambios: Array<boolean> = [];
  const pantalla = render(() => (
    <Interruptor
      etiqueta="Modo estudiante"
      descripcion="Añade un ejercicio."
      encendido={encendido()}
      disabled={disabled}
      alCambiar={(valor) => {
        cambios.push(valor);
        setEncendido(valor);
      }}
    />
  ));
  flush();
  return { ...pantalla, cambios };
};

describe("Interruptor", () => {
  it("es un interruptor con su etiqueta como nombre y la descripción leída con él", () => {
    const { getByRole, getByText } = montarInterruptor(false);
    const interruptor = getByRole("switch", { name: "Modo estudiante" });
    assert.strictEqual(interruptor.getAttribute("aria-checked"), "false");
    // Una casilla nativa: Espacio la cambia y el foco se ve en la fila (`has-focus-visible`).
    assert.strictEqual(interruptor.tagName, "INPUT");
    assert.strictEqual(interruptor.getAttribute("type"), "checkbox");
    assert.strictEqual(
      interruptor.getAttribute("aria-describedby"),
      getByText("Añade un ejercicio.").id,
    );
  });

  it("se enciende y se apaga pulsando cualquier parte de la fila", () => {
    const { getByRole, getByText, cambios } = montarInterruptor(false);
    const interruptor = getByRole("switch", { name: "Modo estudiante" });

    fireEvent.click(getByText("Modo estudiante"));
    flush();
    assert.deepStrictEqual(cambios, [true]);
    assert.strictEqual(interruptor.getAttribute("aria-checked"), "true");

    fireEvent.click(getByText("Añade un ejercicio."));
    flush();
    assert.deepStrictEqual(cambios, [true, false]);
    assert.strictEqual(interruptor.getAttribute("aria-checked"), "false");
  });

  it("la fila entera es el objetivo táctil, de 44 px como mínimo", () => {
    const { getByRole } = montarInterruptor(true);
    const fila = getByRole("switch", { name: "Modo estudiante" }).closest("label");
    assert.isNotNull(fila);
    assert.isTrue(fila?.classList.contains("min-h-11"));
  });

  it("el mando no se desliza con la preferencia de reducir el movimiento", () => {
    const { getByRole } = montarInterruptor(false);
    const pista = getByRole("switch", { name: "Modo estudiante" }).nextElementSibling;
    const mando = pista?.firstElementChild;
    assert.include(pista?.getAttribute("class") ?? "", "motion-reduce:transition-none");
    assert.include(mando?.getAttribute("class") ?? "", "motion-reduce:transition-none");
  });

  it("desactivado no cambia", () => {
    const { getByRole, cambios } = montarInterruptor(false, true);
    const interruptor = getByRole("switch", { name: "Modo estudiante" });
    assert.isTrue(interruptor.hasAttribute("disabled"));
    fireEvent.click(interruptor);
    flush();
    assert.deepStrictEqual(cambios, []);
  });
});
