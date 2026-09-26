import type { CapaLeida } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { simuladorEnHilo } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor, within } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { capaDePrueba } from "../capa/pruebas.ts";
import { terminosSubrayados } from "../lib/pruebas.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import { FICHA_COMPANIA_ANADIDA, FICHA_CORREGIDA, FICHA_NUEVA } from "./fichasCorregidas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { fichasDePrueba } from "./pruebas.ts";

/** La capa de la misma instantánea que las fichas, con sus estados. */
const CAPA: CapaLeida = {
  version: "sitios@2026-09-27T03:15:00Z",
  fecha: FICHA_CORREGIDA.version,
  emplazamientos: [FICHA_CORREGIDA, FICHA_NUEVA, FICHA_COMPANIA_ANADIDA].map((f) => ({
    clave: f.clave,
    posicion: f.posicion,
    estado: f.estado,
    companias: f.estaciones.map((e) => e.compania),
  })),
};

/** La app abierta en la ficha, que llega en cuanto su lectura está abierta. */
const abrirCon = async (ficha: Ficha) => {
  const fichas = fichasDePrueba();
  navegar(ruta.emplazamiento(ficha.clave), { reemplazar: true });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.succeed(CAPA)]),
        fichas.capa,
        simuladorEnHilo(),
        ubicacionDePrueba().capa,
      )}
    />
  ));
  flush();
  await waitFor(() => {
    assert.include(fichas.abiertas(), ficha.clave);
  });
  fichas.responder(ficha.clave, ficha);
  return pantalla;
};

describe("panel de un emplazamiento con correcciones de la comunidad", () => {
  it("corregido: la etiqueta de estado y las dos versiones, cada una con su fecha y su enlace", async () => {
    const { findByRole, getByText, getByRole } = await abrirCon(FICHA_CORREGIDA);
    const panel = await findByRole("article", { name: "CL JORDI GIRONA, 1" });

    const etiqueta = within(panel).getByText("Corregido");
    assert.strictEqual(etiqueta.getAttribute("data-tono"), "corregido");

    assert.isNotNull(getByRole("heading", { name: /Registro oficial y comunidad/u }));
    const vodafone = within(panel).getByLabelText("Qué dice cada fuente de Vodafone");
    assert.isNotNull(within(vodafone).getByText("La tiene dada de alta"));
    assert.isNotNull(within(vodafone).getByText("desde el 26 sept 2026"));
    assert.isNotNull(within(vodafone).getByText("La da por desmontada"));
    assert.isNotNull(within(vodafone).getByText("desde el 27 sept 2026"));
    assert.strictEqual(
      within(vodafone)
        .getByRole("link", { name: /Ver en antenasmoviles\.es/u })
        .getAttribute("href"),
      "https://antenasmoviles.es/#19/41.388342/2.113628",
    );
    // La sección subraya el registro oficial en su título y la corrección en su frase.
    const seccion = getByRole("heading", { name: /Registro oficial y comunidad/u }).closest(
      "section",
    );
    assert.deepStrictEqual(seccion === null ? [] : terminosSubrayados(seccion).slice(0, 3), [
      "registro-oficial",
      "correccion",
      "emplazamiento",
    ]);
    // Cita a antenasmoviles.es y explica adónde lleva el enlace (historia 61).
    assert.isNotNull(getByText(/^Correcciones de la comunidad de antenasmoviles\.es/u));
  });

  it("nuevo: la etiqueta y que el registro oficial no lo tiene", async () => {
    const { findByRole } = await abrirCon(FICHA_NUEVA);
    const panel = await findByRole("article", { name: "Carrer de Tarragona, 177" });
    assert.strictEqual(within(panel).getByText("Nuevo").getAttribute("data-tono"), "nuevo");
    const movistar = within(panel).getByLabelText("Qué dice cada fuente de Movistar");
    assert.isNotNull(within(movistar).getByText("No la tiene"));
    assert.isNotNull(within(movistar).getByText("La han añadido sus usuarios"));
    assert.isNotEmpty(within(panel).getAllByText(/no se conocen sus bandas/u));
  });

  it("verificado: sin correcciones no hay sección de la comunidad", async () => {
    const verificada: Ficha = {
      ...FICHA_CORREGIDA,
      estado: "verificado",
      confianza: "media",
      conflictos: [],
      estaciones: FICHA_CORREGIDA.estaciones.slice(0, 1),
    };
    const { findByRole, queryByRole } = await abrirCon(verificada);
    const panel = await findByRole("article", { name: "CL JORDI GIRONA, 1" });
    assert.strictEqual(
      within(panel).getByText("Verificado").getAttribute("data-tono"),
      "verificado",
    );
    assert.isNull(queryByRole("heading", { name: /Registro oficial y comunidad/u }));
  });
});
