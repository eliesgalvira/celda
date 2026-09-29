import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { type CapaDePrueba, capaDePrueba, FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { CapaNoDescargada } from "../capa/servicio.ts";
import { textoEntero } from "../lib/pruebas.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";

const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: Date.UTC(2026, 8, 25, 23, 44, 53),
  emplazamientos: [
    {
      clave: "movistar-0802532",
      posicion: { longitud: 2.113412, latitud: 41.389278 },
      estado: "verificado",
      companias: ["movistar", "vodafone", "orange"],
      barrio: "21",
    },
  ],
  barrios: [{ codigo: "21", nombre: "Pedralbes", etiqueta: { longitud: 2.11, latitud: 41.39 } }],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

const NO_LLEGA = Effect.fail(
  new CapaNoDescargada({ url: "http://capas.prueba/sitios.json", motivo: "HTTP 503" }),
);

// happy-dom no tiene WebGL, así que el mapa base no se dibuja; la capa se carga igual y su
// estado se ve bajo la cabecera.
describe("capa de emplazamientos en el mapa", () => {
  it("mientras carga lo dice, y no aparenta un mapa vacío ni sin emplazamientos", () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { getByRole, getByText, queryByText, queryAllByRole } = render(() => (
      <App
        servicios={Layer.mergeAll(
          capaDePrueba([Effect.never]),
          fichasDePrueba().capa,
          simuladorDePrueba,
          ubicacionDePrueba().capa,
        )}
      />
    ));
    flush();

    const estado = getByText("Cargando los emplazamientos…").closest("output");
    assert.strictEqual(estado?.getAttribute("data-tono"), "espera");
    assert.strictEqual(getByRole("main").getAttribute("aria-busy"), "true");
    assert.isNull(queryByText(/\b0 emplazamientos|sin emplazamientos/iu));
    assert.lengthOf(queryAllByRole("button", { name: /^Emplazamiento/u }), 0);
  });

  it("si no carga, lo dice con un reintento; al reintentar enseña la fecha de los datos", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { getByRole, findByText, queryByText } = render(() => (
      <App
        servicios={Layer.mergeAll(
          capaDePrueba([NO_LLEGA, Effect.succeed(CAPA)]),
          fichasDePrueba().capa,
          simuladorDePrueba,
          ubicacionDePrueba().capa,
        )}
      />
    ));
    flush();

    const titulo = await findByText("No se han podido cargar los emplazamientos");
    const fallo = titulo.closest("[role=alert]");
    assert.isNotNull(fallo);
    assert.match(fallo?.textContent ?? "", /no quiere decir que no haya emplazamientos/u);
    assert.match(fallo?.textContent ?? "", /no ha llegado/u);

    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    flush();

    const fecha = await findByText(textoEntero("Datos del mapa: 26 sept 2026"));
    assert.strictEqual(fecha.closest("output")?.getAttribute("data-tono"), "fecha");
    // Con la capa llegan sus barrios, y con ellos el crédito de sus límites.
    const credito = getByRole("link", { name: /Ajuntament de Barcelona \(nov 2024/u });
    assert.strictEqual(credito.getAttribute("href"), FUENTE_DE_BARRIOS.enlace);
    assert.match(credito.getAttribute("title") ?? "", /^Límites de barrio/u);
    assert.include(credito.textContent ?? "", "CC BY 4.0");
    await waitFor(() => {
      assert.isNull(queryByText(/No se han podido cargar los emplazamientos/u));
    });
  });
});

describe("enlace a una ficha sin provincia", () => {
  const servicios = (fichas = fichasDePrueba()) =>
    Layer.mergeAll(
      capaDePrueba([Effect.succeed(CAPA)]),
      fichas.capa,
      simuladorDePrueba,
      ubicacionDePrueba().capa,
    );

  it("busca su provincia en el índice de claves y la pone en la dirección, sin perder el resto", async () => {
    navegar("/?emplazamiento=movistar-0802532&medir", { reemplazar: true });
    const fichas = fichasDePrueba();
    render(() => <App servicios={servicios(fichas)} />);
    flush();
    await waitFor(() => {
      flush();
      assert.strictEqual(
        window.location.search,
        "?emplazamiento=movistar-0802532&medir&provincia=08",
      );
    });
    assert.include(fichas.abiertas(), "movistar-0802532");
  });

  it("una clave que no tiene ninguna provincia no existe, y la dirección se queda como estaba", async () => {
    navegar("/?emplazamiento=movistar-nadie", { reemplazar: true });
    const fichas = fichasDePrueba();
    const { findByText } = render(() => <App servicios={servicios(fichas)} />);
    flush();
    await findByText(textoEntero("Datos del mapa: 26 sept 2026"));
    await waitFor(() => {
      flush();
      assert.include(fichas.abiertas(), "movistar-nadie");
    });
    fichas.responder("movistar-nadie", "no-existe");
    await findByText("Este emplazamiento no existe");
    assert.strictEqual(window.location.search, "?emplazamiento=movistar-nadie");
  });
});
