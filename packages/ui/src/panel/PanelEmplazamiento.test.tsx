import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush, Show } from "solid-js";

import type { AlturaHoja } from "./hoja.ts";
import { PanelEmplazamiento } from "./PanelEmplazamiento.tsx";

/** Un panel controlado, como lo usa la web, que apunta cada altura pedida y cada cierre. */
const montar = () => {
  const alturas: Array<AlturaHoja> = [];
  let cierres = 0;
  const [altura, setAltura] = createSignal<AlturaHoja>("resumen");
  const pantalla = render(() => (
    <PanelEmplazamiento
      nombre="Ficha del emplazamiento"
      altura={altura()}
      alCambiarAltura={(nueva) => {
        alturas.push(nueva);
        setAltura(nueva);
      }}
      alCerrar={() => {
        cierres += 1;
      }}
    >
      <p>Contenido</p>
    </PanelEmplazamiento>
  ));
  flush();
  return { ...pantalla, alturas, cierres: () => cierres };
};

describe("PanelEmplazamiento", () => {
  it("el tirador tiene etiqueta visible y cada toque sube una altura", () => {
    const { getByRole, alturas } = montar();
    const tirador = getByRole("button", { name: "Ver más" });
    fireEvent.click(tirador);
    flush();
    fireEvent.click(tirador);
    flush();
    assert.deepStrictEqual(alturas, ["media", "completa"]);
    assert.isNotNull(getByRole("button", { name: "Ver menos" }));
  });

  it("con el teclado, las flechas del tirador cambian la altura", () => {
    const { getByRole, alturas } = montar();
    const tirador = getByRole("button", { name: "Ver más" });
    fireEvent.keyDown(tirador, { key: "ArrowUp" });
    flush();
    fireEvent.keyDown(tirador, { key: "End" });
    flush();
    fireEvent.keyDown(tirador, { key: "ArrowDown" });
    flush();
    assert.deepStrictEqual(alturas, ["media", "completa", "media"]);
  });

  it("arrastrar el tirador lleva la hoja a una altura, y soltarlo no cuenta como toque", () => {
    const { getByRole, getByLabelText, alturas } = montar();
    const tirador = getByRole("button", { name: "Ver más" });
    const panel = getByLabelText("Ficha del emplazamiento");

    fireEvent.pointerDown(tirador, { pointerId: 1, button: 0, clientY: 700 });
    fireEvent.pointerMove(tirador, { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(tirador, { pointerId: 1, clientY: 400 });
    flush();
    // Mientras arrastra, la hoja sigue al dedo sin transición.
    assert.isTrue(panel.hasAttribute("data-arrastrando"));
    assert.strictEqual(panel.style.getPropertyValue("--alto-hoja"), "300px");

    fireEvent.pointerUp(tirador, { pointerId: 1, clientY: 400 });
    fireEvent.click(tirador);
    flush();
    assert.lengthOf(alturas, 1);
    assert.isFalse(panel.hasAttribute("data-arrastrando"));

    // Un toque después del arrastre sí cuenta.
    fireEvent.pointerDown(tirador, { pointerId: 2, button: 0, clientY: 500 });
    fireEvent.pointerUp(tirador, { pointerId: 2, clientY: 501 });
    fireEvent.click(tirador);
    flush();
    assert.lengthOf(alturas, 2);
  });

  it("se cierra con su botón o con Escape", () => {
    const { getByRole, getByLabelText, cierres } = montar();
    fireEvent.click(getByRole("button", { name: "Cerrar" }));
    fireEvent.keyDown(getByLabelText("Ficha del emplazamiento"), { key: "Escape" });
    assert.strictEqual(cierres(), 2);
  });

  it("al abrirse se lleva el foco y al cerrarse lo devuelve a donde estaba", () => {
    const [abierto, setAbierto] = createSignal(false);
    const { getByRole, getByLabelText } = render(() => (
      <>
        <button type="button">Marcador</button>
        <Show when={abierto()}>
          <PanelEmplazamiento
            nombre="Ficha del emplazamiento"
            altura="resumen"
            alCambiarAltura={() => undefined}
            alCerrar={() => setAbierto(false)}
          >
            <p>Contenido</p>
          </PanelEmplazamiento>
        </Show>
      </>
    ));
    const marcador = getByRole("button", { name: "Marcador" });
    marcador.focus();
    setAbierto(true);
    flush();
    assert.strictEqual(document.activeElement, getByLabelText("Ficha del emplazamiento"));

    fireEvent.click(getByRole("button", { name: "Cerrar" }));
    flush();
    assert.strictEqual(document.activeElement, marcador);
  });
});
