import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { Corredera, Interruptor } from "./Eleccion.tsx";

const montarInterruptor = (inicial: boolean) => {
  const [encendido, setEncendido] = createSignal(inicial);
  const cambios: Array<boolean> = [];
  const pantalla = render(() => (
    <Interruptor
      etiqueta="Modo estudiante"
      descripcion="Añade un ejercicio."
      encendido={encendido()}
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
});

type Tema = "sistema" | "claro" | "oscuro";

const montarCorredera = (inicial: Tema) => {
  const [valor, setValor] = createSignal<Tema>(inicial);
  const pantalla = render(() => (
    <Corredera
      leyenda="Tema"
      opciones={[
        { valor: "sistema", etiqueta: "Sistema" },
        { valor: "claro", etiqueta: "Claro" },
        { valor: "oscuro", etiqueta: "Oscuro" },
      ]}
      valor={valor()}
      alCambiar={setValor}
    />
  ));
  flush();
  return { ...pantalla, valor };
};

describe("Corredera", () => {
  it("son botones de radio agrupados por su pregunta, con la opción elegida marcada", () => {
    const { getByRole } = montarCorredera("sistema");
    const grupo = getByRole("group", { name: "Tema" });
    const opciones = Array.from(grupo.querySelectorAll<HTMLInputElement>("input"));
    assert.deepStrictEqual(
      opciones.map((opcion) => [opcion.type, opcion.value, opcion.checked]),
      [
        ["radio", "sistema", true],
        ["radio", "claro", false],
        ["radio", "oscuro", false],
      ],
    );
    assert.strictEqual(new Set(opciones.map((opcion) => opcion.name)).size, 1);
  });

  it("al elegir otra opción, la corredera se desliza hasta ella", () => {
    const { getByRole, container, valor } = montarCorredera("sistema");
    const corredera = container.querySelector<HTMLElement>("[data-parte='corredera']");
    assert.strictEqual(corredera?.style.transform, "translateX(0%)");

    fireEvent.click(getByRole("radio", { name: "Oscuro" }));
    flush();
    assert.strictEqual(valor(), "oscuro");
    const oscuro = getByRole("radio", { name: "Oscuro" });
    assert.isTrue(oscuro instanceof HTMLInputElement && oscuro.checked);
    assert.strictEqual(corredera?.style.transform, "translateX(200%)");
    assert.include(corredera?.getAttribute("class") ?? "", "motion-reduce:transition-none");
  });

  it("cada opción ocupa los 44 px de alto de la pastilla", () => {
    const { getByRole } = montarCorredera("claro");
    const etiqueta = getByRole("radio", { name: "Claro" }).closest("label");
    assert.isTrue(etiqueta?.classList.contains("h-11"));
  });
});
