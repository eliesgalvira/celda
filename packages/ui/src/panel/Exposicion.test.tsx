import { assert, describe, it } from "@effect/vitest";
import { render, within } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { FrenteAOtras, MedidaMasAlta, MedidasDeExposicion } from "./Exposicion.tsx";

describe("la sección de las medidas de exposición", () => {
  it("la barra de la más alta llena su parte y solo dice 0 y el final; sin ella, solo la nota", () => {
    const { container, getByText, unmount } = render(() => (
      <MedidaMasAlta
        valor="2,15"
        companias={["orange"]}
        quien="Orange, a 55 m de la antena"
        barra={{ parte: 0.043, final: "49,9" }}
      >
        Es el 1,1 % del nivel de referencia.
      </MedidaMasAlta>
    ));
    flush();
    const barra = container.querySelector("[aria-hidden='true'] > div > div");
    assert.strictEqual(barra?.getAttribute("style"), "width: 4.3%;");
    assert.strictEqual(barra?.closest("[aria-hidden='true']")?.textContent, "049,9");
    assert.isNotNull(getByText("Es el 1,1 % del nivel de referencia."));
    unmount();

    const sin = render(() => (
      <MedidaMasAlta valor="2,15" companias={["orange"]} quien="Orange" barra={undefined}>
        Es el 1,1 % del nivel de referencia.
      </MedidaMasAlta>
    ));
    flush();
    assert.isNull(sin.container.querySelector("[style]"));
  });

  it("el puesto entre las de su zona es un punto sobre la línea, con el número escrito", () => {
    const { container, getByText } = render(() => (
      <FrenteAOtras masAltaQue={95}>Se compara con las medidas de Barcelona.</FrenteAOtras>
    ));
    flush();
    assert.strictEqual(getByText(/más alta que/u).textContent, "más alta que 95 de 100");
    assert.strictEqual(container.querySelector("[style]")?.getAttribute("style"), "left: 95%;");
  });

  it("la tabla de cada compañía dice cuántas de cada 100 quedan por debajo solo si se compara", () => {
    const { getByRole } = render(() => (
      <MedidasDeExposicion
        estaciones={[
          {
            compania: "orange",
            nombre: "Orange",
            filas: [
              {
                distancia: "55 m",
                direccion: "suroeste",
                valor: "2,15",
                comparacion: { masAltaQue: 0 },
              },
            ],
            sinMedidas: "",
          },
          {
            compania: "vodafone",
            nombre: "Vodafone",
            filas: [
              { distancia: "69 m", direccion: "sur", valor: "0,462", comparacion: undefined },
            ],
            sinMedidas: "",
          },
        ]}
      />
    ));
    flush();
    const orange = getByRole("table", { name: "Medidas de exposición de Orange" });
    assert.deepStrictEqual(
      within(orange)
        .getAllByRole("row")
        .map((fila) => fila.textContent),
      ["DistanciaDirecciónµW/cm²Más alta que", "55 msuroeste2,150 de 100"],
    );
    const vodafone = getByRole("table", { name: "Medidas de exposición de Vodafone" });
    assert.lengthOf(within(vodafone).getAllByRole("columnheader"), 3);
  });
});
