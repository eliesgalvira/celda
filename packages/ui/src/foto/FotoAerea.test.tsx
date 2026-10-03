import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { BotonEdificio, type EstadoEdificio } from "./FotoAerea.tsx";

describe("botón «Ver el edificio»", () => {
  it("se llama «Ver el edificio», dice «Edificio» en el móvil y avisa al pulsarlo", () => {
    let pulsado = 0;
    const { getByRole, getByText } = render(() => (
      <BotonEdificio estado={{ tipo: "parado" }} alPulsar={() => (pulsado += 1)} />
    ));
    const boton = getByRole("button", { name: "Ver el edificio" });
    assert.strictEqual(getByText("Edificio").getAttribute("class"), "md:hidden");
    fireEvent.click(boton);
    assert.strictEqual(pulsado, 1);
  });

  it("mientras busca no se pulsa otra vez; después dice el número de portal o «Sin contorno»", () => {
    const [estado, setEstado] = createSignal<EstadoEdificio>({ tipo: "buscando" });
    const { getByRole, getByText } = render(() => (
      <BotonEdificio estado={estado()} alPulsar={() => undefined} />
    ));
    const boton = getByRole("button", { name: "Ver el edificio" });
    assert.isTrue(boton.hasAttribute("disabled"));
    assert.strictEqual(boton.getAttribute("aria-busy"), "true");

    setEstado({ tipo: "resaltado", numero: "251-259" });
    flush();
    assert.strictEqual(
      getByRole("button").getAttribute("aria-label"),
      "Ver el edificio, nº 251-259",
    );
    assert.isNotNull(getByText("Nº 251-259"));
    assert.match(getByRole("status").textContent ?? "", /número 251-259 de OpenStreetMap/u);

    setEstado({ tipo: "resaltado", numero: undefined });
    flush();
    assert.isNotNull(getByText("Resaltado"));

    setEstado({ tipo: "sin-contorno" });
    flush();
    assert.isNotNull(getByText("Sin contorno"));
    assert.strictEqual(
      getByRole("button").getAttribute("aria-label"),
      "Ver el edificio, sin contorno",
    );
    assert.match(getByRole("status").textContent ?? "", /ningún edificio a menos de 25 metros/u);
  });
});
