import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { puntosDePrueba } from "../capa/pruebas.ts";
import { DialogoLista } from "./DialogoLista.tsx";

const PUNTOS = puntosDePrueba([
  {
    codigo: "08",
    emplazamientos: [
      {
        clave: "movistar-1",
        posicion: { longitud: 2.17, latitud: 41.39 },
        estado: "verificado",
        companias: ["movistar", "orange"],
        barrio: null,
      },
      {
        clave: "vodafone-2",
        posicion: { longitud: 2.172, latitud: 41.39 },
        estado: "verificado",
        companias: ["vodafone"],
        barrio: null,
      },
    ],
  },
]).puntos;

const CAJA = {
  suroeste: { longitud: 2.16, latitud: 41.38 },
  noreste: { longitud: 2.18, latitud: 41.4 },
};

describe("la lista de los emplazamientos que se ven", () => {
  it("es un diálogo con un botón por emplazamiento, con lo que se ve como nombre", () => {
    const elegidos: Array<number> = [];
    const { getByRole, getAllByRole } = render(() => (
      <DialogoLista
        puntos={PUNTOS}
        caja={CAJA}
        filtro={[]}
        alElegir={(indice) => elegidos.push(indice)}
        alCerrar={() => undefined}
      />
    ));
    flush();
    assert.isNotNull(getByRole("dialog", { name: "Emplazamientos a la vista" }));
    const botones = getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Cerrar");
    assert.deepStrictEqual(
      botones.map((b) => b.textContent),
      ["Movistar y Orangeen el centro del mapa", "Vodafonea 170 m al este del centro"],
    );
    fireEvent.click(getByRole("button", { name: /^Vodafone/u }));
    assert.lengthOf(elegidos, 1);
    assert.strictEqual(PUNTOS.companias[elegidos[0] ?? -1], 2);
  });

  it("sin nada a la vista lo dice, y no lleva botones de emplazamientos", () => {
    const { getByText, getAllByRole } = render(() => (
      <DialogoLista
        puntos={PUNTOS}
        caja={undefined}
        filtro={[]}
        alElegir={() => undefined}
        alCerrar={() => undefined}
      />
    ));
    flush();
    assert.isNotNull(getByText("No se ve ninguno. Mueve o aleja el mapa."));
    assert.deepStrictEqual(
      getAllByRole("button").map((b) => b.getAttribute("aria-label")),
      ["Cerrar"],
    );
  });
});
