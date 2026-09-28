import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { Atribucion } from "./Atribucion.tsx";
import { BotonHexagonal } from "./BotonHexagonal.tsx";
import type { DisposicionControles } from "./controles/aspecto.ts";
import { DisposicionMapa } from "./DisposicionMapa.tsx";

const montar = (disposicion: DisposicionControles) => {
  const pantalla = render(() => (
    <DisposicionMapa
      nombre="Mapa de Barcelona"
      ocupado={false}
      lienzo={() => {}}
      cabecera={<header>Celda</header>}
      disposicion={disposicion}
      zoom={<BotonHexagonal etiqueta="Acercar" icono="+" />}
      controles={<BotonHexagonal etiqueta="Interferencia" icono="≈" />}
      controlesSecundarios={<BotonHexagonal etiqueta="Ajustes" icono="≡" />}
      atribucion={
        <Atribucion
          creditos={[{ texto: "OpenStreetMap", enlace: "https://www.openstreetmap.org/copyright" }]}
        />
      }
    />
  ));
  flush();
  return pantalla;
};

describe("DisposicionMapa: créditos plegables (prototipo de controles)", () => {
  it("hoy los créditos se ven siempre, sin botón «i»", () => {
    const { queryByRole, getByRole } = montar("actual");
    assert.isNull(queryByRole("button", { name: "Créditos del mapa" }));
    assert.isDefined(getByRole("link", { name: "© OpenStreetMap" }));
  });

  it("con una variante se ven al cargar y se pliegan al tocar el mapa", () => {
    const { getByRole } = montar("B");
    const boton = getByRole("button", { name: "Créditos del mapa" });
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");

    fireEvent.pointerDown(getByRole("main", { name: "Mapa de Barcelona" }));
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    // Siguen en el documento: el botón los vuelve a enseñar.
    fireEvent.click(boton);
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    // Tocar el mapa otra vez ya no los pliega: lo ha decidido quien los abrió.
    fireEvent.pointerDown(getByRole("main", { name: "Mapa de Barcelona" }));
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
  });

  it("en la barra (B) las funciones secundarias van dentro de «Más»", () => {
    const { getByRole, queryByRole } = montar("B");
    assert.isDefined(getByRole("navigation", { name: "Funciones del mapa" }));
    assert.isNull(queryByRole("button", { name: "Ajustes" }));
    fireEvent.click(getByRole("button", { name: "Más" }));
    flush();
    assert.isDefined(getByRole("button", { name: "Ajustes" }));
  });
});
