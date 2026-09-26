import type { CapaLeida } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { capaDePrueba } from "../capa/pruebas.ts";
import { navegar, ruta, ubicacion } from "../lib/rutas.ts";
import { type FichasDePrueba, fichasDePrueba } from "./pruebas.ts";
import { FichaNoLeida } from "./servicio.ts";

const NOCHE = Date.UTC(2026, 8, 26, 0, 15, 3);
const DIA = 86_400_000;

const REGISTRO = "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=";

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
      bandas: [
        {
          referencia: "B B -2300445",
          compania: "movistar",
          rangos: [{ desdeMhz: 778, hastaMhz: 788 }],
          mhz: 700,
          anio: 2023,
        },
        {
          referencia: "B B -2300444",
          compania: "movistar",
          rangos: [{ desdeMhz: 3460, hastaMhz: 3600 }],
          mhz: 3500,
          anio: 2023,
        },
      ],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: `${REGISTRO}0802532`,
          fecha: NOCHE,
          afirma: "presente",
        },
      ],
    },
    {
      compania: "vodafone",
      codigos: ["086040", "86040"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "VODAFONE ESPAÑA, S.A.U. - 086040",
          url: `${REGISTRO}086040`,
          fecha: NOCHE,
          afirma: "presente",
        },
      ],
    },
  ],
  datosDel: NOCHE,
  version: NOCHE + 420,
};

const PEDRALBES: Ficha = {
  ...CAMPUS_NORD,
  clave: "orange-CATR0228A",
  posicion: { longitud: 2.1128, latitud: 41.3903 },
  direccion: "PZ EUSEBI GÜELL, 1. BARCELONA, BARCELONA",
  estaciones: [
    {
      compania: "orange",
      codigos: ["CATR0228A"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "ORANGE ESPAGNE, S.A.U. - CATR0228A",
          url: `${REGISTRO}CATR0228A`,
          fecha: NOCHE,
          afirma: "presente",
        },
      ],
    },
  ],
};

const CAPA: CapaLeida = {
  version: "sitios@2026-09-26T00:15:03Z",
  fecha: NOCHE,
  emplazamientos: [
    {
      clave: CAMPUS_NORD.clave,
      posicion: CAMPUS_NORD.posicion,
      estado: "verificado",
      companias: ["movistar", "vodafone"],
    },
    {
      clave: PEDRALBES.clave,
      posicion: PEDRALBES.posicion,
      estado: "verificado",
      companias: ["orange"],
    },
  ],
};

/** La app con la capa de prueba y las fichas en manos de la prueba, abierta en `clave`. */
const abrir = (clave: string) => {
  const fichas: FichasDePrueba = fichasDePrueba();
  navegar(ruta.emplazamiento(clave), { reemplazar: true });
  const pantalla = render(() => (
    <App servicios={Layer.merge(capaDePrueba([Effect.succeed(CAPA)]), fichas.capa)} />
  ));
  flush();
  return { ...pantalla, fichas };
};

/**
 * Responde en cuanto la lectura de `clave` esté abierta: el runtime de los servicios se monta
 * después de pintar, y una respuesta sin lectura abierta no llega a nadie.
 */
const responder = async (
  fichas: FichasDePrueba,
  clave: string,
  respuesta: Parameters<FichasDePrueba["responder"]>[1],
) => {
  await waitFor(() => {
    assert.include(fichas.abiertas(), clave);
  });
  fichas.responder(clave, respuesta);
};

/**
 * Apunta el texto del panel en cada cambio del DOM, para comprobar que ningún estado intermedio
 * ha enseñado algo, aunque durase un instante.
 */
const grabarPanel = () => {
  const estados: Array<string> = [];
  const observador = new MutationObserver(() => {
    const panel = document.querySelector("[aria-label='Ficha del emplazamiento']");
    estados.push(panel?.textContent ?? "");
  });
  observador.observe(document.body, { childList: true, subtree: true, characterData: true });
  return {
    estados: () => {
      observador.disconnect();
      return estados;
    },
  };
};

const TITULO_CAMPUS_NORD = "CL JORDI GIRONA, 1";
const TITULO_PEDRALBES = "PZ EUSEBI GÜELL, 1";

describe("panel del emplazamiento", () => {
  it("enseña la dirección, cada compañía con sus bandas y de dónde sale cada dato", async () => {
    const { findByRole, getByRole, getByText, getAllByRole, fichas } = abrir(CAMPUS_NORD.clave);
    await responder(fichas, CAMPUS_NORD.clave, CAMPUS_NORD);

    const titulo = await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    assert.isNotNull(titulo);
    assert.isNotNull(getByText("BARCELONA"));
    assert.isNotNull(getByText("Emplazamiento compartido"));
    assert.isNotNull(getByRole("heading", { name: "Movistar" }));
    assert.deepStrictEqual(
      Array.from(getByRole("list", { name: "Bandas de Movistar" }).children, (b) => b.textContent),
      ["700 MHz", "3500 MHz"],
    );
    // Sin bandas leídas lo dice, en lugar de dejar el hueco.
    assert.isNotNull(getByText(/aún no ha leído sus bandas/u));
    assert.isNotNull(getByText("Códigos 086040 y 86040"));

    const enlaces = getAllByRole("link", { name: /Ver en el registro oficial/u });
    assert.deepStrictEqual(
      enlaces.map((a) => a.getAttribute("href")),
      [`${REGISTRO}0802532`, `${REGISTRO}086040`],
    );
    assert.lengthOf(
      getAllByRole("listitem").filter((li) =>
        /, desde el 26 sept 2026/u.test(li.textContent ?? ""),
      ),
      2,
    );
  });

  it("al cambiar de emplazamiento con la respuesta lenta, nunca enseña el anterior", async () => {
    const { findByRole, queryByText, getByText, fichas } = abrir(CAMPUS_NORD.clave);
    await responder(fichas, CAMPUS_NORD.clave, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });

    const grabacion = grabarPanel();
    navegar(ruta.emplazamiento(PEDRALBES.clave));
    flush();
    // La ficha anterior desaparece en el acto y su lectura se libera.
    assert.isNull(queryByText(TITULO_CAMPUS_NORD));
    assert.isNull(queryByText(/Movistar/u));
    assert.isNotNull(getByText("Cargando la ficha…"));
    await waitFor(() => {
      assert.deepStrictEqual(fichas.abiertas(), [PEDRALBES.clave]);
    });

    await responder(fichas, PEDRALBES.clave, PEDRALBES);
    await findByRole("heading", { name: TITULO_PEDRALBES });
    assert.isNull(queryByText(TITULO_CAMPUS_NORD));
    assert.isFalse(grabacion.estados().some((texto) => texto.includes(TITULO_CAMPUS_NORD)));
  });

  it("una respuesta del anterior que llega después no se enseña bajo el nuevo", async () => {
    const { findByRole, findByText, queryByText, fichas } = abrir(CAMPUS_NORD.clave);
    await waitFor(() => {
      assert.deepStrictEqual(fichas.abiertas(), [CAMPUS_NORD.clave]);
    });
    // Se cambia antes de que llegue la primera: su lectura se cierra.
    const grabacion = grabarPanel();
    navegar(ruta.emplazamiento(PEDRALBES.clave));
    flush();
    await waitFor(() => {
      assert.deepStrictEqual(fichas.abiertas(), [PEDRALBES.clave]);
    });
    // La respuesta de la primera llega tarde, antes que la de la segunda.
    fichas.responder(CAMPUS_NORD.clave, CAMPUS_NORD);
    fichas.responder(PEDRALBES.clave, PEDRALBES);
    await findByRole("heading", { name: TITULO_PEDRALBES });
    // Y otra más tardía, con la segunda ya a la vista, seguida de un cambio de la segunda.
    fichas.responder(CAMPUS_NORD.clave, CAMPUS_NORD);
    fichas.responder(PEDRALBES.clave, { ...PEDRALBES, estado: "nuevo" });
    await findByText("Nuevo");

    assert.isNull(queryByText(TITULO_CAMPUS_NORD));
    const estados = grabacion.estados();
    assert.isNotEmpty(estados);
    assert.isFalse(
      estados.some((texto) => texto.includes(TITULO_CAMPUS_NORD)),
      "algún estado del panel ha enseñado la ficha anterior",
    );
  });

  it("en vivo: si la ficha cambia mientras se ve, se actualiza", async () => {
    const { findByText, findByRole, fichas } = abrir(CAMPUS_NORD.clave);
    await responder(fichas, CAMPUS_NORD.clave, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    await responder(fichas, CAMPUS_NORD.clave, { ...CAMPUS_NORD, estado: "corregido" });
    const etiqueta = await findByText("Corregido");
    assert.strictEqual(etiqueta.closest("[data-tono]")?.getAttribute("data-tono"), "corregido");
  });

  it("si la ficha es más reciente que el mapa, lo dice; si no, da su fecha", async () => {
    const { findByText, findByRole, queryByText, fichas } = abrir(CAMPUS_NORD.clave);
    // Misma ejecución que la capa: la ficha va al milisegundo y la capa al segundo.
    await responder(fichas, CAMPUS_NORD.clave, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    assert.isNotNull(await findByText("Datos de la ficha: 26 sept 2026"));
    assert.isNull(queryByText(/Actualizado después del mapa/u));

    await responder(fichas, CAMPUS_NORD.clave, { ...CAMPUS_NORD, version: NOCHE + DIA });
    const aviso = await findByText("Actualizado después del mapa");
    const marca = aviso.closest("[data-tono]");
    assert.strictEqual(marca?.getAttribute("data-tono"), "posterior");
    assert.match(marca?.textContent ?? "", /es del 27 sept 2026 y el mapa, del 26 sept 2026/u);
  });

  it("un emplazamiento que no existe lo dice, y volver al mapa cierra el panel", async () => {
    const { findByText, getByRole, queryByLabelText, fichas } = abrir("movistar-no-existe");
    await responder(fichas, "movistar-no-existe", "no-existe");
    assert.isNotNull(await findByText("Este emplazamiento no existe"));
    const mapa = getByRole("main");

    fireEvent.click(getByRole("button", { name: "Volver al mapa" }));
    flush();
    assert.strictEqual(ubicacion().search.toString(), "");
    assert.isNull(queryByLabelText("Ficha del emplazamiento"));
    // Cerrar no rehace la pantalla del mapa: conserva su posición y su zoom.
    assert.strictEqual(getByRole("main"), mapa);
  });

  it("si la ficha no llega, lo dice con un reintento que vuelve a leerla", async () => {
    const { findByText, findByRole, getByRole, fichas } = abrir(CAMPUS_NORD.clave);
    await responder(fichas, CAMPUS_NORD.clave, new FichaNoLeida({ motivo: "sin conexión" }));
    assert.isNotNull(await findByText("No se ha podido leer la ficha"));

    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    flush();
    await waitFor(() => {
      assert.deepStrictEqual(fichas.abiertas(), [CAMPUS_NORD.clave]);
    });
    await responder(fichas, CAMPUS_NORD.clave, CAMPUS_NORD);
    assert.isNotNull(await findByRole("heading", { name: TITULO_CAMPUS_NORD }));
  });

  it("la dirección con el emplazamiento se puede compartir: al cargarla abre su ficha", () => {
    const { getByLabelText } = abrir(CAMPUS_NORD.clave);
    assert.isNotNull(getByLabelText("Ficha del emplazamiento"));
    assert.strictEqual(ubicacion().search.get("emplazamiento"), CAMPUS_NORD.clave);
  });
});
