import { simuladorDePrueba } from "@celda/sim/pruebas";
import { CLAVE_DEL_TEMA } from "@celda/ui/temaElegido.ts";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { capaDePrueba } from "../capa/pruebas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";

/** La web con los ajustes abiertos. Lee y guarda el tema en el `localStorage` de happy-dom. */
const montar = () => {
  navegar("/?ajustes", { reemplazar: true });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.never]),
        fichasDePrueba().capa,
        simuladorDePrueba,
        ubicacionDePrueba().capa,
      )}
    />
  ));
  flush();
  return pantalla;
};

const radio = (elemento: HTMLElement): HTMLInputElement => {
  assert.instanceOf(elemento, HTMLInputElement);
  // SAFETY: comprobado justo encima.
  return elemento as HTMLInputElement;
};

/** Cada prueba empieza como una visita nueva, sin tema guardado ni puesto. */
const olvidarTema = () => {
  localStorage.removeItem(CLAVE_DEL_TEMA);
  document.documentElement.removeAttribute("data-tema");
};
beforeEach(olvidarTema);
afterEach(olvidarTema);

describe("tema en los ajustes", () => {
  it("por defecto sigue al sistema", async () => {
    const { findByRole } = montar();
    await findByRole("group", { name: "Tema" });
    assert.isTrue(radio(await findByRole("radio", { name: "Sistema" })).checked);
    assert.isNull(document.documentElement.getAttribute("data-tema"));
  });

  it("elegir Oscuro lo pone en el momento y lo guarda en el dispositivo", async () => {
    const { findByRole, queryByText } = montar();
    fireEvent.click(await findByRole("radio", { name: "Oscuro" }));
    flush();
    assert.strictEqual(document.documentElement.getAttribute("data-tema"), "oscuro");
    assert.strictEqual(localStorage.getItem(CLAVE_DEL_TEMA), "oscuro");
    assert.isTrue(radio(await findByRole("radio", { name: "Oscuro" })).checked);
    assert.isNull(queryByText("No se ha podido guardar"));

    // Volver a Sistema borra lo guardado.
    fireEvent.click(await findByRole("radio", { name: "Sistema" }));
    flush();
    assert.isNull(document.documentElement.getAttribute("data-tema"));
    assert.isNull(localStorage.getItem(CLAVE_DEL_TEMA));
  });

  it("al volver, enseña el tema guardado", async () => {
    localStorage.setItem(CLAVE_DEL_TEMA, "claro");
    const { findByRole } = montar();
    assert.isTrue(radio(await findByRole("radio", { name: "Claro" })).checked);
  });

  it("el modo estudiante sigue en un interruptor que se llama como su etiqueta", async () => {
    const { findByRole } = montar();
    const interruptor = await findByRole("switch", { name: "Modo estudiante" });
    assert.strictEqual(interruptor.getAttribute("aria-checked"), "false");
  });
});
