import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { EjeFrecuencias } from "./EjeFrecuencias.tsx";

const BANDAS = [700, 800, 900, 1800, 2100, 2600, 3500];

describe("EjeFrecuencias", () => {
  it("una fila por compañía, con una casilla rellena en cada banda donde emite", () => {
    const { getByRole } = render(() => (
      <EjeFrecuencias
        titulo="Qué frecuencia usa cada compañía (MHz)"
        bandas={BANDAS}
        filas={[
          { compania: "movistar", nombre: "Movistar", bandas: [800, 3500] },
          {
            compania: "vodafone",
            nombre: "Vodafone",
            bandas: [],
            nota: "Aún no se conocen sus bandas",
          },
        ]}
      />
    ));
    flush();
    const tabla = getByRole("table", { name: "Qué frecuencia usa cada compañía (MHz)" });
    const cabeceras = Array.from(tabla.querySelectorAll("thead th"), (th) => th.textContent);
    assert.deepStrictEqual(
      cabeceras.slice(1),
      BANDAS.map((b) => `${b} MHz`),
    );

    const movistar = getByRole("row", { name: /Movistar/u });
    assert.deepStrictEqual(
      Array.from(movistar.querySelectorAll("[data-emite]"), (c) => c.getAttribute("data-emite")),
      ["no", "si", "no", "no", "no", "no", "si"],
    );
    // Sin bandas conocidas, lo dice en lugar de dejar la fila vacía.
    const vodafone = getByRole("row", { name: /Vodafone/u });
    assert.lengthOf(vodafone.querySelectorAll("[data-emite]"), 0);
    assert.include(vodafone.textContent, "Aún no se conocen sus bandas");
    // La barra explica el eje con palabras, no solo con color.
    assert.include(tabla.textContent, "Llega más lejos");
    assert.include(tabla.textContent, "Más velocidad");
  });

  it("cada hexágono toma el color de la barra bajo el centro de su columna", () => {
    const { getByRole } = render(() => (
      <EjeFrecuencias
        titulo="Qué frecuencia usa cada compañía (MHz)"
        bandas={BANDAS}
        filas={[{ compania: "movistar", nombre: "Movistar", bandas: [700, 3500] }]}
      />
    ));
    flush();
    const casillas = Array.from(
      getByRole("row", { name: /Movistar/u }).querySelectorAll<HTMLElement>("[data-emite]"),
    );
    assert.deepStrictEqual(
      casillas.map((casilla) => casilla.style.getPropertyValue("--en-el-eje")),
      ["7.1%", "21.4%", "35.7%", "50.0%", "64.3%", "78.6%", "92.9%"],
    );
  });
});
