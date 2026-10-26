import { ESQUEMA_AJUSTES } from "@celda/dominio/ajustes";
import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { type CapaDePrueba, capaDePrueba, FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";

const NOCHE = Date.UTC(2026, 8, 25, 23, 44, 53);

const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: NOCHE,
  emplazamientos: [
    {
      clave: "movistar-0802532",
      posicion: { longitud: 2.113412, latitud: 41.389278 },
      estado: "verificado",
      companias: ["movistar", "vodafone"],
      barrio: null,
    },
    {
      clave: "digi-0801",
      posicion: { longitud: 2.12, latitud: 41.39 },
      estado: "verificado",
      companias: ["digi"],
      barrio: null,
    },
  ],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

const FICHA: Ficha = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113412, latitud: 41.389278 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    { compania: "movistar", codigos: ["0802532"], bandas: [], bandasSinLeer: true, origenes: [] },
    { compania: "vodafone", codigos: ["0802532"], bandas: [], bandasSinLeer: true, origenes: [] },
  ],
  datosDel: NOCHE,
  version: NOCHE,
};

const montar = (companias?: ReadonlyArray<"movistar" | "digi">) => {
  const fichas = fichasDePrueba();
  const ubicacion = ubicacionDePrueba({
    ajustes:
      companias === undefined
        ? { esquema: ESQUEMA_AJUSTES, modoEstudiante: false }
        : { esquema: ESQUEMA_AJUSTES, modoEstudiante: false, companias },
  });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(capaDePrueba([Effect.succeed(CAPA)]), fichas.capa, ubicacion.capa)}
    />
  ));
  flush();
  return { ...pantalla, fichas, almacen: ubicacion.almacen };
};

/** El aviso de filtro puesto, bajo la fecha de los datos. */
const aviso = () => screen.queryByRole("region", { name: "Filtro de compañías" });

describe("filtro de compañías (ADR 0026)", () => {
  it("«Compañías» abre los chips; desde todas, uno deja solo esa, se guarda y lo dice el aviso", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { findByRole, getByRole, almacen } = montar();
    const pastilla = await findByRole("button", { name: "Compañías" });
    await waitFor(() => assert.isFalse(pastilla.hasAttribute("disabled")));
    assert.strictEqual(pastilla.getAttribute("aria-pressed"), "false");
    fireEvent.click(pastilla);
    flush();
    assert.strictEqual(pastilla.getAttribute("aria-expanded"), "true");

    getByRole("group", { name: "Compañías que se ven" });
    const chips = ["Todas", "Movistar", "Vodafone", "Orange", "Digi", "Yoigo"].map((nombre) => [
      nombre,
      getByRole("button", { name: nombre }).getAttribute("aria-pressed"),
    ]);
    assert.deepStrictEqual(chips, [
      ["Todas", "true"],
      ["Movistar", "false"],
      ["Vodafone", "false"],
      ["Orange", "false"],
      ["Digi", "false"],
      ["Yoigo", "false"],
    ]);
    assert.isNotNull(screen.getByText("Se ven los emplazamientos de todas las compañías."));
    assert.isNull(aviso());

    fireEvent.click(getByRole("button", { name: "Movistar" }));
    flush();
    // El chip cambia en el acto, se guarda en el dispositivo y el panel sigue abierto.
    assert.strictEqual(
      getByRole("button", { name: "Movistar" }).getAttribute("aria-pressed"),
      "true",
    );
    assert.strictEqual(
      getByRole("button", { name: "Todas" }).getAttribute("aria-pressed"),
      "false",
    );
    assert.isNotNull(screen.getByText("Se ven solo los emplazamientos de Movistar."));
    await waitFor(() => assert.deepStrictEqual(almacen.ajustes().companias, ["movistar"]));
    await waitFor(() => assert.isNotNull(aviso()));
    assert.match(aviso()?.textContent ?? "", /Solo Movistar/u);
    assert.strictEqual(pastilla.getAttribute("aria-pressed"), "true");

    // Otra la añade, para comparar.
    fireEvent.click(getByRole("button", { name: "Vodafone" }));
    flush();
    await waitFor(() => assert.match(aviso()?.textContent ?? "", /Solo Movistar y Vodafone/u));

    // Escape cierra el panel y devuelve el foco a la pastilla.
    fireEvent.keyDown(getByRole("button", { name: "Vodafone" }), { key: "Escape" });
    flush();
    assert.strictEqual(pastilla.getAttribute("aria-expanded"), "false");

    // «Ver todas» lo quita de un toque.
    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }));
    flush();
    await waitFor(() => assert.isNull(aviso()));
    await waitFor(() => assert.deepStrictEqual(almacen.ajustes().companias, []));
  });

  it("«¿No sale la tuya?» enseña las compañías sin red propia por su red; «Compañías» y Escape vuelven a los chips", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { findByRole, getByRole, queryByRole } = montar();
    const pastilla = await findByRole("button", { name: "Compañías" });
    await waitFor(() => assert.isFalse(pastilla.hasAttribute("disabled")));
    fireEvent.click(pastilla);
    flush();

    fireEvent.click(getByRole("button", { name: "¿No sale la tuya?" }));
    flush();
    assert.isNull(queryByRole("group", { name: "Compañías que se ven" }));
    const volver = getByRole("button", { name: "Volver a las compañías" });
    assert.strictEqual(document.activeElement, volver);
    const de = (red: string) =>
      within(getByRole("group", { name: `Red de ${red}` }))
        .getAllByRole("button")
        .map((boton) => boton.textContent);
    assert.deepStrictEqual(de("Movistar"), ["O2"]);
    assert.deepStrictEqual(de("Vodafone"), ["Lowi", "Finetwork"]);
    assert.includeMembers(de("Orange"), ["Simyo", "Jazztel", "Pepephone"]);

    fireEvent.click(volver);
    flush();
    getByRole("group", { name: "Compañías que se ven" });
    assert.strictEqual(document.activeElement, getByRole("button", { name: "¿No sale la tuya?" }));

    fireEvent.click(getByRole("button", { name: "¿No sale la tuya?" }));
    flush();
    fireEvent.keyDown(getByRole("button", { name: "Simyo" }), { key: "Escape" });
    flush();
    getByRole("group", { name: "Compañías que se ven" });
    assert.strictEqual(pastilla.getAttribute("aria-expanded"), "true");
    assert.strictEqual(document.activeElement, getByRole("button", { name: "¿No sale la tuya?" }));

    fireEvent.keyDown(getByRole("button", { name: "Todas" }), { key: "Escape" });
    flush();
    assert.strictEqual(pastilla.getAttribute("aria-expanded"), "false");
  });

  it("tocar una compañía sin red propia deja solo su red, cierra el panel y el aviso dice por qué hasta que el filtro cambia", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { findByRole, getByRole, almacen } = montar();
    const pastilla = await findByRole("button", { name: "Compañías" });
    await waitFor(() => assert.isFalse(pastilla.hasAttribute("disabled")));
    fireEvent.click(pastilla);
    flush();
    fireEvent.click(getByRole("button", { name: "¿No sale la tuya?" }));
    flush();

    fireEvent.click(getByRole("button", { name: "Simyo" }));
    flush();
    assert.strictEqual(pastilla.getAttribute("aria-expanded"), "false");
    assert.strictEqual(document.activeElement, pastilla);
    assert.isNotNull(screen.getByText("Se ven solo los emplazamientos de Orange."));
    await waitFor(() => assert.deepStrictEqual(almacen.ajustes().companias, ["orange"]));
    await waitFor(() =>
      assert.strictEqual(aviso()?.textContent, "Solo OrangeVer todasSimyo usa la red de Orange."),
    );

    // Al volver a abrir, el chip de su red está pulsado, y cambiar el filtro con él quita la línea.
    fireEvent.click(pastilla);
    flush();
    assert.strictEqual(getByRole("button", { name: "Orange" }).getAttribute("aria-pressed"), "true");
    fireEvent.click(getByRole("button", { name: "Vodafone" }));
    flush();
    await waitFor(() => assert.strictEqual(aviso()?.textContent, "Solo Vodafone y OrangeVer todas"));
    fireEvent.click(getByRole("button", { name: "Vodafone" }));
    flush();
    await waitFor(() => assert.strictEqual(aviso()?.textContent, "Solo OrangeVer todas"));
  });

  it("con un filtro sin nada que sorprenda, el aviso es una sola línea", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    montar(["movistar"]);
    await waitFor(() => assert.isNotNull(aviso()));
    assert.strictEqual(aviso()?.textContent, "Solo MovistarVer todas");
  });

  it("al volver a abrir Celda en el mismo dispositivo el filtro sigue, y el aviso dice qué sale aparte", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { findByRole, getByRole } = montar(["digi"]);
    await waitFor(() => assert.isNotNull(aviso()));
    assert.match(aviso()?.textContent ?? "", /Solo Digi/u);
    assert.match(aviso()?.textContent ?? "", /La red de Movistar que usa Digi sale más clara\./u);
    fireEvent.click(await findByRole("button", { name: "Compañías" }));
    flush();
    assert.strictEqual(getByRole("button", { name: "Digi" }).getAttribute("aria-pressed"), "true");
  });

  it("la ficha de un emplazamiento de la red que usa una compañía del filtro lo explica", async () => {
    navegar("/?emplazamiento=movistar-0802532&provincia=08", { reemplazar: true });
    const { findByText, fichas } = montar(["digi"]);
    await waitFor(() => assert.include(fichas.abiertas(), FICHA.clave));
    fichas.responder(FICHA.clave, FICHA);
    flush();
    await findByText(/Digi usa aquí la red de Movistar\. Por eso su marcador sale más claro\./u);
  });

  it("sin filtro la ficha no dice nada de redes", async () => {
    navegar("/?emplazamiento=movistar-0802532&provincia=08", { reemplazar: true });
    const { findByText, fichas, queryByText } = montar();
    await waitFor(() => assert.include(fichas.abiertas(), FICHA.clave));
    fichas.responder(FICHA.clave, FICHA);
    flush();
    await findByText(/CL JORDI GIRONA/u);
    assert.isNull(queryByText(/usa aquí la red/u));
  });
});
