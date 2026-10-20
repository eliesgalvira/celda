import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { ControlDelMapa } from "../ControlDelMapa.tsx";
import { AspectoDeControl } from "./aspecto.ts";
import { MenuDeControles } from "./MenuDeControles.tsx";

const esperarMicrotareas = () => new Promise<void>((resolver) => queueMicrotask(resolver));

describe("aspectos de los controles", () => {
  it("con la etiqueta a la vista o no, el nombre accesible es la etiqueta", () => {
    for (const aspecto of ["pastilla", "zoom", "fila"] as const) {
      const { getByRole, unmount } = render(() => (
        <AspectoDeControl value={aspecto}>
          <ControlDelMapa
            etiqueta="Vista agrupada"
            detalle="Junta los emplazamientos en hexágonos con su número."
            icono="≈"
          />
        </AspectoDeControl>
      ));
      flush();
      assert.isDefined(getByRole("button", { name: "Vista agrupada" }), aspecto);
      unmount();
    }
  });

  it("en una fila, la explicación es la descripción del botón", () => {
    const { getByRole } = render(() => (
      <AspectoDeControl value="fila">
        <ControlDelMapa etiqueta="Ajustes" detalle="Activa o apaga el modo estudiante." icono="≡" />
      </AspectoDeControl>
    ));
    flush();
    const boton = getByRole("button", { name: "Ajustes" });
    const descripcion = document.getElementById(boton.getAttribute("aria-describedby") ?? "");
    assert.strictEqual(descripcion?.textContent, "Activa o apaga el modo estudiante.");
  });
});

describe("MenuDeControles", () => {
  const montar = () => {
    const [usado, setUsado] = createSignal(0);
    const pantalla = render(() => (
      <AspectoDeControl value="pastilla">
        <MenuDeControles etiqueta="Más" titulo="Más funciones" icono="…">
          <ControlDelMapa etiqueta="Ajustes" icono="≡" onClick={() => setUsado(usado() + 1)} />
        </MenuDeControles>
      </AspectoDeControl>
    ));
    flush();
    return { ...pantalla, usado };
  };

  it("empieza cerrado y se abre con su botón, con los controles dentro como filas", () => {
    const { getByRole, queryByRole } = montar();
    const mas = getByRole("button", { name: "Más" });
    assert.strictEqual(mas.getAttribute("aria-expanded"), "false");
    assert.isNull(queryByRole("button", { name: "Ajustes" }));

    fireEvent.click(mas);
    flush();
    assert.strictEqual(mas.getAttribute("aria-expanded"), "true");
    const grupo = getByRole("group", { name: "Más funciones" });
    assert.strictEqual(mas.getAttribute("aria-controls"), grupo.id);
    assert.isDefined(getByRole("button", { name: "Ajustes" }));
  });

  it("se cierra al usar un control, después de que el control haga lo suyo", async () => {
    const { getByRole, queryByRole, usado } = montar();
    fireEvent.click(getByRole("button", { name: "Más" }));
    flush();
    fireEvent.click(getByRole("button", { name: "Ajustes" }));
    await esperarMicrotareas();
    flush();
    assert.strictEqual(usado(), 1);
    assert.isNull(queryByRole("button", { name: "Ajustes" }));
  });

  it("Escape lo cierra y devuelve el foco a su botón", () => {
    const { getByRole, queryByRole } = montar();
    const mas = getByRole("button", { name: "Más" });
    fireEvent.click(mas);
    flush();
    fireEvent.keyDown(getByRole("button", { name: "Ajustes" }), { key: "Escape" });
    flush();
    assert.isNull(queryByRole("button", { name: "Ajustes" }));
    assert.strictEqual(document.activeElement, mas);
  });
});
