import type { Coordenada } from "@celda/dominio/area";
import { ESQUEMA_AJUSTES } from "@celda/dominio/ajustes";
import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import * as Layer from "effect/Layer";
import { createSignal, flush } from "solid-js";

import { App } from "../App.tsx";
import { capaDePrueba } from "../capa/pruebas.ts";
import type { CapaEmplazamientos } from "../capa/servicio.ts";
import { ProveedorDeDatos } from "../datos.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ubicacion } from "../lib/rutas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { PanelEjercicio } from "./PanelEjercicio.tsx";
import {
  capaDeProvincias,
  emplazamiento,
  municipio,
  provinciaCargada,
  type ProvinciaDePrueba,
  resumenDeProvincias,
} from "./pruebas.ts";

// Tordera, en Barcelona junto a Girona: dos emplazamientos de Movistar a unos 2,2 km. Al otro lado
// del borde, en Blanes, hay uno a 1,7 km del segundo, más cerca que su vecina de Barcelona.
const TORDERA_1 = emplazamiento("tordera-1", "08284", { longitud: 2.7188, latitud: 41.6993 }, [
  "movistar",
  "vodafone",
]);
const TORDERA_2 = emplazamiento("tordera-2", "08284", { longitud: 2.745, latitud: 41.695 }, [
  "movistar",
]);
const BARCELONA = emplazamiento("barcelona", "08019", { longitud: 2.17, latitud: 41.39 }, [
  "vodafone",
]);
const BLANES = emplazamiento("blanes", "17023", { longitud: 2.765, latitud: 41.69 }, ["movistar"]);
const GIRONA = emplazamiento("girona", "17079", { longitud: 2.82, latitud: 41.98 }, ["vodafone"]);

const EN_BARCELONA = [TORDERA_1, TORDERA_2, BARCELONA];
const EN_GIRONA = [BLANES, GIRONA];

const PROVINCIAS: ReadonlyArray<ProvinciaDePrueba> = [
  {
    codigo: "08",
    nombre: "Barcelona",
    etiqueta: { longitud: 1.98, latitud: 41.73 },
    cubierta: true,
    emplazamientos: EN_BARCELONA,
    municipios: [
      municipio("08019", "Barcelona", 1_731_649, 100.52, EN_BARCELONA),
      municipio("08284", "Tordera", 19_039, 83.06, EN_BARCELONA),
    ],
  },
  {
    codigo: "17",
    nombre: "Girona",
    etiqueta: { longitud: 2.67, latitud: 42.13 },
    cubierta: true,
    emplazamientos: EN_GIRONA,
    municipios: [
      // Como un municipio recién creado que el padrón aún no tiene.
      municipio("17023", "Blanes", null, 17.73, EN_GIRONA),
      municipio("17079", "Girona", 106_476, 39.13, EN_GIRONA),
    ],
  },
  {
    codigo: "42",
    nombre: "Soria",
    etiqueta: { longitud: -2.6, latitud: 41.6 },
    cubierta: false,
    emplazamientos: [],
    municipios: [],
  },
];

const servicios = (capa: Layer.Layer<CapaEmplazamientos>) => {
  const ubicacionPrueba = ubicacionDePrueba({
    ajustes: { esquema: ESQUEMA_AJUSTES, modoEstudiante: true },
  });
  return Layer.mergeAll(capa, fichasDePrueba().capa, simuladorDePrueba, ubicacionPrueba.capa);
};

/** Monta la web con el modo estudiante encendido y la capa de varias provincias. */
const montar = (ruta: string) => {
  navegar(ruta, { reemplazar: true });
  const capa = capaDeProvincias(PROVINCIAS);
  const pantalla = render(() => <App servicios={servicios(capa.capa)} />);
  flush();
  return { ...pantalla, capa };
};

/** Las celdas de una fila de la tabla del ejercicio. */
const celdas = (tabla: HTMLElement, magnitud: string) =>
  Array.from(
    Array.from(tabla.querySelectorAll("tr"))
      .find((tr) => tr.querySelector("th")?.firstChild?.textContent === magnitud)
      ?.querySelectorAll("td") ?? [],
    (td) => td.textContent,
  );

describe("ejercicio en un municipio", () => {
  it("se busca, pide su provincia y la de al lado para el radio, y cita el padrón del INE", async () => {
    const { findByRole, findAllByText, queryByText, capa } = montar("/?ejercicio=");
    const buscador = await findByRole("searchbox", { name: "Municipio o barrio" });
    await waitFor(() => assert.isFalse(buscador.hasAttribute("disabled")));
    fireEvent.input(buscador, { target: { value: "torde" } });
    flush();
    fireEvent.click(await findByRole("button", { name: /Tordera\s*Barcelona/u }));
    flush();
    assert.strictEqual(ubicacion().search.get("ejercicio"), "08284");

    await waitFor(() => assert.include(capa.pedidas(), "08"));
    capa.responder("08");
    const tabla = await findByRole("table", {
      name: "Emplazamiento de estaciones base en Tordera (Barcelona)",
    });
    assert.deepStrictEqual(celdas(tabla, "Código INE").slice(0, 1), ["08284"]);
    assert.deepStrictEqual(celdas(tabla, "Habitantes").slice(0, 1), ["19.039"]);
    assert.isNotEmpty(
      await findAllByText(/Padrón a 2025-01-01, INE \(CC BY 4\.0\)\. Elaboración propia/u),
    );

    // El segundo emplazamiento de Tordera puede tener su vecina en Girona: se pide y, mientras
    // llega, la tabla no se descarga.
    await waitFor(() => assert.include(capa.pedidas(), "17"));
    assert.isNotNull(queryByText("Buscando vecinas al otro lado del borde"));
    const csv = await findByRole("button", { name: "Descargar CSV" });
    assert.isTrue(csv.hasAttribute("disabled"));
    const antes = Number(celdas(tabla, "Radio de cobertura")[0]?.replace(".", ""));

    capa.responder("17");
    await waitFor(() => assert.isFalse(csv.hasAttribute("disabled")));
    const despues = Number(celdas(tabla, "Radio de cobertura")[0]?.replace(".", ""));
    // Sin Girona, las dos se tienen de vecina a 2,2 km; con Girona, la segunda está a 1,7 km.
    assert.approximately(antes, 1100, 30);
    assert.approximately(despues, 980, 30);
    assert.isNull(queryByText("Buscando vecinas al otro lado del borde"));
    // Cada provincia se pide una vez.
    assert.deepStrictEqual(
      capa.pedidas().filter((c) => c === "08" || c === "17"),
      ["08", "17"],
    );
  });

  it("un municipio sin habitantes en el padrón lo dice en lugar de dividir por cero", async () => {
    const { findByRole, capa } = montar("/?ejercicio=17023");
    capa.responder("17");
    capa.responder("08");
    const panel = await findByRole("complementary", { name: "Ejercicio de emplazamientos" });
    // Lo dice la nota de la zona y la cadena de los usuarios por estación.
    assert.lengthOf(await within(panel).findAllByText("El padrón aún no tiene esta zona"), 2);
    const tabla = await findByRole("table", {
      name: "Emplazamiento de estaciones base en Blanes (Girona)",
    });
    assert.strictEqual(celdas(tabla, "Habitantes")[0], "—");
    assert.strictEqual(celdas(tabla, "Densidad")[0], "—");
    assert.strictEqual(celdas(tabla, "Usuarios por estación base")[0], "—");
    assert.strictEqual(celdas(tabla, "Estaciones base en la zona")[0], "1");
  });

  it("en una provincia que Celda aún no tiene lo dice y no pide nada", async () => {
    const { findByText, capa } = montar("/?ejercicio=42173");
    await findByText("Celda aún no tiene datos de Soria");
    assert.notInclude(capa.pedidas(), "42");
  });

  it("si la provincia no llega lo dice, y se puede reintentar", async () => {
    const { findByRole, capa } = montar("/?ejercicio=08284");
    await waitFor(() => assert.include(capa.pedidas(), "08"));
    capa.fallar("08");
    const panel = await findByRole("complementary", { name: "Ejercicio de emplazamientos" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Reintentar" }));
    flush();
    capa.responder("08");
    capa.responder("17");
    await findByRole("table", { name: "Emplazamiento de estaciones base en Tordera (Barcelona)" });
    assert.deepStrictEqual(
      capa.pedidas().filter((c) => c === "08"),
      ["08", "08"],
    );
  });
});

describe("elegir la zona en el mapa", () => {
  /** El panel solo, con las dos provincias ya cargadas y el mapa sustituido por una función. */
  const montarPanel = () => {
    const [zona, setZona] = createSignal("");
    let alTocar: ((punto: Coordenada) => void) | undefined;
    const esperas: Array<boolean> = [];
    const cargadas = new Map(
      PROVINCIAS.slice(0, 2).map(
        (p) => [p.codigo, { tipo: "lista", provincia: provinciaCargada(p) }] as const,
      ),
    );
    const pantalla = render(() => (
      <ProveedorDeDatos servicios={servicios(capaDePrueba([]))}>
        <PanelEjercicio
          zona={zona()}
          resumen={resumenDeProvincias(PROVINCIAS)}
          provincias={cargadas}
          emplazamientos={[...EN_BARCELONA, ...EN_GIRONA]}
          alElegirZona={setZona}
          alPedirProvincias={() => undefined}
          alReintentarProvincias={() => undefined}
          alEsperarPunto={(funcion) => {
            alTocar = funcion;
            esperas.push(funcion !== undefined);
          }}
          alDibujar={() => undefined}
          alCerrar={() => undefined}
        />
      </ProveedorDeDatos>
    ));
    flush();
    return { ...pantalla, zona, tocar: (punto: Coordenada) => alTocar?.(punto), esperas };
  };

  it("el punto tocado elige su municipio y deja de esperar al mapa", async () => {
    const { findByRole, zona, tocar, esperas } = montarPanel();
    const boton = await findByRole("button", { name: "Elegir en el mapa" });
    await waitFor(() => assert.isFalse(boton.hasAttribute("disabled")));
    fireEvent.click(boton);
    flush();
    assert.deepStrictEqual(esperas, [true]);
    tocar({ longitud: 2.7188, latitud: 41.6993 });
    await waitFor(() => assert.strictEqual(zona(), "08284"));
    assert.deepStrictEqual(esperas, [true, false]);
  });

  it("en Barcelona elige el barrio, y en el mar pide tocar dentro de un municipio", async () => {
    const { findByRole, findByText, zona, tocar } = montarPanel();
    const boton = await findByRole("button", { name: "Elegir en el mapa" });
    await waitFor(() => assert.isFalse(boton.hasAttribute("disabled")));
    fireEvent.click(boton);
    flush();
    tocar({ longitud: 2.5, latitud: 41.2 });
    await findByText("Ahí no hay ningún municipio. Toca dentro de uno.");
    assert.strictEqual(zona(), "");
    // Pedralbes, junto al Campus Nord.
    tocar({ longitud: 2.113, latitud: 41.388 });
    await waitFor(() => assert.strictEqual(zona(), "21"));
    await screen.findByRole("combobox", { name: "Barrio" });
  });
});
