import type { CapaLeida } from "@celda/dominio/capa";
import { simuladorEnHilo } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { capaDePrueba } from "../capa/pruebas.ts";
import { CapaNoDescargada } from "../capa/servicio.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";

const CAPA: CapaLeida = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: Date.UTC(2026, 8, 25, 23, 44, 53),
  emplazamientos: [
    {
      clave: "movistar-0802532",
      posicion: { longitud: 2.113412, latitud: 41.389278 },
      estado: "verificado",
      companias: ["movistar", "vodafone", "orange"],
    },
  ],
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
          simuladorEnHilo(),
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
          simuladorEnHilo(),
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

    const fecha = await findByText("Datos del mapa: 26 sept 2026");
    assert.strictEqual(fecha.closest("output")?.getAttribute("data-tono"), "fecha");
    await waitFor(() => {
      assert.isNull(queryByText(/No se han podido cargar los emplazamientos/u));
    });
  });
});
