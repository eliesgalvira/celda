import { GLOSARIO, marcado, termino } from "@celda/dominio/glosario";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { Termino, TextoConTerminos } from "./Termino.tsx";

/** La explicación se monta en `<body>`, fuera del contenedor de `render`: se busca con `screen`. */
const montar = () => {
  const pantalla = render(() => (
    <div>
      <p>
        Por sus <Termino termino="banda">bandas</Termino>, probablemente da 5G.
      </p>
      <button type="button">Otro control</button>
    </div>
  ));
  flush();
  return pantalla;
};

// `screen` ve todo el documento: cada prueba empieza con él vacío.
afterEach(cleanup);

const abrir = (boton: HTMLElement) => {
  fireEvent.click(boton);
  flush();
};

describe("Termino", () => {
  it("es un botón con el texto de la frase, cerrado al empezar", () => {
    montar();
    const boton = screen.getByRole("button", { name: "bandas" });
    // Un <button> de verdad: Intro y Espacio lo pulsan sin código propio.
    assert.strictEqual(boton.tagName, "BUTTON");
    assert.strictEqual(boton.getAttribute("type"), "button");
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    assert.strictEqual(boton.getAttribute("aria-haspopup"), "dialog");
    assert.isNull(screen.queryByRole("dialog"));
  });

  it("al pulsarlo abre la explicación llana, con el término técnico al final", () => {
    montar();
    const boton = screen.getByRole("button", { name: "bandas" });
    abrir(boton);

    const explicacion = screen.getByRole("dialog", { name: "Banda" });
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    assert.strictEqual(boton.getAttribute("aria-controls"), explicacion.id);
    assert.include(explicacion.textContent, GLOSARIO.banda.explicacion);
    // El término técnico va después de la explicación.
    const texto = explicacion.textContent ?? "";
    assert.isAbove(
      texto.indexOf(`Término técnico: ${GLOSARIO.banda.tecnico}`),
      texto.indexOf(GLOSARIO.banda.explicacion),
    );
    // Se lleva el foco a su título, para que el teclado y el lector de pantalla lleguen a ella.
    assert.strictEqual(document.activeElement, screen.getByRole("heading", { name: "Banda" }));
  });

  it("Escape la cierra y devuelve el foco al término", () => {
    montar();
    const boton = screen.getByRole("button", { name: "bandas" });
    boton.focus();
    abrir(boton);
    const explicacion = screen.getByRole("dialog");

    fireEvent.keyDown(explicacion, { key: "Escape" });
    flush();
    assert.isNull(screen.queryByRole("dialog"));
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    assert.strictEqual(document.activeElement, boton);
  });

  it("el Escape que la cierra no llega a lo que la rodea, como el panel", () => {
    let escapes = 0;
    render(() => (
      <div
        ref={(elemento) =>
          elemento.addEventListener("keydown", (evento) => {
            if (evento.key === "Escape") escapes += 1;
          })
        }
      >
        <Termino termino="sector">sectores</Termino>
      </div>
    ));
    flush();
    const boton = screen.getByRole("button", { name: "sectores" });
    abrir(boton);
    fireEvent.keyDown(boton, { key: "Escape" });
    flush();
    assert.isNull(screen.queryByRole("dialog"));
    assert.strictEqual(escapes, 0);
  });

  it("tocar fuera la cierra; tocar dentro no", () => {
    montar();
    abrir(screen.getByRole("button", { name: "bandas" }));

    fireEvent.pointerDown(screen.getByRole("dialog").querySelector("p") ?? document.body);
    flush();
    assert.isNotNull(screen.queryByRole("dialog"));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Otro control" }));
    flush();
    assert.isNull(screen.queryByRole("dialog"));
  });

  it("volver a pulsar el término la cierra", () => {
    montar();
    const boton = screen.getByRole("button", { name: "bandas" });
    abrir(boton);
    fireEvent.pointerDown(boton);
    abrir(boton);
    assert.isNull(screen.queryByRole("dialog"));
  });

  it("«Cerrar» es un botón con etiqueta visible que la cierra", () => {
    montar();
    const boton = screen.getByRole("button", { name: "bandas" });
    abrir(boton);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    flush();
    assert.isNull(screen.queryByRole("dialog"));
    assert.strictEqual(document.activeElement, boton);
  });

  it("Tab no se escapa por el final: vuelve al término y la cierra", () => {
    montar();
    const boton = screen.getByRole("button", { name: "bandas" });
    abrir(boton);
    const controles = Array.from(screen.getByRole("dialog").querySelectorAll("button"));
    const ultimo = controles.at(-1);
    assert.isDefined(ultimo);
    ultimo?.focus();
    fireEvent.keyDown(ultimo ?? document.body, { key: "Tab" });
    flush();
    assert.isNull(screen.queryByRole("dialog"));
    assert.strictEqual(document.activeElement, boton);

    abrir(boton);
    fireEvent.keyDown(screen.getByRole("heading", { name: "Banda" }), {
      key: "Tab",
      shiftKey: true,
    });
    flush();
    assert.isNull(screen.queryByRole("dialog"));
    assert.strictEqual(document.activeElement, boton);
  });

  it("un término relacionado se abre en la misma explicación", () => {
    montar();
    abrir(screen.getByRole("button", { name: "bandas" }));
    fireEvent.click(screen.getByRole("button", { name: "MHz" }));
    flush();
    const explicacion = screen.getByRole("dialog", { name: "MHz" });
    assert.include(explicacion.textContent, GLOSARIO.mhz.explicacion);
    assert.strictEqual(document.activeElement, screen.getByRole("heading", { name: "MHz" }));
  });
});

describe("TextoConTerminos", () => {
  it("subraya solo la primera aparición de cada término", () => {
    const { container } = render(() => (
      <p>
        <TextoConTerminos
          texto={marcado`Las ${termino("banda", "bandas")} bajas y las ${termino("banda", "bandas")} altas dan ${termino("5g", "5G")}.`}
        />
      </p>
    ));
    flush();
    const parrafo = container.querySelector("p");
    assert.strictEqual(parrafo?.textContent, "Las bandas bajas y las bandas altas dan 5G.");
    assert.deepStrictEqual(
      Array.from(container.querySelectorAll("[data-termino]"), (e) =>
        e.getAttribute("data-termino"),
      ),
      ["banda", "5g"],
    );
  });
});
