import { versionDeCapa } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import {
  indexarMunicipios,
  type LimitesDeMunicipios,
  lugarDelPunto,
} from "@celda/dominio/municipio";
import { generarLoteDeProvincia } from "@celda/dominio/provincias";
import { simuladorDePrueba, workerDePrueba } from "@celda/sim/pruebas";
import { type Simulador, simuladorEnWorker } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import {
  type CapaDePrueba,
  capaDePrueba,
  FUENTE_DE_BARRIOS,
  provinciaDePrueba,
  publicacionDePrueba,
} from "../capa/pruebas.ts";
import { estaEnElGlosario, terminosSubrayados, textoEntero } from "../lib/pruebas.ts";
import { navegar, ruta, ubicacion } from "../lib/rutas.ts";
import { loteConFichas, type OrigenDePrueba, origenDePrueba } from "./pruebas.ts";
import { fichasDelOrigen } from "./servicio.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";

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

const ORIGEN = "http://capas.prueba";

/** La capa del mapa: cada emplazamiento en su lote, para ver las peticiones por separado. */
const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-26T00:15:03Z",
  fecha: NOCHE,
  emplazamientos: [
    {
      clave: CAMPUS_NORD.clave,
      posicion: CAMPUS_NORD.posicion,
      estado: "verificado",
      companias: ["movistar", "vodafone"],
      barrio: null,
      lote: 0,
    },
    {
      clave: PEDRALBES.clave,
      posicion: PEDRALBES.posicion,
      estado: "verificado",
      companias: ["orange"],
      barrio: null,
      lote: 1,
    },
  ],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

/** El lote de la capa del mapa en el que va cada ficha. */
const LOTE = new Map([
  [CAMPUS_NORD.clave, 0],
  [PEDRALBES.clave, 1],
]);

const urlDelLote = (clave: string) =>
  `${ORIGEN}/${provinciaDePrueba(CAPA).capa.lotes[LOTE.get(clave) ?? -1] ?? ""}`;

/**
 * La app con la capa de prueba y las fichas del servicio real, sobre un origen estático que no
 * contesta hasta que la prueba lo pide, abierta en `clave`. Las simulaciones se calculan en el
 * mismo hilo, salvo que la prueba traiga su simulador.
 */
const abrir = (clave: string, simulador: Layer.Layer<Simulador> = simuladorDePrueba) => {
  const origen = origenDePrueba();
  navegar(ruta.emplazamiento(clave, "08"), { reemplazar: true });
  // Sin esperar, la app leería la dirección de la prueba anterior y pediría su ficha.
  flush();
  const pantalla = render(() => (
    <App
      servicios={Layer.mergeAll(
        fichasDelOrigen.pipe(
          Layer.provideMerge(capaDePrueba([Effect.succeed(CAPA)])),
          Layer.provide(origen.capa),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_CAPAS_ORIGEN: ORIGEN })),
          ),
        ),
        simulador,
        ubicacionDePrueba().capa,
      )}
    />
  ));
  flush();
  return { ...pantalla, origen };
};

/**
 * Contesta a la petición de `url` en cuanto esté abierta: el runtime de los servicios se monta
 * después de pintar, y una respuesta sin petición abierta no llega a nadie.
 */
const contestar = async (origen: OrigenDePrueba, url: string, estado: number, cuerpo: string) => {
  await waitFor(() => {
    assert.include(origen.abiertas(), url);
  });
  origen.responder(url, { estado, cuerpo });
};

/** Contesta a la petición del lote de `ficha` con su ficha, como lo publica Celda. */
const responder = (origen: OrigenDePrueba, ficha: Ficha) => {
  const { estado, cuerpo } = loteConFichas([ficha]);
  return contestar(origen, urlDelLote(ficha.clave), estado, cuerpo);
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

/** Un municipio de Barcelona cuadrado alrededor de la muestra, como lo guarda el IGN en arcos. */
const MUNICIPIOS: LimitesDeMunicipios = {
  fuente: {
    atribucion: "Instituto Geográfico Nacional",
    producto: "Base de Datos de Límites Jurisdiccionales de España",
    licencia: "CC BY 4.0",
    enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
    fecha: "2026-08-10",
    huella: "sha256:prueba",
  },
  toleranciaMetros: 50,
  unidadesPorGrado: 100,
  provincias: [{ codigo: "08", nombre: "Barcelona", etiqueta: { longitud: 2.1, latitud: 41.4 } }],
  territorios: [
    {
      codigo: "08019",
      tipo: "municipio",
      nombre: "Barcelona",
      provincia: "08",
      etiqueta: { longitud: 2.1, latitud: 41.4 },
      areaKm2: 101,
      poligonos: [[[0]]],
    },
  ],
  arcos: [[200, 4100, 100, 0, 0, 100, -100, 0, 0, -100]],
};

const TITULO_CAMPUS_NORD = "CL JORDI GIRONA, 1";
const TITULO_PEDRALBES = "PZ EUSEBI GÜELL, 1";

describe("panel del emplazamiento", () => {
  it("enseña la dirección, cada compañía con sus bandas y de dónde sale cada dato", async () => {
    const { findByRole, getByRole, getByText, getAllByText, getAllByRole, origen } = abrir(
      CAMPUS_NORD.clave,
    );
    await responder(origen, CAMPUS_NORD);

    const titulo = await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    assert.isNotNull(titulo);
    assert.isNotNull(getByText("BARCELONA"));
    assert.isNotNull(getByText(textoEntero("Emplazamiento compartido")));
    assert.isNotNull(getByRole("heading", { name: "Movistar" }));
    // Los códigos salen también en los datos técnicos, plegados.
    assert.lengthOf(getAllByText("Códigos 086040 y 86040"), 2);

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

  it("dice el municipio y la provincia del IGN y lo cita como obra derivada", async () => {
    const { findByRole, getByText, origen } = abrir(CAMPUS_NORD.clave);
    const lote = generarLoteDeProvincia(
      "08",
      [CAMPUS_NORD],
      new Map([
        [CAMPUS_NORD.clave, lugarDelPunto(CAMPUS_NORD.posicion, indexarMunicipios(MUNICIPIOS))],
      ]),
      MUNICIPIOS.fuente,
    );
    await contestar(origen, urlDelLote(CAMPUS_NORD.clave), 200, lote);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });

    assert.isNotNull(getByText("Barcelona, provincia de Barcelona"));
    assert.isNotNull(
      getByText(
        "Municipio y provincia: obra derivada de Base de Datos de Límites Jurisdiccionales de " +
          "España 10 ago 2026, CC BY 4.0, Instituto Geográfico Nacional (ign.es).",
      ),
    );
  });

  it("abre con una frase llana, el eje de frecuencias y los datos técnicos plegados", async () => {
    const { findByRole, getByRole, getByText, queryByRole, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });

    // La tecnología no la publica nadie: se deduce de la banda y se dice «probablemente».
    assert.isNotNull(
      getByText(
        textoEntero(
          "Movistar y Vodafone comparten este emplazamiento. Por las bandas que se conocen, " +
            "probablemente da 5G con Movistar. Llega lejos y entra bien en los edificios, y tiene " +
            "bandas altas que dan más velocidad. De Vodafone aún no se conocen las bandas.",
        ),
      ),
    );

    const eje = getByRole("table", { name: "Qué frecuencia usa cada compañía (MHz)" });
    const movistar = getByRole("row", { name: /^Movistar/u });
    assert.isTrue(eje.contains(movistar));
    assert.deepStrictEqual(
      Array.from(movistar.querySelectorAll("[data-emite]"), (c) => c.getAttribute("data-emite")),
      ["si", "no", "no", "no", "no", "no", "si"],
    );
    assert.include(getByRole("row", { name: /^Vodafone/u }).textContent, "Aún no se conocen");

    // Plegados: los expedientes no se ven hasta abrirlos.
    const tecnicos = getByRole("button", { name: "Datos técnicos" });
    assert.strictEqual(tecnicos.getAttribute("aria-expanded"), "false");
    assert.isNull(queryByRole("table", { name: "Expedientes de Movistar" }));
    fireEvent.click(tecnicos);
    flush();
    const expedientes = getByRole("table", { name: "Expedientes de Movistar" });
    assert.include(expedientes.textContent, "B B -2300445");
    assert.include(expedientes.textContent, "3460–3600 MHz");
    assert.isNotNull(getByText(/no publica la tecnología/u));
  });

  it("en un emplazamiento compartido, dice que el registro no tiene ficha solo de la compañía afectada, con la fecha", async () => {
    const sinFicha: Ficha = {
      ...CAMPUS_NORD,
      estaciones: CAMPUS_NORD.estaciones.map((e) =>
        e.compania === "vodafone" ? { ...e, sinFichaEnRegistro: NOCHE + DIA } : e,
      ),
    };
    const { findByRole, getByRole, getByText, getAllByRole, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, sinFicha);
    const ficha = await findByRole("article", { name: TITULO_CAMPUS_NORD });

    assert.isNotNull(
      getByText(
        textoEntero(
          "Movistar y Vodafone comparten este emplazamiento. Por las bandas que se conocen, " +
            "probablemente da 5G con Movistar. Llega lejos y entra bien en los edificios, y tiene " +
            "bandas altas que dan más velocidad. El registro no tiene ficha de Vodafone para " +
            "este emplazamiento (comprobado el 27 sept 2026).",
        ),
      ),
    );
    // No la da por pendiente en ninguna parte.
    assert.notMatch(ficha.textContent ?? "", /aún no se conocen|aún no ha leído/iu);
    assert.include(
      getByRole("row", { name: /^Vodafone/u }).textContent,
      "El registro no tiene ficha para este emplazamiento",
    );
    assert.notInclude(getByRole("row", { name: /^Movistar/u }).textContent, "no tiene ficha");

    // Los datos del listado siguen ahí: la dirección, la compañía, el código y el enlace.
    assert.isNotNull(getByRole("heading", { name: "Vodafone" }));
    assert.deepStrictEqual(
      getAllByRole("link", { name: /Ver en el registro oficial/u }).map((a) =>
        a.getAttribute("href"),
      ),
      [`${REGISTRO}0802532`, `${REGISTRO}086040`],
    );
    fireEvent.click(getByRole("button", { name: "Datos técnicos" }));
    flush();
    assert.isNotNull(
      getByText(
        "El registro no tiene ficha para este emplazamiento (comprobado el 27 sept 2026), así " +
          "que no se conocen sus bandas.",
      ),
    );
    assert.isNotNull(getByRole("table", { name: "Expedientes de Movistar" }));
  });

  it("con una sola compañía, dice que el registro no tiene ficha para el emplazamiento", async () => {
    const sinFicha: Ficha = {
      ...PEDRALBES,
      estaciones: PEDRALBES.estaciones.map((e) => ({ ...e, sinFichaEnRegistro: NOCHE })),
    };
    const { findByRole, getByRole, getByText, origen } = abrir(PEDRALBES.clave);
    await responder(origen, sinFicha);
    const ficha = await findByRole("article", { name: TITULO_PEDRALBES });
    assert.isNotNull(
      getByText(
        textoEntero(
          "Aquí emite Orange. El registro no tiene ficha para este emplazamiento (comprobado " +
            "el 26 sept 2026). Sin sus bandas no se sabe si da 4G o 5G ni si llega lejos o da " +
            "velocidad.",
        ),
      ),
    );
    assert.notMatch(ficha.textContent ?? "", /aún no se conocen|aún no ha leído/iu);
    assert.include(
      getByRole("row", { name: /^Orange/u }).textContent,
      "El registro no tiene ficha para este emplazamiento",
    );
  });

  it("dibuja cómo emite: un diagrama de modelo, con su versión y la orientación supuesta", async () => {
    const { findByRole, getByText, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, CAMPUS_NORD);
    const diagrama = await findByRole("img", { name: "Diagrama de radiación de los sectores" });
    await waitFor(() => {
      assert.lengthOf(diagrama.querySelectorAll("path"), 3);
    });
    assert.include(diagrama.querySelector("desc")?.textContent, "orientación supuesta");
    assert.isNotNull(getByText("Modelo"));
    assert.isNotNull(getByText("diagrama-sector v1"));
    assert.isNotNull(getByText("Sector 2 · 120°"));
    // «Orientación» va subrayada: el párrafo se busca entero.
    const nota = Array.from(diagrama.closest("figure")?.querySelectorAll("p") ?? []).find((p) =>
      (p.textContent ?? "").startsWith("Orientación supuesta. Ninguna fuente publica"),
    );
    assert.isDefined(nota);
    assert.deepStrictEqual(terminosSubrayados(nota ?? diagrama), ["azimut", "sector"]);
  });

  it("al cambiar de emplazamiento a medio calcular, cancela el diagrama anterior", async () => {
    const worker = workerDePrueba();
    const { findByRole, getByText, origen } = abrir(
      CAMPUS_NORD.clave,
      simuladorEnWorker(worker.crear),
    );
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    await waitFor(() => {
      assert.lengthOf(worker.pendientes(), 1);
    });
    // El marco ya ocupa su sitio mientras el Worker calcula.
    const antes = getByText("Calculando el modelo…").closest("svg");
    assert.lengthOf(antes?.querySelectorAll("path") ?? [], 0);

    // Se cancela en cuanto cambia, sin esperar a la ficha nueva.
    navegar(ruta.emplazamiento(PEDRALBES.clave, "08"));
    flush();
    await waitFor(() => {
      assert.strictEqual(worker.terminados(), 1);
    });
    await responder(origen, PEDRALBES);
    await findByRole("heading", { name: TITULO_PEDRALBES });
    await waitFor(() => {
      assert.lengthOf(worker.pendientes(), 1);
    });
    worker.contestar();
    const diagrama = await findByRole("img", { name: "Diagrama de radiación de los sectores" });
    await waitFor(() => {
      assert.lengthOf(diagrama.querySelectorAll("path"), 3);
    });
    assert.strictEqual(worker.creados(), 2);
  });

  it("los términos técnicos salen subrayados una vez por bloque, y todos están en el glosario", async () => {
    const { findByRole, getByRole, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    fireEvent.click(getByRole("button", { name: "Datos técnicos" }));
    flush();

    const ficha = getByRole("article", { name: TITULO_CAMPUS_NORD });
    const todos = terminosSubrayados(ficha);
    for (const termino of todos) assert.isTrue(estaEnElGlosario(termino), termino);
    assert.includeMembers(
      [...todos],
      [
        "emplazamiento",
        "banda",
        "5g",
        "version-de-los-datos",
        "mhz",
        "registro-oficial",
        "expediente",
        "tramo",
        "tecnologia",
        "azimut",
        "identificador-de-celda",
      ],
    );
    // Cada bloque de la ficha (cabecera, frase, marca de agua, secciones y datos técnicos)
    // subraya un término solo la primera vez.
    for (const bloque of Array.from(ficha.children)) {
      const deBloque = terminosSubrayados(bloque);
      assert.strictEqual(new Set(deBloque).size, deBloque.length, deBloque.join(", "));
    }
  });

  it("un término se abre en el panel y Escape lo cierra sin cerrar el panel", async () => {
    const { findByRole, getByRole, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });

    const termino = getByRole("button", { name: "bandas" });
    termino.focus();
    fireEvent.click(termino);
    flush();
    const explicacion = screen.getByRole("dialog", { name: "Banda" });
    assert.match(explicacion.textContent ?? "", /Término técnico: banda de frecuencias/u);

    fireEvent.keyDown(document.activeElement ?? explicacion, { key: "Escape" });
    flush();
    assert.isNull(screen.queryByRole("dialog"));
    assert.strictEqual(document.activeElement, termino);
    assert.isNotNull(getByRole("heading", { name: TITULO_CAMPUS_NORD }));
  });

  it("al cambiar de emplazamiento con la respuesta lenta, nunca enseña el anterior", async () => {
    const { findByRole, queryByText, getByText, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });

    const grabacion = grabarPanel();
    navegar(ruta.emplazamiento(PEDRALBES.clave, "08"));
    flush();
    // La ficha anterior desaparece en el acto, con su espacio reservado mientras llega la nueva.
    assert.isNull(queryByText(TITULO_CAMPUS_NORD));
    assert.isNull(queryByText(/Movistar/u));
    assert.isNotNull(getByText("Cargando la ficha…"));
    await waitFor(() => {
      assert.deepStrictEqual(origen.abiertas(), [urlDelLote(PEDRALBES.clave)]);
    });

    await responder(origen, PEDRALBES);
    await findByRole("heading", { name: TITULO_PEDRALBES });
    assert.isNull(queryByText(TITULO_CAMPUS_NORD));
    assert.isFalse(grabacion.estados().some((texto) => texto.includes(TITULO_CAMPUS_NORD)));
  });

  it("una respuesta del anterior que llega después no se enseña bajo el nuevo", async () => {
    const { findByRole, queryByText, origen } = abrir(CAMPUS_NORD.clave);
    await waitFor(() => {
      assert.deepStrictEqual(origen.abiertas(), [urlDelLote(CAMPUS_NORD.clave)]);
    });
    // Se cambia antes de que llegue la primera: su petición se cancela.
    const grabacion = grabarPanel();
    navegar(ruta.emplazamiento(PEDRALBES.clave, "08"));
    flush();
    await waitFor(() => {
      assert.deepStrictEqual(origen.abiertas(), [urlDelLote(PEDRALBES.clave)]);
    });
    assert.deepStrictEqual(origen.canceladas(), [urlDelLote(CAMPUS_NORD.clave)]);

    // La respuesta de la primera llega tarde, antes que la de la segunda: ya no la espera nadie.
    const { cuerpo } = loteConFichas([CAMPUS_NORD]);
    origen.responder(urlDelLote(CAMPUS_NORD.clave), { estado: 200, cuerpo });
    await responder(origen, PEDRALBES);
    await findByRole("heading", { name: TITULO_PEDRALBES });

    assert.isNull(queryByText(TITULO_CAMPUS_NORD));
    const estados = grabacion.estados();
    assert.isNotEmpty(estados);
    assert.isFalse(
      estados.some((texto) => texto.includes(TITULO_CAMPUS_NORD)),
      "algún estado del panel ha enseñado la ficha anterior",
    );
  });

  it("volver a una ficha ya leída no pide nada: su lote no cambia", async () => {
    const { findByRole, origen } = abrir(CAMPUS_NORD.clave);
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    navegar(ruta.emplazamiento(PEDRALBES.clave, "08"));
    flush();
    await responder(origen, PEDRALBES);
    await findByRole("heading", { name: TITULO_PEDRALBES });

    navegar(ruta.emplazamiento(CAMPUS_NORD.clave, "08"));
    flush();
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    assert.deepStrictEqual(origen.pedidas(), [
      urlDelLote(CAMPUS_NORD.clave),
      urlDelLote(PEDRALBES.clave),
    ]);
  });

  it("la ficha de la misma versión que el mapa da su fecha, sin avisos", async () => {
    const { findByText, findByRole, queryByText, origen } = abrir(CAMPUS_NORD.clave);
    // Misma ejecución que la capa: la ficha va al milisegundo y la capa al segundo.
    await responder(origen, CAMPUS_NORD);
    await findByRole("heading", { name: TITULO_CAMPUS_NORD });
    assert.isNotNull(await findByText(textoEntero("Datos de la ficha: 26 sept 2026")));
    assert.isNull(queryByText(/Actualizado después del mapa/u));
  });

  it("si el origen ya no tiene la versión del mapa, enseña la vigente y dice que es posterior", async () => {
    const { findByText, origen } = abrir(CAMPUS_NORD.clave);
    // Una publicación posterior ha cambiado la ficha y el origen ya no guarda la del mapa.
    const cambiada: Ficha = { ...CAMPUS_NORD, version: NOCHE + DIA };
    const manana = publicacionDePrueba(
      versionDeCapa(NOCHE + DIA),
      NOCHE + DIA,
      [cambiada, PEDRALBES],
      1,
    );
    const ficheroDe = (prefijo: string) =>
      [...manana.ficheros.keys()].find((f) => f.startsWith(prefijo)) ?? "";
    const servir = (fichero: string) =>
      contestar(origen, `${ORIGEN}/${fichero}`, 200, manana.ficheros.get(fichero) ?? "");
    await contestar(origen, urlDelLote(CAMPUS_NORD.clave), 404, "");
    await servir("vigente.json");
    await servir(ficheroDe("resumen@"));
    await servir(ficheroDe("provincias/08/"));
    await servir(manana.loteDe(CAMPUS_NORD.clave));

    const aviso = await findByText("Actualizado después del mapa");
    const marca = aviso.closest("[data-tono]");
    assert.strictEqual(marca?.getAttribute("data-tono"), "posterior");
    assert.match(marca?.textContent ?? "", /es del 27 sept 2026 y el mapa, del 26 sept 2026/u);
  });

  it("un emplazamiento que no está en el mapa no existe, y volver al mapa cierra el panel", async () => {
    const { findByText, getByRole, queryByLabelText, origen } = abrir("movistar-no-existe");
    assert.isNotNull(await findByText("Este emplazamiento no existe"));
    // No hace falta pedir nada: la capa del mapa dice qué emplazamientos hay.
    assert.deepStrictEqual(origen.pedidas(), []);
    const mapa = getByRole("main");

    fireEvent.click(getByRole("button", { name: "Volver al mapa" }));
    flush();
    assert.strictEqual(ubicacion().search.toString(), "");
    assert.isNull(queryByLabelText("Ficha del emplazamiento"));
    // Cerrar no rehace la pantalla del mapa: conserva su posición y su zoom.
    assert.strictEqual(getByRole("main"), mapa);
  });

  it("si la ficha no llega, lo dice con un reintento que vuelve a pedirla", async () => {
    const { findByText, findByRole, getByRole, origen } = abrir(CAMPUS_NORD.clave);
    await contestar(origen, urlDelLote(CAMPUS_NORD.clave), 503, "");
    assert.isNotNull(await findByText("No se ha podido leer la ficha"));

    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    flush();
    await responder(origen, CAMPUS_NORD);
    assert.isNotNull(await findByRole("heading", { name: TITULO_CAMPUS_NORD }));
    assert.deepStrictEqual(origen.pedidas(), [
      urlDelLote(CAMPUS_NORD.clave),
      urlDelLote(CAMPUS_NORD.clave),
    ]);
  });

  it("la dirección con el emplazamiento se puede compartir: al cargarla abre su ficha", () => {
    const { getByLabelText } = abrir(CAMPUS_NORD.clave);
    assert.isNotNull(getByLabelText("Ficha del emplazamiento"));
    assert.strictEqual(ubicacion().search.get("emplazamiento"), CAMPUS_NORD.clave);
  });
});
