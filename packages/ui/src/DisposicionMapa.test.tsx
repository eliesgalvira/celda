import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { Atribucion, type Credito } from "./Atribucion.tsx";
import { ControlDelMapa } from "./ControlDelMapa.tsx";
import { DisposicionMapa } from "./DisposicionMapa.tsx";

const OPENSTREETMAP: Credito = {
  texto: "OpenStreetMap",
  enlace: "https://www.openstreetmap.org/copyright",
};

const MARCAS: Credito = {
  texto: "Las marcas son de sus titulares.",
  corto: "Marcas de sus titulares",
  aviso: true,
};
const CITA: Credito = {
  texto: "Logotipo de DIGI: digimobil.es",
  enlace: "https://www.digimobil.es/",
  aviso: true,
};

const montar = (creditos: ReadonlyArray<Credito> = [OPENSTREETMAP]) => {
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
      atribucion={<Atribucion creditos={creditos} />}
    />
  ));
  flush();
  return pantalla;
};

describe("DisposicionMapa", () => {
  it("un crédito lleva «©» y enlace; un aviso va sin «©», y sin enlace si no tiene fuente", () => {
    const { getByRole, getByText } = montar([OPENSTREETMAP, MARCAS, CITA]);
    const osm = getByRole("link", { name: "© OpenStreetMap" });
    assert.strictEqual(osm.getAttribute("rel"), "noopener noreferrer");
    assert.isNull(getByText("Las marcas son de sus titulares.").closest("a"));
    assert.isNotNull(getByText("Marcas de sus titulares"), "en el móvil, el corto");
    const cita = getByRole("link", { name: "Logotipo de DIGI: digimobil.es" });
    assert.strictEqual(cita.getAttribute("href"), "https://www.digimobil.es/");
    assert.strictEqual(cita.getAttribute("rel"), "noopener noreferrer");
  });

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

  it("plegados en el móvil, el crédito fijo sigue a la vista en una línea, en su forma corta", () => {
    const reserva: Credito = {
      texto: "Sistema Cartográfico Nacional · CC BY 4.0 scne.es",
      corto: "CC BY 4.0 scne.es",
      enlace: "https://www.scne.es/",
      fijo: true,
    };
    const { getByRole, getAllByRole } = montar([reserva, OPENSTREETMAP]);
    /** Los enlaces que no esconde el pliegue en el móvil. */
    const aLaVista = () =>
      getAllByRole("link").filter(
        (enlace) => enlace.closest("p")?.classList.contains("max-md:hidden") !== true,
      );
    assert.lengthOf(aLaVista(), 2);

    fireEvent.pointerDown(getByRole("main", { name: "Mapa de España" }));
    flush();
    const [fijo, ...otros] = aLaVista();
    assert.lengthOf(otros, 0);
    assert.strictEqual(fijo?.textContent, "© CC BY 4.0 scne.es");
    assert.strictEqual(fijo?.getAttribute("href"), "https://www.scne.es/");
    assert.isTrue(fijo?.closest("p")?.classList.contains("whitespace-nowrap"));
    // Desplegados, el fijo va con los demás y en el móvil también se escribe corto.
    fireEvent.click(getByRole("button", { name: "Créditos del mapa" }));
    flush();
    assert.lengthOf(aLaVista(), 2);
    assert.include(
      aLaVista()[0]?.querySelector(".md\\:hidden")?.textContent,
      "© CC BY 4.0 scne.es",
    );
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
