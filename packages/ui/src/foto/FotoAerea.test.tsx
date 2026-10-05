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

  it("dice lo mismo en todos los estados; mientras busca, el hexágono va en el sitio del icono", () => {
    const [estado, setEstado] = createSignal<EstadoEdificio>({ tipo: "parado" });
    const { getByRole } = render(() => (
      <BotonEdificio estado={estado()} alPulsar={() => undefined} />
    ));
    const boton = getByRole("button", { name: "Ver el edificio" });
    const etiqueta = boton.textContent;
    assert.strictEqual(etiqueta, "EdificioVer el edificio");
    const icono = () => boton.querySelector("svg");
    assert.isNotNull(icono());

    const estados: ReadonlyArray<EstadoEdificio> = [
      { tipo: "buscando" },
      { tipo: "resaltado", numero: "251-259" },
      { tipo: "resaltado", numero: undefined },
      { tipo: "sin-contorno" },
      { tipo: "parado" },
    ];
    for (const siguiente of estados) {
      setEstado(siguiente);
      flush();
      assert.strictEqual(boton.getAttribute("aria-label"), "Ver el edificio", siguiente.tipo);
      assert.strictEqual(boton.textContent, etiqueta, siguiente.tipo);
      // La etiqueta se sigue viendo: nada dentro del botón queda invisible.
      assert.isNull(boton.querySelector(".invisible"), siguiente.tipo);
      const buscando = siguiente.tipo === "buscando";
      assert.strictEqual(boton.hasAttribute("disabled"), buscando, siguiente.tipo);
      assert.strictEqual(boton.getAttribute("aria-busy"), String(buscando), siguiente.tipo);
      assert.strictEqual(icono() === null, buscando, siguiente.tipo);
      assert.strictEqual(boton.querySelector(".animate-spin") !== null, buscando, siguiente.tipo);
    }
  });

  it("anuncia al lector de pantalla lo que ha encontrado", () => {
    const [estado, setEstado] = createSignal<EstadoEdificio>({ tipo: "buscando" });
    const { getByRole } = render(() => (
      <BotonEdificio estado={estado()} alPulsar={() => undefined} />
    ));
    const anuncio = () => getByRole("status").textContent;
    assert.strictEqual(getByRole("status").getAttribute("aria-live"), "polite");
    assert.strictEqual(anuncio(), "");

    setEstado({ tipo: "resaltado", numero: "251-259" });
    flush();
    assert.strictEqual(
      anuncio(),
      "El edificio está resaltado en el mapa. En OpenStreetMap lleva el número 251-259.",
    );

    setEstado({ tipo: "resaltado", numero: undefined });
    flush();
    assert.strictEqual(anuncio(), "El edificio está resaltado en el mapa.");

    setEstado({ tipo: "sin-contorno" });
    flush();
    assert.strictEqual(
      anuncio(),
      "OpenStreetMap no tiene dibujado ningún edificio a menos de 25 metros del emplazamiento.",
    );

    setEstado({ tipo: "parado" });
    flush();
    assert.strictEqual(anuncio(), "");
  });
});
