import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { crearAgrupador, type ElementoAgrupacion } from "../capa/agrupacion.ts";
import { combinacionesDe } from "../capa/marcadores.ts";
import { CapaAgrupada } from "./CapaAgrupada.tsx";

const MUNDO: Rectangulo = {
  suroeste: { longitud: -180, latitud: -85 },
  noreste: { longitud: 180, latitud: 85 },
};

const EMPLAZAMIENTOS: ReadonlyArray<EmplazamientoDeCapa> = [
  {
    clave: "a",
    posicion: { longitud: 2.16, latitud: 41.39 },
    estado: "verificado",
    companias: ["movistar"],
  },
  {
    clave: "b",
    posicion: { longitud: 2.16024, latitud: 41.39 },
    estado: "corregido",
    companias: ["vodafone", "orange"],
  },
  {
    clave: "c",
    posicion: { longitud: 2.18, latitud: 41.39 },
    estado: "verificado",
    companias: ["digi"],
  },
];

/** Una proyección lineal cualquiera: basta con que dé píxeles distintos a sitios distintos. */
const proyectar = (posicion: Coordenada) => ({
  x: (posicion.longitud - 2.15) * 10_000,
  y: (41.4 - posicion.latitud) * 10_000,
});

const montar = (reducido: boolean) => {
  const agrupador = crearAgrupador(EMPLAZAMIENTOS);
  const [nivel, setNivel] = createSignal(17);
  const elegidos: Array<string> = [];
  const abiertas: Array<ElementoAgrupacion> = [];
  const contenedor = document.createElement("div");
  document.body.append(contenedor);
  render(() => (
    <CapaAgrupada
      contenedor={contenedor}
      combinaciones={combinacionesDe(EMPLAZAMIENTOS)}
      escena={agrupador.escena(nivel(), MUNDO)}
      transicion={agrupador.transicion}
      proyectar={proyectar}
      seVe={() => true}
      fotograma={0}
      movimientoReducido={reducido}
      seleccionada={null}
      alSeleccionar={(clave) => elegidos.push(clave)}
      alAbrir={(agrupacion) => abiertas.push(agrupacion)}
    />
  ));
  flush();
  const lamina = within(contenedor);
  /** Los marcadores que se pueden pulsar: los que no se están yendo. */
  const pulsables = () =>
    lamina.queryAllByRole("button").filter((boton) => !boton.hasAttribute("inert"));
  return { setNivel, elegidos, abiertas, lamina, pulsables };
};

describe("capa agrupada", () => {
  it("cerca, cada emplazamiento es un botón con nombre que avisa al elegirlo", () => {
    const { lamina, pulsables, elegidos } = montar(false);
    assert.lengthOf(pulsables(), 3);

    fireEvent.click(
      lamina.getByRole("button", {
        name: "Emplazamiento compartido por Vodafone y Orange, corregido",
      }),
    );
    assert.deepStrictEqual(elegidos, ["b"]);
  });

  it("al alejar los recoge en un hexágono que se nombra por su número y acerca al pulsarlo", () => {
    const { setNivel, lamina, pulsables, abiertas } = montar(false);
    setNivel(8);
    flush();

    const hexagono = lamina.getByRole("button", { name: "3 emplazamientos, acercar" });
    assert.strictEqual(hexagono.textContent, "3");
    assert.deepStrictEqual(pulsables(), [hexagono]);
    // Los tres emplazamientos siguen en el DOM mientras se deslizan hacia el hexágono.
    assert.lengthOf(lamina.getAllByRole("button", { name: /^Emplazamiento/u }), 3);

    fireEvent.click(hexagono);
    assert.lengthOf(abiertas, 1);
    assert.strictEqual(abiertas[0]?.cuantos, 3);

    // Al acercar de nuevo vuelven a ser pulsables.
    setNivel(17);
    flush();
    assert.lengthOf(pulsables(), 3);
    assert.isTrue(
      pulsables().every((boton) =>
        (boton.getAttribute("aria-label") ?? "").startsWith("Emplazamiento"),
      ),
    );
  });

  it("con la preferencia de reducir movimiento el cambio es directo", () => {
    const { setNivel, lamina } = montar(true);
    setNivel(8);
    flush();

    assert.lengthOf(lamina.getAllByRole("button"), 1);
    lamina.getByRole("button", { name: "3 emplazamientos, acercar" });
  });
});
