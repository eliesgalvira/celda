import type { PuntoElegido } from "@celda/dominio/aportacion";
import type { CapaLeida } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { simuladorEnHilo } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { capaDePrueba } from "../capa/pruebas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import type { Direccion } from "./buscador.ts";
import type { LecturaGps } from "./estado.ts";
import { type OpcionesDeUbicacion, ubicacionDePrueba } from "./pruebas.ts";

const NOCHE = Date.UTC(2026, 8, 26, 0, 15, 3);

const CAMPUS_NORD: Ficha = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    {
      compania: "movistar",
      codigos: ["0802532"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802532",
          fecha: NOCHE,
          afirma: "presente",
        },
      ],
    },
  ],
  datosDel: NOCHE,
  version: NOCHE,
};

const CAPA: CapaLeida = {
  version: "sitios@2026-09-26T00:15:03Z",
  fecha: NOCHE,
  emplazamientos: [
    {
      clave: CAMPUS_NORD.clave,
      posicion: CAMPUS_NORD.posicion,
      estado: "verificado",
      companias: ["movistar"],
    },
  ],
};

// Unos 340 m al suroeste del emplazamiento.
const CERCA = { longitud: 2.1109, latitud: 41.3861 };

const LECTURA: LecturaGps = { posicion: CERCA, precision: 25, fecha: NOCHE };

const PUNTO: PuntoElegido = {
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f",
  tipo: "punto-elegido",
  esquema: 1,
  creada: NOCHE,
  origen: "mapa",
  posicion: CERCA,
};

const SAGRADA_FAMILIA: Direccion = {
  nombre: "Basílica de la Sagrada Familia",
  detalle: "Carrer de Provença, la Sagrada Família, l'Eixample, Barcelona",
  posicion: { longitud: 2.1744283, latitud: 41.4035046 },
};

/** La app con la ficha de Campus Nord abierta y ya leída, y la ubicación en manos de la prueba. */
const abrir = async (opciones: OpcionesDeUbicacion = {}) => {
  const fichas = fichasDePrueba();
  const ubicacion = ubicacionDePrueba(opciones);
  navegar(ruta.emplazamiento(CAMPUS_NORD.clave), { reemplazar: true });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.succeed(CAPA)]),
        fichas.capa,
        simuladorEnHilo(),
        ubicacion.capa,
      )}
    />
  ));
  flush();
  await waitFor(() => {
    assert.include(fichas.abiertas(), CAMPUS_NORD.clave);
  });
  fichas.responder(CAMPUS_NORD.clave, CAMPUS_NORD);
  await pantalla.findByRole("heading", { name: "CL JORDI GIRONA, 1" });
  const panel = () => within(pantalla.getByRole("region", { name: "Punto de referencia" }));
  const pulsar = (nombre: string | RegExp) => {
    fireEvent.click(pantalla.getByRole("button", { name: nombre }));
    flush();
  };
  return { ...pantalla, ...ubicacion, panel, pulsar };
};

describe("punto de referencia: pedir la ubicación", () => {
  it("sin punto, la ficha explica qué se gana con uno", async () => {
    const { panel } = await abrir();
    assert.isNotNull(await panel().findByRole("heading", { name: "¿Desde dónde lo miramos?" }));
    assert.match(panel().getByRole("heading").parentElement?.textContent ?? "", /distancia/u);
    assert.isNotNull(panel().getByRole("button", { name: "Usar mi ubicación" }));
    assert.isNotNull(panel().getByRole("button", { name: "Elegir en el mapa" }));
  });

  it("antes del aviso del navegador explica para qué se usa; solo al continuar se pide", async () => {
    const { panel, pulsar, findByRole, queryByRole, gps, almacen } = await abrir();
    fireEvent.click(await panel().findByRole("button", { name: "Usar mi ubicación" }));
    flush();

    const dialogo = await findByRole("dialog", { name: "Usar tu ubicación" });
    assert.match(dialogo.textContent ?? "", /Se calcula en tu dispositivo/u);
    assert.match(dialogo.textContent ?? "", /no la guarda/u);
    assert.match(dialogo.textContent ?? "", /quitarla cuando quieras/u);
    // Todavía no se ha pedido nada al navegador.
    assert.strictEqual(gps.pedidas(), 0);

    pulsar("Continuar");
    assert.isNull(queryByRole("dialog"));
    await waitFor(() => {
      assert.strictEqual(gps.pedidas(), 1);
    });
    assert.isNotNull(panel().getByText("Buscando tu ubicación…"));

    gps.responder(LECTURA);
    await waitFor(() => {
      assert.match(panel().getByText(/^Desde:/u).textContent ?? "", /tu ubicación \(±25 m\)/u);
    });
    assert.isNotNull(
      panel().getByText("El emplazamiento está a 340 m de ti, hacia el noreste (42°)."),
    );
    // La ubicación GPS no se guarda en el dispositivo.
    assert.deepStrictEqual(almacen.guardadas(), []);
  });

  it("cancelar el paso previo no pide nada", async () => {
    const { panel, pulsar, queryByRole, gps } = await abrir();
    fireEvent.click(await panel().findByRole("button", { name: "Usar mi ubicación" }));
    flush();
    pulsar("Mejor elijo en el mapa");
    assert.isNull(queryByRole("dialog"));
    assert.isNotNull(queryByRole("region", { name: "Elige un punto" }));
    assert.strictEqual(gps.pedidas(), 0);
  });

  it("quitar la ubicación GPS apaga el GPS", async () => {
    const { panel, gps } = await abrir({ permiso: "concedido" });
    fireEvent.click(await panel().findByRole("button", { name: "Usar mi ubicación" }));
    flush();
    // Con el permiso ya dado, el navegador no pregunta: no hace falta el paso previo.
    await waitFor(() => {
      assert.strictEqual(gps.abiertas(), 1);
    });
    gps.responder(LECTURA);
    fireEvent.click(await panel().findByRole("button", { name: "Quitar" }));
    flush();
    await waitFor(() => {
      assert.strictEqual(gps.abiertas(), 0);
    });
    assert.isNotNull(panel().getByRole("heading", { name: "¿Desde dónde lo miramos?" }));
  });
});

describe("punto de referencia: ubicación denegada", () => {
  it("si se deniega, explica cómo reactivarla y ofrece elegir un punto", async () => {
    const { panel, pulsar, getByRole, gps } = await abrir();
    fireEvent.click(await panel().findByRole("button", { name: "Usar mi ubicación" }));
    flush();
    pulsar("Continuar");
    await waitFor(() => {
      assert.strictEqual(gps.abiertas(), 1);
    });
    gps.fallar("denegado");

    await panel().findByText(/Has bloqueado la ubicación para esta web/u);
    assert.match(panel().getByText(/Has bloqueado/u).textContent ?? "", /«Permitir»/u);
    assert.isNull(panel().queryByRole("button", { name: "Usar mi ubicación" }));
    assert.isNotNull(panel().getByRole("button", { name: "Elegir en el mapa" }));

    // En el menú de ubicación, la opción sigue a la vista y dice por qué no se puede.
    pulsar("Ubicación");
    const usar = getByRole("button", { name: "Usar mi ubicación" });
    assert.isTrue(usar.hasAttribute("disabled"));
    assert.match(
      document.getElementById(usar.getAttribute("aria-describedby") ?? "")?.textContent ?? "",
      /Bloqueada en este navegador/u,
    );
  });

  it("si ya estaba bloqueada al abrir, lo dice sin pedir nada", async () => {
    const { panel, gps } = await abrir({ permiso: "denegado" });
    await panel().findByText(/Has bloqueado la ubicación para esta web/u);
    assert.strictEqual(gps.pedidas(), 0);
  });
});

describe("punto de referencia: punto elegido", () => {
  it("el punto guardado se recupera, habla de «el punto» y quitarlo lo borra", async () => {
    const { panel, getByRole, almacen } = await abrir({ guardadas: [PUNTO] });
    await waitFor(() => {
      assert.match(panel().getByText(/^Desde:/u).textContent ?? "", /el punto elegido/u);
    });
    const texto = panel().getByText(/El emplazamiento está a/u).textContent ?? "";
    assert.strictEqual(texto, "El emplazamiento está a 340 m del punto, hacia el noreste (42°).");
    const region = getByRole("region", { name: "Punto de referencia" });
    assert.notMatch(region.textContent ?? "", /\b(ti|tu|tú)\b/iu);

    fireEvent.click(panel().getByRole("button", { name: "Quitar" }));
    flush();
    await waitFor(() => {
      assert.deepStrictEqual(almacen.guardadas(), []);
    });
    assert.isNotNull(panel().getByRole("heading", { name: "¿Desde dónde lo miramos?" }));
  });

  it("buscar una dirección y elegirla la guarda como punto, con su origen", async () => {
    const { panel, findByRole, queryByRole, getByLabelText, almacen, buscador } = await abrir({
      busquedas: new Map([["Sagrada Familia", [SAGRADA_FAMILIA]]]),
    });
    fireEvent.click(await panel().findByRole("button", { name: "Elegir en el mapa" }));
    flush();

    const eleccion = await findByRole("region", { name: "Elige un punto" });
    // Escribir no busca nada: solo se busca al pedirlo.
    fireEvent.input(getByLabelText("Dirección"), { target: { value: "Sagrada Familia" } });
    flush();
    assert.deepStrictEqual(buscador.consultas(), []);
    // El buscador cita el servicio que usa.
    assert.isNotNull(await within(eleccion).findByRole("link", { name: "Buscador de prueba" }));

    fireEvent.click(within(eleccion).getByRole("button", { name: "Buscar" }));
    flush();
    fireEvent.click(await findByRole("button", { name: /Basílica de la Sagrada Familia/u }));
    flush();

    await waitFor(() => {
      assert.lengthOf(almacen.guardadas(), 1);
    });
    const [guardado] = almacen.guardadas();
    assert.strictEqual(guardado?.origen, "busqueda");
    assert.deepStrictEqual(guardado?.posicion, SAGRADA_FAMILIA.posicion);
    assert.deepStrictEqual(buscador.consultas(), ["Sagrada Familia"]);
    // Elegir cierra la elección.
    assert.isNull(queryByRole("region", { name: "Elige un punto" }));
    await waitFor(() => {
      assert.match(panel().getByText(/^Desde:/u).textContent ?? "", /el punto elegido/u);
    });
  });

  it("si el dispositivo no deja guardar el punto, lo dice", async () => {
    const { panel, findByRole, findByText, getByLabelText } = await abrir({
      almacenRoto: true,
      busquedas: new Map([["Sagrada Familia", [SAGRADA_FAMILIA]]]),
    });
    fireEvent.click(await panel().findByRole("button", { name: "Elegir en el mapa" }));
    flush();
    fireEvent.input(getByLabelText("Dirección"), { target: { value: "Sagrada Familia" } });
    flush();
    fireEvent.submit(getByLabelText("Dirección").closest("form") ?? document.body);
    flush();
    fireEvent.click(await findByRole("button", { name: /Basílica de la Sagrada Familia/u }));
    flush();
    const titulo = await findByText("El punto no se ha guardado");
    assert.match(
      titulo.closest("[role=alert]")?.textContent ?? "",
      /mientras no cierres la página/u,
    );
    // El punto se usa igual, aunque no se haya guardado.
    assert.match(panel().getByText(/^Desde:/u).textContent ?? "", /el punto elegido/u);
  });
});
