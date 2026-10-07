import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { FICHA_CORREGIDA } from "../ficha/fichasCorregidas.ts";
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
    const { getByRole, findByText, queryByRole, queryByText } = render(() => (
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
    assert.match(fallo?.textContent ?? "", /sin marcadores aunque haya emplazamientos/u);
    assert.match(fallo?.textContent ?? "", /Puede que falle la conexión/u);

    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    flush();

    const fecha = await findByText(textoEntero("Datos del mapa: 26 sept 2026"));
    assert.strictEqual(fecha.closest("output")?.getAttribute("data-tono"), "fecha");
    await waitFor(() => {
      assert.isNull(queryByText(/No se han podido cargar los emplazamientos/u));
    });
    // Al abrir se ve la península, de lejos: no se descarga ninguna provincia, así que tampoco
    // llegan los barrios de Barcelona ni el crédito de sus límites.
    assert.isNull(queryByRole("link", { name: /Ajuntament de Barcelona/u }));
  });

  it("con la provincia de Barcelona llegan sus barrios y el crédito de sus límites", async () => {
    navegar("/?emplazamiento=movistar-0802532&provincia=08", { reemplazar: true });
    const { findByRole } = render(() => (
      <App
        servicios={Layer.mergeAll(
          capaDePrueba([Effect.succeed(CAPA)]),
          fichasDePrueba().capa,
          simuladorDePrueba,
          ubicacionDePrueba().capa,
        )}
      />
    ));
    flush();

    const credito = await findByRole("link", { name: /Ajuntament de Barcelona \(nov 2024/u });
    assert.strictEqual(credito.getAttribute("href"), FUENTE_DE_BARRIOS.enlace);
    assert.match(credito.getAttribute("title") ?? "", /^Límites de barrio/u);
    assert.include(credito.textContent ?? "", "CC BY 4.0");
  });

  it("la ficha pone delante del municipio el barrio de Barcelona que dice la capa (#13)", async () => {
    const [enPedralbes] = CAPA.emplazamientos;
    if (enPedralbes === undefined) return assert.fail("sin emplazamiento");
    const capa: CapaDePrueba = {
      ...CAPA,
      emplazamientos: [
        { ...enPedralbes, clave: FICHA_CORREGIDA.clave, posicion: FICHA_CORREGIDA.posicion },
      ],
    };
    const fichas = fichasDePrueba();
    navegar(ruta.emplazamiento(FICHA_CORREGIDA.clave, "08"), { reemplazar: true });
    const { findByRole } = render(() => (
      <App
        servicios={Layer.mergeAll(
          capaDePrueba([Effect.succeed(capa)]),
          fichas.capa,
          simuladorDePrueba,
          ubicacionDePrueba().capa,
        )}
      />
    ));
    flush();
    await waitFor(() => {
      assert.include(fichas.abiertas(), FICHA_CORREGIDA.clave);
    });
    fichas.responder(FICHA_CORREGIDA.clave, FICHA_CORREGIDA);

    const panel = await findByRole("article", { name: "CL JORDI GIRONA, 1" });
    await waitFor(() => {
      assert.strictEqual(
        panel.querySelector("header h2 + p")?.textContent,
        `Pedralbes, ${FICHA_CORREGIDA.municipio}`,
      );
    });
  });

  it("con los logos llega a los créditos el aviso de las marcas, sin «©» ni enlace, y sin DIGI no se cita su web", async () => {
    navegar("/?emplazamiento=movistar-0802532&provincia=08", { reemplazar: true });
    const { findByText, queryByRole } = render(() => (
      <App
        servicios={Layer.mergeAll(
          capaDePrueba([Effect.succeed(CAPA)]),
          fichasDePrueba().capa,
          simuladorDePrueba,
          ubicacionDePrueba().capa,
        )}
      />
    ));
    flush();

    const aviso = await findByText(
      "Las marcas y los logotipos de las compañías pertenecen a sus titulares. Celda no está afiliada a ninguna de ellas.",
    );
    assert.isNull(aviso.closest("a"));
    assert.isNull(queryByRole("link", { name: /digimobil\.es/u }));
  });

  it("con emplazamientos de DIGI, los créditos citan su web como fuente de su logotipo", async () => {
    navegar("/?emplazamiento=movistar-0802532&provincia=08", { reemplazar: true });
    const conDigi: CapaDePrueba = {
      ...CAPA,
      emplazamientos: CAPA.emplazamientos.map((e) => ({
        ...e,
        companias: [...e.companias, "digi" as const],
      })),
    };
    const { findAllByRole } = render(() => (
      <App
        servicios={Layer.mergeAll(
          capaDePrueba([Effect.succeed(conDigi)]),
          fichasDePrueba().capa,
          simuladorDePrueba,
          ubicacionDePrueba().capa,
        )}
      />
    ));
    flush();

    const [cita] = await findAllByRole("link", { name: "Logotipo de DIGI: digimobil.es" });
    assert.strictEqual(cita?.getAttribute("href"), "https://www.digimobil.es/");
    assert.strictEqual(cita?.getAttribute("rel"), "noopener noreferrer");
    assert.notInclude(cita?.textContent ?? "", "©");
  });
});

describe("enlace a una ficha sin provincia o con una clave de antes", () => {
  const servicios = (fichas = fichasDePrueba()) =>
    Layer.mergeAll(
      capaDePrueba([Effect.succeed(CAPA)], {
        anteriores: new Map([["orange-juntado", "movistar-0802532"]]),
      }),
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

  it("la de un emplazamiento que se juntó con otro pasa a la de ese otro cuando llega su provincia", async () => {
    navegar("/?emplazamiento=orange-juntado&provincia=08&medir", { reemplazar: true });
    const fichas = fichasDePrueba();
    render(() => <App servicios={servicios(fichas)} />);
    flush();
    await waitFor(() => {
      flush();
      assert.strictEqual(
        window.location.search,
        "?emplazamiento=movistar-0802532&provincia=08&medir",
      );
    });
    assert.include(fichas.abiertas(), "movistar-0802532");
  });
});
