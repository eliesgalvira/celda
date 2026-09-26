import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { CalculandoDiagrama, DiagramaRadiacion, LobulosSector } from "./DiagramaRadiacion.tsx";

const RUMBOS = Array.from({ length: 72 }, (_, i) => i * 5);
const lobulo = (azimut: number) =>
  RUMBOS.map((rumbo) => {
    const d = ((((rumbo - azimut) % 360) + 540) % 360) - 180;
    return -Math.min(12 * (d / 65) ** 2, 30);
  });

const marco = {
  titulo: "Diagrama de radiación",
  descripcion: "Tres sectores con orientación supuesta a 0°, 120° y 240°.",
  modelo: "diagrama-sector v1",
  leyenda: ["Sector 1 · 0°", "Sector 2 · 120°", "Sector 3 · 240°"],
  notas: ["Orientación supuesta."],
  atenuacionMaxima: 30,
};

describe("DiagramaRadiacion", () => {
  it("es una imagen con nombre y descripción, marcada como modelo con su versión", () => {
    const { getByRole, getByText } = render(() => (
      <DiagramaRadiacion {...marco}>
        <LobulosSector
          rumbos={RUMBOS}
          sectores={[0, 120, 240].map((azimut) => ({
            azimut,
            etiqueta: `${azimut}°`,
            ganancia: lobulo(azimut),
          }))}
          orientacion="supuesta"
          atenuacionMaxima={30}
        />
      </DiagramaRadiacion>
    ));
    flush();
    const imagen = getByRole("img", { name: "Diagrama de radiación" });
    assert.strictEqual(
      imagen.getAttribute("aria-describedby"),
      imagen.querySelector("desc")?.getAttribute("id"),
    );
    assert.include(imagen.querySelector("desc")?.textContent, "orientación supuesta");
    assert.lengthOf(imagen.querySelectorAll("path"), 3);
    assert.strictEqual(imagen.querySelector("path")?.namespaceURI, "http://www.w3.org/2000/svg");
    getByText("Modelo");
    getByText("diagrama-sector v1");
    getByText("Sector 2 · 120°");
    getByText("Orientación supuesta.");
  });

  it("con orientación estimada dibuja el margen a los dos lados de cada eje", () => {
    const { getByRole } = render(() => (
      <DiagramaRadiacion {...marco}>
        <LobulosSector
          rumbos={RUMBOS}
          sectores={[{ azimut: 40, etiqueta: "40° ±15°", ganancia: lobulo(40) }]}
          orientacion="estimada"
          margen={15}
          destacado={0}
          atenuacionMaxima={30}
        />
      </DiagramaRadiacion>
    ));
    flush();
    const imagen = getByRole("img", { name: "Diagrama de radiación" });
    assert.lengthOf(imagen.querySelectorAll("g[data-sectores] line"), 2);
    assert.strictEqual(imagen.querySelector("path")?.getAttribute("data-destacado"), "si");
    assert.include(imagen.textContent, "40° ±15°");
  });

  it("mientras calcula, el marco ya está y no hay lóbulos", () => {
    const { getByRole } = render(() => (
      <DiagramaRadiacion {...marco}>
        <CalculandoDiagrama />
      </DiagramaRadiacion>
    ));
    flush();
    const imagen = getByRole("img", { name: "Diagrama de radiación" });
    assert.lengthOf(imagen.querySelectorAll("path"), 0);
    assert.lengthOf(imagen.querySelectorAll("circle"), 3);
    assert.include(imagen.textContent, "Calculando el modelo…");
  });
});
