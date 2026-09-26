import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush, Show } from "solid-js";

import { Dialogo } from "./Dialogo.tsx";

/** Un botón que abre el diálogo y lo cierra cuando el diálogo lo pide, como hace la web. */
const montar = () => {
  const [abierto, setAbierto] = createSignal(false);
  let cierres = 0;
  const pantalla = render(() => (
    <>
      <button type="button" onClick={() => setAbierto(true)}>
        Abrir
      </button>
      <Show when={abierto()}>
        <Dialogo
          titulo="Medir tu señal"
          antetitulo="TU SEÑAL"
          alCerrar={() => {
            cierres += 1;
            setAbierto(false);
          }}
        >
          <p>Texto</p>
          <button type="button">Primera opción</button>
          <button type="button">Última opción</button>
        </Dialogo>
      </Show>
    </>
  ));
  const abridor = pantalla.getByRole("button", { name: "Abrir" });
  abridor.focus();
  fireEvent.click(abridor);
  flush();
  return { ...pantalla, abridor, cierres: () => cierres };
};

describe("Dialogo", () => {
  it("se nombra por su título visible y al abrirse lleva el foco al título", () => {
    const { getByRole } = montar();
    const dialogo = getByRole("dialog", { name: "Medir tu señal" });
    assert.isTrue(dialogo.hasAttribute("open"));
    assert.strictEqual(document.activeElement, getByRole("heading", { name: "Medir tu señal" }));
  });

  it("el tabulador da la vuelta dentro del diálogo en los dos sentidos", () => {
    const { getByRole } = montar();
    const cerrar = getByRole("button", { name: "Cerrar" });
    const ultima = getByRole("button", { name: "Última opción" });

    ultima.focus();
    fireEvent.keyDown(ultima, { key: "Tab" });
    assert.strictEqual(document.activeElement, cerrar);

    fireEvent.keyDown(cerrar, { key: "Tab", shiftKey: true });
    assert.strictEqual(document.activeElement, ultima);
  });

  it("Escape lo cierra y el foco vuelve a lo que lo abrió", () => {
    const { getByRole, queryByRole, abridor, cierres } = montar();
    fireEvent.keyDown(getByRole("button", { name: "Primera opción" }), { key: "Escape" });
    flush();
    assert.strictEqual(cierres(), 1);
    assert.isNull(queryByRole("dialog"));
    assert.strictEqual(document.activeElement, abridor);
  });

  it("el botón con la etiqueta «Cerrar» lo cierra", () => {
    const { getByRole, cierres } = montar();
    fireEvent.click(getByRole("button", { name: "Cerrar" }));
    flush();
    assert.strictEqual(cierres(), 1);
  });
});
