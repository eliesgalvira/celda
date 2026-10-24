import type { MedidaPropia } from "@celda/dominio/medida";
import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "../App.tsx";
import { type CapaDePrueba, capaDePrueba, FUENTE_DE_BARRIOS } from "../capa/pruebas.ts";
import { ProveedorDeDatos } from "../datos.tsx";
import { FICHA_CON_CORRECCIONES_ACEPTADAS } from "../ficha/fichasCorregidas.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { navegar, ruta } from "../lib/rutas.ts";
import { type OpcionesDeUbicacion, ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { DialogoAportaciones } from "./DialogoAportaciones.tsx";
import { buzonDePrueba } from "./pruebas.ts";
import { LimiteDelBuzon } from "./sincronizacion.ts";

const FICHA = FICHA_CON_CORRECCIONES_ACEPTADAS;

const CAPA: CapaDePrueba = {
  version: "sitios@2026-10-03T09:00:00Z",
  fecha: FICHA.version,
  emplazamientos: [
    {
      clave: FICHA.clave,
      posicion: FICHA.posicion,
      estado: FICHA.estado,
      companias: FICHA.estaciones.map((e) => e.compania),
      barrio: null,
    },
  ],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

/** Una medida propia de prueba, la que dejaría el registro de medidas (#29). */
const MEDIDA: MedidaPropia = {
  tipo: "propia",
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  esquema: 1,
  creada: Date.UTC(2026, 9, 3, 10, 30),
  origen: "captura",
  punto: { longitud: 2.1155, latitud: 41.3878 },
  senal: { compania: "vodafone", red: "4g", mhz: 1800, rsrpDbm: -90, rsrqDb: -10, pci: 12 },
  unidaA: { emplazamiento: FICHA.clave, posicion: FICHA.posicion, azimut: 120 },
};

const servicios = (opciones: OpcionesDeUbicacion, fichas = fichasDePrueba()) => {
  const dispositivo = ubicacionDePrueba(opciones);
  return {
    dispositivo,
    fichas,
    capa: Layer.mergeAll(capaDePrueba([Effect.succeed(CAPA)]), fichas.capa, dispositivo.capa),
  };
};

/** La app abierta en la ficha con correcciones aceptadas. */
const abrirFicha = async (ficha: Ficha = FICHA) => {
  const montados = servicios({});
  navegar(ruta.emplazamiento(ficha.clave, "08"), { reemplazar: true });
  const pantalla = render(() => <App servicios={montados.capa} />);
  flush();
  await waitFor(() => {
    assert.include(montados.fichas.abiertas(), ficha.clave);
  });
  montados.fichas.responder(ficha.clave, ficha);
  const panel = await pantalla.findByRole("article", { name: "CL JORDI GIRONA, 1" });
  return { ...pantalla, ...montados, panel };
};

/** El diálogo abierto, por su título. */
const dialogo = (pantalla: ReturnType<typeof render>, titulo: string) =>
  pantalla.findByRole("dialog", { name: titulo });

describe("ficha: correcciones aceptadas de la comunidad", () => {
  it("enseña cada una junto al registro, con cuántas personas la sostienen", async () => {
    const { panel } = await abrirFicha();
    const posicion = within(panel).getByLabelText(
      "¿Qué dice cada fuente de Posición del emplazamiento?",
    );
    // El registro sigue a la vista con su dato; la comunidad, al lado.
    assert.isNotNull(within(posicion).getByText("Registro oficial"));
    assert.isNotNull(within(posicion).getByText("Lo sitúa en 41.38834, 2.11363"));
    assert.isNotNull(
      within(posicion).getByText("2 personas lo sitúan a 120 m al este, en 41.38834, 2.11507"),
    );
    assert.isNotNull(within(posicion).getByText("Comunidad de Celda · CC0"));
    assert.isNotNull(within(posicion).getByText("aceptada el 3 oct 2026"));

    const vodafone = within(panel).getByLabelText("¿Qué dice cada fuente de Vodafone?");
    assert.isNotNull(within(vodafone).getByText("La tiene dada de alta"));
    assert.isNotNull(within(vodafone).getByText("1 persona dice que Vodafone no está"));
  });

  it("«Yo también lo veo» envía una corroboración de esa corrección, tras ver la CC0", async () => {
    const pantalla = await abrirFicha();
    const [respaldar] = within(pantalla.panel).getAllByRole("button", {
      name: "Yo también lo veo",
    });
    fireEvent.click(respaldar ?? pantalla.panel);
    flush();
    const abierto = await dialogo(pantalla, "Yo también lo veo");
    const enviar = await within(abierto).findByRole("button", {
      name: "Enviar al dominio público",
    });
    const cc0 = within(abierto).getByRole("region", { name: "Dedicación al dominio público" });
    // La dedicación va antes del botón de enviar.
    assert.isTrue(Boolean(cc0.compareDocumentPosition(enviar) & Node.DOCUMENT_POSITION_FOLLOWING));
    fireEvent.click(enviar);
    flush();
    await within(abierto).findByText(/^Recibida el /u);
    const [recibida] = pantalla.dispositivo.buzon.recibidas();
    assert.strictEqual(recibida?.tipo, "corroboracion");
    assert.deepInclude(recibida, {
      emplazamiento: FICHA.clave,
      correccion: "5d8a7c4e-1b2f-4a3c-9e8d-7f6a5b4c3d2e",
    });
  });

  it("proponer que una compañía no está: el formulario, qué sale y el envío", async () => {
    const pantalla = await abrirFicha();
    fireEvent.click(
      within(pantalla.panel).getByRole("button", { name: "Proponer una corrección" }),
    );
    flush();
    const abierto = await dialogo(pantalla, "Proponer una corrección");
    fireEvent.click(within(abierto).getByLabelText("Una compañía"));
    flush();
    const revisar = within(abierto).getByRole("button", { name: "Revisar y enviar" });
    assert.isTrue(revisar.hasAttribute("disabled"));
    fireEvent.change(within(abierto).getByLabelText("Compañía"), { target: { value: "orange" } });
    fireEvent.click(within(abierto).getByLabelText("No está"));
    fireEvent.input(within(abierto).getByLabelText("Nota (opcional)"), {
      target: { value: "Quitaron sus antenas en verano." },
    });
    flush();
    fireEvent.click(revisar);
    flush();
    const sale = await within(abierto).findByRole("region", {
      name: "¿Qué se envía desde tu dispositivo?",
    });
    assert.isNotNull(within(sale).getByText("Orange no está en este emplazamiento"));
    assert.isNotNull(within(sale).getByText("Quitaron sus antenas en verano."));
    fireEvent.click(within(abierto).getByRole("button", { name: "Enviar al dominio público" }));
    flush();
    await within(abierto).findByText(/^Recibida el /u);
    const [recibida] = pantalla.dispositivo.buzon.recibidas();
    assert.deepInclude(recibida, {
      tipo: "correccion-propuesta",
      emplazamiento: FICHA.clave,
      cambio: { tipo: "compania", compania: "orange", esta: false },
      nota: "Quitaron sus antenas en verano.",
    });
    // Se queda también en el dispositivo, apuntada como compartida.
    assert.deepStrictEqual(
      pantalla.dispositivo.almacen.guardadas(),
      pantalla.dispositivo.buzon.recibidas(),
    );
    assert.strictEqual(pantalla.dispositivo.almacen.compartidas().size, 1);
  });
});

describe("Tus aportaciones", () => {
  /** El diálogo de las aportaciones de un dispositivo con una medida propia guardada. */
  const abrirAportaciones = async (buzon = buzonDePrueba()) => {
    const montados = servicios({ guardadas: [MEDIDA], buzon });
    navegar(`${ruta.mapa}?aportaciones`, { reemplazar: true });
    const pantalla = render(() => <App servicios={montados.capa} />);
    flush();
    const abierto = await dialogo(pantalla, "Tus aportaciones");
    return { ...pantalla, ...montados, abierto };
  };

  it("comparte una medida propia: solo sus números y la dedicación CC0 antes de enviar", async () => {
    const pantalla = await abrirAportaciones();
    const medidas = await within(pantalla.abierto).findByRole("region", {
      name: "Medidas propias",
    });
    assert.isNotNull(within(medidas).getByText("SOLO EN ESTE DISPOSITIVO"));
    fireEvent.click(within(medidas).getByRole("button", { name: "Compartir" }));
    flush();
    const abierto = await dialogo(pantalla, "Compartir una aportación");
    const sale = within(abierto).getByRole("region", {
      name: "¿Qué se envía desde tu dispositivo?",
    });
    for (const valor of ["−90 dBm", "−10 dB", "1800 MHz", "41.38780, 2.11550", MEDIDA.id]) {
      assert.isNotNull(within(sale).getByText(valor));
    }
    assert.isNotNull(within(sale).getByText(/La captura se queda en tu dispositivo/u));
    assert.isNotNull(within(abierto).getByText(/dominio público con la CC0 1.0 Universal/u));
    fireEvent.click(within(abierto).getByRole("button", { name: "Enviar al dominio público" }));
    flush();
    await within(abierto).findByText(/^Recibida el /u);
    assert.deepStrictEqual(pantalla.dispositivo.buzon.recibidas(), [MEDIDA]);

    fireEvent.click(within(abierto).getByRole("button", { name: "Hecho" }));
    flush();
    const lista = await dialogo(pantalla, "Tus aportaciones");
    await within(lista).findByText(/COMPARTIDA EL/u);
  });

  it("si el buzón rechaza por un límite lo dice, y la medida sigue en el dispositivo", async () => {
    const buzon = buzonDePrueba();
    // El aviso cuenta lo que falta desde la hora del navegador, como en la web.
    // @effect-diagnostics-next-line globalDate:off
    buzon.fallar(new LimiteDelBuzon({ ambito: "ip", reintentarA: Date.now() + 5 * 60_000 }));
    const pantalla = await abrirAportaciones(buzon);
    fireEvent.click(await within(pantalla.abierto).findByRole("button", { name: "Compartir" }));
    flush();
    const abierto = await dialogo(pantalla, "Compartir una aportación");
    fireEvent.click(within(abierto).getByRole("button", { name: "Enviar al dominio público" }));
    flush();
    const aviso = await within(abierto).findByRole("alert");
    assert.isNotNull(within(aviso).getByText("Muchas aportaciones desde tu red"));
    assert.match(aviso.textContent ?? "", /dentro de 5 min/u);
    assert.match(aviso.textContent ?? "", /Sigue guardada en este dispositivo/u);
    assert.deepStrictEqual(pantalla.dispositivo.almacen.guardadas(), [MEDIDA]);
    assert.strictEqual(pantalla.dispositivo.almacen.compartidas().size, 0);
    assert.isNotNull(within(abierto).getByRole("button", { name: "Intentar otra vez" }));
  });

  it("en un ordenador dice por qué no hay medidas propias", async () => {
    const montados = servicios({});
    const { findByText } = render(() => (
      <ProveedorDeDatos servicios={montados.capa}>
        <DialogoAportaciones dispositivo="ordenador" alCerrar={() => {}} alElegirPunto={() => {}} />
      </ProveedorDeDatos>
    ));
    flush();
    assert.isNotNull(await findByText("En un ordenador no hay medidas propias"));
  });
});
