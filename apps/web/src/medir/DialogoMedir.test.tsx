import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, within } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { DialogoMedir } from "./DialogoMedir.tsx";
import type { DatosDelNavegador } from "./dispositivo.ts";

const ORDENADOR: DatosDelNavegador = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  puntosTactiles: 0,
};

/** Chrome en Android: el `userAgent` no dice el modelo; llega aparte. */
const ANDROID = (modelo?: string): DatosDelNavegador => ({
  userAgent:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  puntosTactiles: 5,
  plataforma: "Android",
  modelo,
});

const montar = (navegador: DatosDelNavegador) => {
  let cierres = 0;
  const pantalla = render(() => (
    <DialogoMedir
      navegador={navegador}
      direccionMovil="https://celda.elies.site/?medir"
      alCerrar={() => {
        cierres += 1;
      }}
    />
  ));
  flush();
  const dialogo = pantalla.getByRole("dialog", { name: "Medir tu señal" });
  return { ...pantalla, dialogo, cierres: () => cierres };
};

describe("DialogoMedir en un ordenador", () => {
  it("dice que no se puede medir, por qué, y ofrece el móvil y el ejemplo", () => {
    const { dialogo, getByRole, getByText } = montar(ORDENADOR);

    const aviso = getByText("Desde un ordenador no se puede medir").parentElement;
    assert.match(aviso?.textContent ?? "", /la radio y la SIM de un móvil/u);

    // El QR se dibuja aquí mismo y se nombra por su pie visible.
    const qr = getByRole("figure", { name: "Abre este paso en el móvil" });
    assert.isAbove(qr.querySelectorAll("path").length, 20);

    assert.strictEqual(
      within(dialogo).getByRole("radio", { name: "Ordenador" }).matches(":checked"),
      true,
    );
  });

  it("la medida de ejemplo va marcada como ejemplo, con sus valores explicados", () => {
    const { getByRole, getByText } = montar(ORDENADOR);
    fireEvent.click(getByRole("button", { name: "Ver la medida de ejemplo" }));
    flush();

    const medida = getByRole("region", { name: /Medida de ejemplo en/u });
    assert.strictEqual(
      getByText("EJEMPLO").closest("[data-tono]")?.getAttribute("data-tono"),
      "ejemplo",
    );
    assert.match(medida.textContent ?? "", /−95 dBm/u);
    assert.match(medida.textContent ?? "", /Su nombre técnico es RSRP/u);
    assert.match(medida.textContent ?? "", /Son números inventados/u);

    fireEvent.click(getByRole("button", { name: "Volver" }));
    flush();
    assert.isNotNull(getByText("Desde un ordenador no se puede medir"));
  });

  it("si el ordenador era un iPhone, se cambia a mano y enseña su código", () => {
    const { getByRole, getByText, queryByText } = montar(ORDENADOR);
    fireEvent.click(getByRole("radio", { name: "iPhone" }));
    flush();
    assert.isNotNull(getByText("*3001#12345#*"));
    // Elegido a mano, ya no dice que sale del navegador.
    assert.isNull(queryByText(/Sale de tu navegador/u));
    assert.isNull(queryByText("Desde un ordenador no se puede medir"));
  });

  it("Escape pide cerrarlo", () => {
    const { dialogo, cierres } = montar(ORDENADOR);
    fireEvent.keyDown(dialogo, { key: "Escape" });
    assert.strictEqual(cierres(), 1);
  });
});

describe("DialogoMedir en Android", () => {
  it("con la marca reconocida enseña su código, los pasos y qué le pasa al móvil", () => {
    const { dialogo, getByText, getByRole } = montar(ANDROID("SM-S921B"));

    assert.isNotNull(getByText("*#0011#"));
    assert.match(dialogo.textContent ?? "", /El navegador no deja que una web lea la señal/u);
    assert.isNotNull(getByText("Haz una captura de pantalla"));
    assert.isNotNull(getByText(/Si no es tu marca, cámbiala arriba/u));

    // Abierto desde el principio: es lo que da confianza para marcar el código.
    const queLePasa = getByRole("button", { name: "¿Qué hace el código en el móvil?" });
    assert.strictEqual(queLePasa.getAttribute("aria-expanded"), "true");
    const contenido = document.getElementById(queLePasa.getAttribute("aria-controls") ?? "");
    assert.isFalse(contenido?.hidden);
    assert.match(contenido?.textContent ?? "", /No instala ni cambia nada/u);
    assert.match(contenido?.textContent ?? "", /No llama ni cuesta nada/u);

    assert.strictEqual(getByRole("combobox", { name: "Marca del móvil" }).tagName, "SELECT");
  });

  it("sin marca reconocida lo dice y no enseña ningún código hasta que se elige", () => {
    const { dialogo, getByRole, getByText, queryByText } = montar(ANDROID());
    assert.isNotNull(getByText(/Elige la marca para ver su código/u));
    assert.notMatch(dialogo.textContent ?? "", /\*#/u);

    fireEvent.change(getByRole("combobox", { name: "Marca del móvil" }), {
      target: { value: "huawei" },
    });
    flush();
    assert.isNotNull(getByText("*#*#4636#*#*"));
    // Un código sin comprobar lo dice.
    assert.isNotNull(getByText("Código sin comprobar"));
    assert.isNull(queryByText(/La marca sale de tu navegador/u));
  });
});
