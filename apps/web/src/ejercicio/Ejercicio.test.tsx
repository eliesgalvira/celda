import { ESQUEMA_AJUSTES } from "@celda/dominio/ajustes";
import type { Ficha } from "@celda/dominio/ficha";
import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { type CapaDePrueba, capaDePrueba, FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ruta, ubicacion } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";

const NOCHE = Date.UTC(2026, 8, 26, 0, 15, 3);

// Dos emplazamientos en Pedralbes, a unos 300 m, y uno fuera de Barcelona.
const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: Date.UTC(2026, 8, 25, 23, 44, 53),
  emplazamientos: [
    {
      clave: "movistar-1",
      posicion: { longitud: 2.11, latitud: 41.39 },
      estado: "verificado",
      companias: ["movistar", "orange"],
      bandas: [{ compania: "movistar", mhz: [800] }],
      barrio: "21",
    },
    {
      clave: "movistar-2",
      posicion: { longitud: 2.1136, latitud: 41.39 },
      estado: "verificado",
      companias: ["movistar"],
      barrio: "21",
    },
    {
      clave: "hospitalet",
      posicion: { longitud: 2.1, latitud: 41.36 },
      estado: "verificado",
      companias: ["orange"],
      barrio: null,
    },
  ],
  barrios: [{ codigo: "21", nombre: "Pedralbes", etiqueta: { longitud: 2.11, latitud: 41.39 } }],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

const ficha = (clave: string, mhz: 800 | 3500): Ficha => ({
  clave,
  posicion: { longitud: 2.11, latitud: 41.39 },
  direccion: "PZ PIUS XII, 4. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    {
      compania: "movistar",
      codigos: [clave],
      bandas: [{ referencia: `B B -${mhz}`, compania: "movistar", rangos: [], mhz, anio: 2024 }],
      origenes: [],
    },
  ],
  datosDel: NOCHE,
  version: NOCHE,
});

const montar = (modoEstudiante: boolean) => {
  const fichas = fichasDePrueba();
  const ubicacionPrueba = ubicacionDePrueba({
    ajustes: { esquema: ESQUEMA_AJUSTES, modoEstudiante },
  });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.succeed(CAPA)]),
        fichas.capa,
        simuladorDePrueba,
        ubicacionPrueba.capa,
      )}
    />
  ));
  flush();
  return { ...pantalla, fichas, almacen: ubicacionPrueba.almacen };
};

/** Ejercicio y Ajustes van dentro del botón «Funciones» de los controles. */
const abrirFunciones = async (
  findByRole: (rol: string, opciones: { name: string }) => Promise<HTMLElement>,
) => {
  fireEvent.click(await findByRole("button", { name: "Funciones" }));
  flush();
};

describe("modo estudiante", () => {
  it("apagado, nadie ve el ejercicio, ni aunque lo pida la dirección", async () => {
    navegar("/?ejercicio=21", { reemplazar: true });
    const { findByRole, queryByRole, container } = montar(false);
    await abrirFunciones(findByRole);
    await findByRole("button", { name: "Ajustes" });
    await screen.findByTitle(/3 emplazamientos/u);
    assert.isNull(queryByRole("button", { name: "Ejercicio" }));
    assert.isNull(queryByRole("complementary", { name: "Ejercicio de emplazamientos" }));
    assert.notMatch(container.textContent, /ejercicio|estudiante|usuarios por/iu);
  });

  it("se enciende y se apaga en los ajustes, y el dispositivo lo recuerda", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { findByRole, queryByRole, almacen } = montar(false);
    await abrirFunciones(findByRole);
    fireEvent.click(await findByRole("button", { name: "Ajustes" }));
    flush();
    const interruptor = await screen.findByRole("switch", { name: /Modo estudiante/u });
    assert.strictEqual(interruptor.getAttribute("aria-checked"), "false");

    fireEvent.click(interruptor);
    flush();
    await waitFor(() => assert.isTrue(almacen.ajustes().modoEstudiante));
    // El menú se cerró al abrir los ajustes; se vuelve a abrir para ver el botón nuevo.
    fireEvent.click(await findByRole("button", { name: "Funciones", hidden: true }));
    flush();
    assert.isNotNull(queryByRole("button", { name: "Ejercicio", hidden: true }));

    fireEvent.click(interruptor);
    flush();
    await waitFor(() => assert.isFalse(almacen.ajustes().modoEstudiante));
    assert.isNull(queryByRole("button", { name: "Ejercicio", hidden: true }));
  });

  it("encendido, resuelve el ejercicio de un barrio buscado con sus fuentes y lee las bandas", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { findAllByText, findByRole, findByText, queryByRole, fichas } = montar(true);
    await abrirFunciones(findByRole);
    fireEvent.click(await findByRole("button", { name: "Ejercicio" }));
    flush();
    const panel = await findByRole("complementary", { name: "Ejercicio de emplazamientos" });
    // Se busca por el nombre, sin tildes ni mayúsculas.
    const buscador = await findByRole("searchbox", { name: "Municipio o barrio" });
    await waitFor(() => assert.isFalse(buscador.hasAttribute("disabled")));
    fireEvent.input(buscador, { target: { value: "pedralbes" } });
    flush();
    fireEvent.click(await findByRole("button", { name: /Pedralbes\s*Barrio de Barcelona/u }));
    flush();
    assert.strictEqual(ubicacion().search.get("ejercicio"), "21");
    // En Barcelona se puede pasar del barrio al municipio entero.
    const barrio = await findByRole("combobox", { name: "Barrio" });
    assert.strictEqual(
      barrio.querySelector("option[value='08019']")?.textContent,
      "Todo el municipio",
    );

    // Los habitantes salen del padrón que lleva la web, con su fuente.
    assert.isNotEmpty(
      await findAllByText(/Padrón a 2026-01-01, Ajuntament de Barcelona \(CC BY 4\.0\)/u),
    );
    const tabla = await findByRole("table", {
      name: "Emplazamiento de estaciones base en Pedralbes",
    });
    const fila = (magnitud: string) =>
      Array.from(tabla.querySelectorAll("tr")).find(
        (tr) => tr.querySelector("th")?.firstChild?.textContent === magnitud,
      );
    const celdas = (magnitud: string) =>
      Array.from(fila(magnitud)?.querySelectorAll("td") ?? [], (td) => td.textContent);
    assert.deepStrictEqual(celdas("Estaciones base en la zona").slice(0, 5), [
      "2",
      "0",
      "1",
      "0",
      "0",
    ]);
    // Unos 300 m entre los dos de Movistar: radio de unos 150 m.
    const radio = Number(celdas("Radio de cobertura")[0]);
    assert.approximately(radio, 150, 3);
    assert.match(
      fila("Radio de cobertura")?.querySelector("th")?.textContent ?? "",
      /Mitad de la distancia media/u,
    );
    // Antes de leer las fichas, las bandas son las de la capa: solo se conoce la de 800 MHz.
    await findByText(/La capa del mapa trae bandas de 1 de los 2 emplazamientos/u);
    assert.strictEqual(celdas("800 MHz")[0], "sí");
    assert.strictEqual(celdas("4G")[0], "probable");
    assert.strictEqual(celdas("5G")[0], "no consta");

    // Las bandas se leen de las fichas al pedirlo.
    fireEvent.click(await findByText("Leer las fichas de 2 emplazamientos"));
    flush();
    await waitFor(() => assert.sameMembers([...fichas.abiertas()], ["movistar-1", "movistar-2"]));
    fichas.responder("movistar-1", ficha("movistar-1", 800));
    fichas.responder("movistar-2", ficha("movistar-2", 3500));
    await findByText("Leídas 2 de 2 fichas.");
    // Leídas, no hay botón para volver a leerlas: son de la misma versión que la capa.
    assert.isNull(queryByRole("button", { name: /Leer las fichas|Volver a leer/u, hidden: true }));
    await waitFor(() => assert.strictEqual(celdas("5G")[0], "probable"));
    assert.strictEqual(celdas("800 MHz")[0], "sí");
    assert.strictEqual(celdas("900 MHz")[0], "no");
    assert.isNotNull(panel.querySelector("[data-termino='radio-de-cobertura']"));
  });
});
