import { assert, describe, it, vi } from "@effect/vitest";
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
    assert.isFalse(disposicion?.hasAttribute("data-creditos"));
    fireEvent.click(getByRole("button", { name: "Créditos del mapa" }));
    flush();
    assert.isTrue(disposicion?.hasAttribute("data-creditos"));
    fireEvent.pointerDown(getByRole("main", { name: "Mapa de España" }));
    flush();
    assert.isFalse(disposicion?.hasAttribute("data-creditos"));
  });

  it("los créditos empiezan plegados; la «i» los abre y tocar el mapa los vuelve a plegar", () => {
    const { getByRole } = montar();
    const boton = getByRole("button", { name: "Créditos del mapa" });
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    fireEvent.click(boton);
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    assert.isDefined(getByRole("link", { name: "© OpenStreetMap" }));
    fireEvent.pointerDown(getByRole("main", { name: "Mapa de España" }));
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
  });

  it("abiertos, los créditos se pliegan solos a los cinco segundos", () => {
    vi.useFakeTimers();
    try {
      const { getByRole } = montar();
      const boton = getByRole("button", { name: "Créditos del mapa" });
      fireEvent.click(boton);
      flush();
      assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
      vi.advanceTimersByTime(4900);
      flush();
      assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
      vi.advanceTimersByTime(200);
      flush();
      assert.strictEqual(boton.getAttribute("aria-expanded"), "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("plegados, el crédito fijo sigue a la vista en una línea, en su forma corta", () => {
    const reserva: Credito = {
      texto: "Sistema Cartográfico Nacional · CC BY 4.0 scne.es",
      corto: "CC BY 4.0 scne.es",
      enlace: "https://www.scne.es/",
      fijo: true,
    };
    const { getByRole, getAllByRole } = montar([reserva, OPENSTREETMAP]);
    /** Los enlaces que no esconde el pliegue. */
    const aLaVista = () =>
      getAllByRole("link").filter(
        (enlace) => enlace.closest("p")?.classList.contains("hidden") !== true,
      );
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
