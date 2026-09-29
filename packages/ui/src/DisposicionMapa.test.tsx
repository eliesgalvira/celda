import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { Atribucion } from "./Atribucion.tsx";
import { ControlDelMapa } from "./ControlDelMapa.tsx";
import { DisposicionMapa } from "./DisposicionMapa.tsx";

const montar = () => {
  const pantalla = render(() => (
    <DisposicionMapa
      nombre="Mapa de España"
      ocupado={false}
      lienzo={() => {}}
      cabecera={<header>Celda</header>}
      zoom={<ControlDelMapa etiqueta="Acercar" icono="+" />}
      controles={<ControlDelMapa etiqueta="Interferencia" icono="≈" />}
      botonUbicacion={<ControlDelMapa etiqueta="Ubicación" icono="⌖" />}
      controlesSecundarios={<ControlDelMapa etiqueta="Ajustes" icono="≡" />}
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

describe("DisposicionMapa", () => {
  it("con los créditos abiertos, la disposición lo marca para apartar la pista en el móvil", () => {
    const { getByRole } = montar();
    const disposicion = getByRole("main", { name: "Mapa de España" }).parentElement;
    assert.isTrue(disposicion?.hasAttribute("data-creditos"));
    fireEvent.pointerDown(getByRole("main", { name: "Mapa de España" }));
    flush();
    assert.isFalse(disposicion?.hasAttribute("data-creditos"));
  });

  it("los créditos se ven al cargar y se pliegan al tocar el mapa", () => {
    const { getByRole } = montar();
    const boton = getByRole("button", { name: "Créditos del mapa" });
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    assert.isDefined(getByRole("link", { name: "© OpenStreetMap" }));

    fireEvent.pointerDown(getByRole("main", { name: "Mapa de España" }));
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    // Siguen en el documento: el botón los vuelve a enseñar.
    fireEvent.click(boton);
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    // Tocar el mapa otra vez ya no los pliega: lo ha decidido quien los abrió.
    fireEvent.pointerDown(getByRole("main", { name: "Mapa de España" }));
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
  });

  it("a la vista, Ubicación y Funciones; el resto, dentro de Funciones", () => {
    const { getByRole, queryByRole } = montar();
    assert.isDefined(getByRole("button", { name: "Ubicación" }));
    assert.isNull(queryByRole("button", { name: "Interferencia" }));
    assert.isNull(queryByRole("button", { name: "Ajustes" }));
    fireEvent.click(getByRole("button", { name: "Funciones" }));
    flush();
    assert.isDefined(getByRole("button", { name: "Interferencia" }));
    assert.isDefined(getByRole("button", { name: "Ajustes" }));
  });
});
