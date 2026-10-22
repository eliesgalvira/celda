import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { capaDePrueba } from "../capa/pruebas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ruta, ubicacion } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { PAGINAS } from "./DialogoSiAlgoVaMal.tsx";

const montar = (direccion: string) => {
  navegar(direccion, { reemplazar: true });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.never]),
        fichasDePrueba().capa,
        ubicacionDePrueba().capa,
      )}
    />
  ));
  flush();
  return pantalla;
};

const CASOS = [
  "No tienes cobertura en casa o se te cortan las llamadas",
  "Todo el barrio va mal con la misma compañía",
  "La tele se ve mal desde que hay 4G o 5G cerca",
  "Un aparato interfiere, como un repetidor comprado por internet",
  "Han montado un emplazamiento sin licencia municipal",
  "Te preocupa la exposición cerca de un colegio",
];

/** Los casos, abiertos, cada uno con lo que tiene dentro. */
const abrirCasos = async () => {
  const panel = await screen.findByRole("dialog", { name: "Si algo va mal" });
  return CASOS.map((titulo) => {
    const boton = within(panel).getByRole("button", { name: titulo });
    fireEvent.click(boton);
    flush();
    assert.strictEqual(boton.getAttribute("aria-expanded"), "true");
    const contenido = document.getElementById(boton.getAttribute("aria-controls") ?? "");
    if (contenido === null) throw new Error(`«${titulo}» no tiene contenido`);
    return { titulo, contenido };
  });
};

describe("si algo va mal", () => {
  it("se abre desde «Funciones» con los seis casos plegados, y al cerrarse sale de la dirección", async () => {
    const { findByRole } = montar(ruta.mapa);
    fireEvent.click(await findByRole("button", { name: "Funciones" }));
    flush();
    fireEvent.click(await findByRole("button", { name: /^Si algo va mal/u }));
    flush();
    const panel = await screen.findByRole("dialog", { name: "Si algo va mal" });
    assert.isTrue(ubicacion().search.has("si-algo-va-mal"));
    assert.deepStrictEqual(
      within(panel)
        .getAllByRole("button", { expanded: false })
        .map((boton) => boton.textContent?.replace("▸", "").trim()),
      CASOS,
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Cerrar" }));
    flush();
    assert.isNull(screen.queryByRole("dialog", { name: "Si algo va mal" }));
    assert.isFalse(ubicacion().search.has("si-algo-va-mal"));
  });

  it("no pide ni envía nada, y cada enlace va a una página oficial que se abre aparte", async () => {
    montar("/?si-algo-va-mal");
    const casos = await abrirCasos();
    const panel = screen.getByRole("dialog", { name: "Si algo va mal" });
    assert.isEmpty(panel.querySelectorAll("form, input, textarea, select"));
    const enlaces = [...panel.querySelectorAll("a")];
    const oficiales: ReadonlyArray<string> = Object.values(PAGINAS).map((pagina) => pagina.enlace);
    assert.isNotEmpty(enlaces);
    for (const enlace of enlaces) {
      assert.include(oficiales, enlace.href);
      assert.strictEqual(enlace.target, "_blank");
      assert.match(new URL(enlace.href).hostname, /(^|\.)(gob\.es|llega700\.es)$/u);
    }
    // Cada caso lleva al menos un paso y lo que conviene guardar.
    for (const { titulo, contenido } of casos) {
      assert.isNotEmpty(within(contenido).getAllByRole("listitem"), titulo);
      assert.isNotNull(within(contenido).queryByText("Qué conviene guardar"), titulo);
    }
  });

  it("«Medir mi señal» sale solo donde ayuda, y se abre encima sin cerrar el panel", async () => {
    montar("/?si-algo-va-mal");
    const casos = await abrirCasos();
    const casosConMedir = casos
      .filter(
        ({ contenido }) =>
          within(contenido).queryByRole("button", { name: "Medir mi señal" }) !== null,
      )
      .map(({ titulo }) => titulo);
    assert.deepStrictEqual(casosConMedir, [CASOS[0], CASOS[1], CASOS[3]]);

    const [primero] = casos;
    if (primero === undefined) throw new Error("sin casos");
    fireEvent.click(within(primero.contenido).getByRole("button", { name: "Medir mi señal" }));
    flush();
    const medir = await screen.findByRole("dialog", { name: "Medir tu señal" });
    assert.isTrue(ubicacion().search.has("si-algo-va-mal"));
    assert.isTrue(ubicacion().search.has("medir"));

    fireEvent.click(within(medir).getByRole("button", { name: "Cerrar" }));
    flush();
    assert.isNull(screen.queryByRole("dialog", { name: "Medir tu señal" }));
    assert.isNotNull(screen.queryByRole("dialog", { name: "Si algo va mal" }));
  });
});
