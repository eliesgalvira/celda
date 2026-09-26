import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { textoEntero } from "../lib/pruebas.ts";
import type { CalculoVista } from "./enMapa.ts";
import type { EleccionVista } from "./interferencia.ts";
import { VistaInterferencia } from "./VistaInterferencia.tsx";

const EMPLAZAMIENTOS: ReadonlyArray<EmplazamientoDeCapa> = [
  {
    clave: "movistar-0802532",
    posicion: { longitud: 2.113412, latitud: 41.389278 },
    estado: "verificado",
    companias: ["movistar", "orange"],
    bandas: [{ compania: "movistar", mhz: [800, 1800] }],
  },
  {
    clave: "movistar-0800001",
    posicion: { longitud: 2.12, latitud: 41.39 },
    estado: "verificado",
    companias: ["movistar"],
  },
];

const montar = (inicial: { calculo: CalculoVista; referencia?: "gps" | "elegido" }) => {
  const [eleccion, setEleccion] = createSignal<EleccionVista>({
    compania: "movistar",
    mhz: 1800,
    ocupacion: 0.5,
  });
  const cambios: Array<EleccionVista> = [];
  let cerrada = false;
  const pantalla = render(() => (
    <VistaInterferencia
      emplazamientos={EMPLAZAMIENTOS}
      eleccion={eleccion()}
      alCambiar={(nueva) => {
        cambios.push(nueva);
        setEleccion(nueva);
      }}
      calculo={inicial.calculo}
      reintentar={() => undefined}
      referencia={inicial.referencia}
      cerca
      alCerrar={() => {
        cerrada = true;
      }}
    />
  ));
  flush();
  return { ...pantalla, cambios, cerrada: () => cerrada };
};

describe("panel de la vista de interferencia", () => {
  it("explica que solo se estorban las de la misma compañía y frecuencia, y que es un modelo", () => {
    const { getByText, getByRole } = montar({
      calculo: { estado: "lista", valor: undefined, conTrama: true },
    });
    getByRole("heading", { name: "Interferencia entre antenas" });
    getByText("Simulación orientativa");
    getByText("Modelo sinr@1");
    getByText(
      textoEntero("Solo se estorban las antenas de la misma compañía en la misma frecuencia."),
    );
    // Dice qué se supone, con el recuento.
    getByText(
      "El registro confirma 1 estación base de Movistar en 1800 MHz. La que aún no tiene bandas leídas se supone en esa banda.",
    );
    getByText(textoEntero("Elige un punto o usa tu ubicación para ver su valor."));
  });

  it("con punto de referencia da el valor con una palabra que lo interpreta", () => {
    const { getByText } = montar({
      calculo: { estado: "lista", valor: 3.2, conTrama: true },
      referencia: "elegido",
    });
    getByText("3 dB · regular");
    getByText(textoEntero("En el punto: 3 dB · regular"));
  });

  it("la compañía, la frecuencia y la ocupación se eligen con controles etiquetados", () => {
    const { getByRole, cambios, getByText } = montar({
      calculo: { estado: "calculando", valor: undefined, conTrama: false },
    });
    const compania = getByRole("combobox", { name: "Compañía" });
    assert.deepStrictEqual(
      Array.from(compania.querySelectorAll("option"), (o) => o.textContent).slice(1),
      ["Movistar", "Orange"],
    );
    fireEvent.change(compania, { target: { value: "orange" } });
    flush();
    assert.strictEqual(cambios.at(-1)?.compania, "orange");

    fireEvent.change(getByRole("combobox", { name: "Frecuencia" }), { target: { value: "800" } });
    flush();
    assert.strictEqual(cambios.at(-1)?.mhz, 800);

    const ocupacion = getByRole("slider", { name: "Ocupación de la red" });
    assert.strictEqual(ocupacion.getAttribute("aria-valuetext"), "50 %");
    fireEvent.input(ocupacion, { target: { value: "80" } });
    flush();
    assert.strictEqual(cambios.at(-1)?.ocupacion, 0.8);
    getByText("80 %");
    getByText("Calculando la interferencia…");
  });

  it("se cierra con su botón", () => {
    const { getByRole, cerrada } = montar({
      calculo: { estado: "lista", valor: undefined, conTrama: true },
    });
    fireEvent.click(getByRole("button", { name: "Cerrar" }));
    assert.isTrue(cerrada());
  });
});
