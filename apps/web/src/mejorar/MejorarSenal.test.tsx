import type { PuntoElegido } from "@celda/dominio/aportacion";
import { rumboGrados } from "@celda/dominio/area";
import type { Ficha } from "@celda/dominio/ficha";
import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { type CapaDePrueba, capaDePrueba, FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import { type OpcionesDeUbicacion, ubicacionDePrueba } from "../ubicacion/pruebas.ts";

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
      bandasSinLeer: true,
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802532",
          fecha: NOCHE,
          afirma: "presente",
          historial: [],
        },
      ],
    },
  ],
  datosDel: NOCHE,
  version: NOCHE,
};

const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-26T00:15:03Z",
  fecha: NOCHE,
  emplazamientos: [
    {
      clave: CAMPUS_NORD.clave,
      posicion: CAMPUS_NORD.posicion,
      estado: "verificado",
      companias: ["movistar"],
      barrio: null,
    },
  ],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

// Unos 340 m al suroeste del emplazamiento.
const CERCA = { longitud: 2.1109, latitud: 41.3861 };

/** El rumbo del punto al emplazamiento, en grados enteros: hacia donde se apunta. */
const OBJETIVO = Math.round(rumboGrados(CERCA, CAMPUS_NORD.posicion));

const PUNTO: PuntoElegido = {
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f",
  tipo: "punto-elegido",
  esquema: 1,
  creada: NOCHE,
  origen: "mapa",
  posicion: CERCA,
};

/** La app con la ficha de Campus Nord abierta y ya leída. */
const abrir = async (opciones: OpcionesDeUbicacion = {}) => {
  const fichas = fichasDePrueba();
  const ubicacion = ubicacionDePrueba(opciones);
  navegar(ruta.emplazamiento(CAMPUS_NORD.clave, "08"), { reemplazar: true });
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.succeed(CAPA)]),
        fichas.capa,
        simuladorDePrueba,
        ubicacion.capa,
      )}
    />
  ));
  flush();
  await waitFor(() => {
    assert.include(fichas.abiertas(), CAMPUS_NORD.clave);
  });
  fichas.responder(CAMPUS_NORD.clave, CAMPUS_NORD);
  const titulo = await pantalla.findByRole("heading", { name: "Mejorar la señal" });
  const seccion = () => within(titulo.closest("section") ?? document.body);
  const pulsar = (nombre: string) => {
    fireEvent.click(seccion().getByRole("button", { name: nombre }));
    flush();
  };
  return { ...pantalla, ...ubicacion, seccion, pulsar };
};

/** Lo que dice la brújula que hay que hacer: el aviso que se lee en voz alta al cambiar. */
const guia = (seccion: ReturnType<typeof within>) =>
  seccion
    .getAllByRole("status")
    .find((salida: HTMLElement) => salida.getAttribute("aria-live") === "polite")?.textContent ??
  "";

describe("mejorar la señal: consejos", () => {
  it("sin punto de referencia da consejos generales y lleva a elegir uno", async () => {
    const { seccion, pulsar, findByRole } = await abrir();
    assert.match(seccion().getByRole("list").textContent ?? "", /router 4G\/5G/u);
    assert.match(
      seccion().getByRole("list").textContent ?? "",
      /Girar el móvil en la mano apenas cambia la señal/u,
    );
    assert.match(
      seccion()
        .getByText(/Con un/u)
        .closest("p")?.textContent ?? "",
      /hacia qué ventana poner el router/u,
    );
    // Sin punto no hay brújula: no hay hacia dónde apuntar.
    assert.isNull(seccion().queryByRole("img", { name: /Brújula/u }));
    pulsar("Elegir en el mapa");
    assert.isNotNull(await findByRole("region", { name: "Elige un punto" }));
  });

  it("con un punto dice hacia qué ventana poner el router y a qué rumbo apuntar la antena", async () => {
    const { seccion } = await abrir({ guardadas: [PUNTO] });
    await waitFor(() => {
      assert.match(
        seccion().getByRole("list").textContent ?? "",
        /junto a una ventana que dé al noreste/u,
      );
    });
    assert.match(
      seccion().getByRole("list").textContent ?? "",
      new RegExp(`apúntala a ${OBJETIVO}°`, "u"),
    );
    // Con un punto elegido, los textos hablan del punto.
    assert.match(
      seccion().getByText(/^Desde el punto/u).textContent ?? "",
      /queda hacia el noreste/u,
    );
    assert.isNotNull(
      seccion().getByText(
        "Toma el rumbo como punto de partida y ajusta mirando la señal del router.",
      ),
    );
  });
});

describe("mejorar la señal: brújula", () => {
  it("en un ordenador simula el giro con una barra y lo dice, sin pedir nada", async () => {
    const { seccion, brujula } = await abrir({ guardadas: [PUNTO] });
    const barra = await seccion().findByRole("slider", { name: "Simular el giro" });
    assert.isNotNull(seccion().getByText("Giro simulado"));
    assert.match(seccion().getByText(/Un ordenador no tiene brújula/u).textContent ?? "", /barra/u);
    assert.isNull(seccion().queryByRole("button", { name: "Usar la brújula del móvil" }));
    const dibujo = seccion().getByRole("img", { name: "Brújula simulada con la barra" });
    assert.strictEqual(dibujo.closest("[data-fuente]")?.getAttribute("data-fuente"), "barra");

    // Con la barra al norte, hay que girar hacia el emplazamiento, y el rumbo va en texto.
    assert.strictEqual(guia(seccion()), `Gira ${OBJETIVO}° a la derecha`);
    assert.isNotNull(seccion().getByText("Móvil: 0° (norte)"));
    assert.isNotNull(seccion().getByText(`Emplazamiento: ${OBJETIVO}° (noreste)`));

    fireEvent.input(barra, { target: { value: String(OBJETIVO) } });
    flush();
    assert.strictEqual(guia(seccion()), "Apuntando al emplazamiento");
    assert.strictEqual(barra.getAttribute("aria-valuetext"), `${OBJETIVO}°`);

    fireEvent.input(barra, { target: { value: "300" } });
    flush();
    assert.match(guia(seccion()), /a la derecha$/u);
    assert.strictEqual(brujula.permisosPedidos(), 0);
    assert.strictEqual(brujula.abiertas(), 0);
  });

  it("con el emplazamiento justo al norte (rumbo 0°) también sale la brújula", async () => {
    const alSur = { longitud: CAMPUS_NORD.posicion.longitud, latitud: CERCA.latitud };
    const { seccion } = await abrir({ guardadas: [{ ...PUNTO, posicion: alSur }] });
    await seccion().findByRole("slider", { name: "Simular el giro" });
    assert.isNotNull(seccion().getByText("Emplazamiento: 0° (norte)"));
  });

  it("en el iPhone explica antes de pedir permiso y, si se deniega, lo dice y deja la barra", async () => {
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "con-permiso", permiso: "denegado" },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    assert.match(
      seccion().getByText("Antes de usar la brújula").parentElement?.textContent ?? "",
      /Celda solo usa la orientación del móvil para girar la flecha, y no la guarda\./u,
    );
    // Todavía no se ha pedido nada al navegador.
    assert.strictEqual(brujula.permisosPedidos(), 0);

    pulsar("Continuar");
    await waitFor(() => {
      assert.isNotNull(seccion().getByText("Sin permiso para la brújula"));
    });
    assert.strictEqual(brujula.permisosPedidos(), 1);
    assert.strictEqual(brujula.abiertas(), 0);
    // Sin brújula de verdad, la flecha sigue a la barra y se puede volver a probar.
    assert.isNotNull(seccion().getByRole("slider", { name: "Simular el giro" }));
    assert.isNotNull(seccion().getByRole("img", { name: "Brújula simulada con la barra" }));
    assert.isNotNull(seccion().getByRole("button", { name: "Probar otra vez" }));
  });

  it("cancelar la explicación no pide nada", async () => {
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "con-permiso" },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    pulsar("Ahora no");
    assert.isNotNull(seccion().getByRole("button", { name: "Usar la brújula del móvil" }));
    assert.strictEqual(brujula.permisosPedidos(), 0);
  });

  it("en Android la flecha sigue a la brújula del móvil y se puede dejar", async () => {
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "sin-permiso" },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    await waitFor(() => {
      assert.strictEqual(brujula.abiertas(), 1);
    });
    // Sin aviso del navegador no hace falta explicar nada.
    assert.strictEqual(brujula.permisosPedidos(), 0);
    assert.isNotNull(seccion().getByText("Esperando a la brújula…"));

    brujula.responder({ rumbo: OBJETIVO + 3, margen: undefined });
    await waitFor(() => {
      assert.strictEqual(guia(seccion()), "Apuntando al emplazamiento");
    });
    assert.isNotNull(seccion().getByText("Brújula del móvil"));
    assert.isNotNull(seccion().getByRole("img", { name: "Brújula" }));
    // Con la brújula de verdad no hay barra.
    assert.isNull(seccion().queryByRole("slider"));

    pulsar("Dejar la brújula");
    await waitFor(() => {
      assert.strictEqual(brujula.abiertas(), 0);
    });
    assert.isNotNull(seccion().getByRole("slider", { name: "Simular el giro" }));
  });

  it("cada lectura de la brújula mueve la flecha sin volver a empezar a escuchar", async () => {
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "sin-permiso" },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    await waitFor(() => {
      assert.strictEqual(brujula.abiertas(), 1);
    });
    for (const giro of [40, 3, -2]) {
      brujula.responder({ rumbo: OBJETIVO + giro, margen: undefined });
      flush();
    }
    await waitFor(() => {
      assert.strictEqual(guia(seccion()), "Apuntando al emplazamiento");
    });
    assert.strictEqual(brujula.escuchas(), 1);
    assert.strictEqual(brujula.abiertas(), 1);
  });

  it("con el móvil ya apuntando, lee al empezar y no vuelve a empezar a escuchar", async () => {
    // El navegador lanza `deviceorientation` en cuanto se añade el escuchador.
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "sin-permiso", rumbo: { rumbo: OBJETIVO, margen: undefined } },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    await waitFor(() => {
      assert.strictEqual(guia(seccion()), "Apuntando al emplazamiento");
    });
    brujula.responder({ rumbo: OBJETIVO + 2, margen: undefined });
    flush();
    await waitFor(() => {
      assert.strictEqual(brujula.abiertas(), 1);
    });
    assert.strictEqual(brujula.escuchas(), 1);
  });

  it("si el móvil no da ninguna lectura, dice que no hay brújula", async () => {
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "sin-permiso" },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    await waitFor(() => {
      assert.strictEqual(brujula.abiertas(), 1);
    });
    brujula.sinLecturas();
    await waitFor(() => {
      assert.isNotNull(seccion().getByText("No llegan datos de la brújula"));
    });
    assert.isNotNull(seccion().getByRole("slider", { name: "Simular el giro" }));
  });

  it("con una calibración dudosa lo dice", async () => {
    const { seccion, pulsar, brujula } = await abrir({
      guardadas: [PUNTO],
      brujula: { disponibilidad: "sin-permiso" },
    });
    await seccion().findByRole("button", { name: "Usar la brújula del móvil" });
    pulsar("Usar la brújula del móvil");
    await waitFor(() => {
      assert.strictEqual(brujula.abiertas(), 1);
    });
    brujula.responder({ rumbo: 10, margen: 45 });
    await waitFor(() => {
      assert.isNotNull(seccion().getByText("La brújula puede estar mal calibrada"));
    });
  });
});
