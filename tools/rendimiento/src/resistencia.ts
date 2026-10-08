// La prueba no usa Effect: Playwright es de promesas y el script corre con Node tal cual.
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalConsole:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { chromium, devices, type Page } from "playwright-core";

import { escribirCapaSintetica } from "./capaSintetica.ts";
import { CONTADAS, type Contada, instalarContador } from "./contador.ts";
import { mapaBaseFalso } from "./mapa.ts";
import { servirSitio } from "./sitio.ts";

/**
 * Prueba de resistencia: abre Celda en Chromium sin interfaz, como un Android con el permiso de
 * ubicación dado, abre un emplazamiento, enciende el GPS y la brújula, filtra por Digi (sus celdas
 * cuentan también las de Movistar, la red que usa), abre la vista de interferencia con las celdas
 * calculadas, espera a que la página quede quieta y la deja así. Mientras tanto el GPS da una
 * lectura por segundo en el mismo sitio y la brújula diez por segundo. Cuenta las llamadas a las
 * API que abren algo y falla si alguna crece más de lo que justifican esas lecturas, o si la página
 * no llega a quedarse quieta. Ver docs/patterns/efectos.md.
 *
 *   pnpm run resistencia [--web ../../apps/web/dist] [--segundos 30] [--chromium <ruta>]
 *
 * El mapa base no sale de OpenFreeMap: las peticiones se contestan aquí con teselas vacías, así
 * que no hace falta conexión ni GPU (WebGL con SwiftShader).
 */

const { values: opciones } = NodeUtil.parseArgs({
  // pnpm pasa el `--` de `pnpm run resistencia -- --segundos 10`.
  args: process.argv.slice(2).filter((argumento) => argumento !== "--"),
  options: {
    web: { type: "string", default: "../../apps/web/dist" },
    segundos: { type: "string", default: "30" },
    chromium: { type: "string", default: process.env.CELDA_CHROMIUM ?? "/usr/bin/chromium" },
  },
});

const SEGUNDOS = Number(opciones.segundos);
/** Lecturas que llegan sin que nadie toque nada: el GPS, una por segundo; la brújula, diez. */
const LECTURAS_GPS = SEGUNDOS;
const LECTURAS_BRUJULA = SEGUNDOS * 10;

/**
 * Cuánto puede crecer cada cuenta en la ventana quieta, y por qué. Lo que abre algo no crece nada:
 * el GPS no se reabre, no se pide nada a la red ni al Worker con el punto en el mismo sitio. Lo
 * que no es cero sigue a las lecturas, nunca a un bucle.
 */
const UMBRALES: Readonly<Record<Contada, { readonly maximo: number; readonly motivo: string }>> = {
  watchPosition: { maximo: 0, motivo: "el GPS se abre una vez" },
  clearWatch: { maximo: 0, motivo: "ni se cierra mientras es la referencia" },
  getCurrentPosition: { maximo: 0, motivo: "Celda no la usa" },
  addEventListener: { maximo: 0, motivo: "nada nuevo que escuchar sin tocar la pantalla" },
  removeEventListener: { maximo: 0, motivo: "ni que dejar de escuchar" },
  fetch: { maximo: 0, motivo: "sin tocar nada no se pide nada" },
  "new Worker": { maximo: 0, motivo: "el Worker de las simulaciones no se termina" },
  postMessage: { maximo: 0, motivo: "con el punto quieto no se recalcula nada" },
  setInterval: { maximo: 0, motivo: "Celda no usa intervalos" },
  setTimeout: {
    // Effect agenda con setTimeout el trabajo de cada lectura que llega por una cola.
    maximo: 2 * (LECTURAS_GPS + LECTURAS_BRUJULA),
    motivo: "dos por lectura del GPS o de la brújula como mucho",
  },
  requestAnimationFrame: {
    maximo: 0,
    motivo: "sin nada animándose no se pide ningún fotograma",
  },
};

const cuentas = (pagina: Page) => pagina.evaluate(() => window.__resistencia.cuentas());

/** Tiempo sin que crezca nada, salvo `setTimeout`, y sin fotogramas pendientes: página quieta. */
const QUIETA_MS = 2000;
/** Lo más que se espera, tras prepararla, a que la página quede quieta. */
const MAXIMO_HASTA_QUIETA_MS = 30_000;

/**
 * Espera a que acabe lo que ha abierto la preparación: los cálculos, las teselas que MapLibre
 * maqueta en sus workers y el último fotograma que pinta. Con una pausa fija, en una máquina lenta
 * ese fotograma llegaba ya dentro de la ventana quieta y su `removeEventListener` contaba como
 * algo abierto sin que nadie tocara nada. Devuelve las API que seguían creciendo si no se queda
 * quieta a tiempo: eso ya es un bucle.
 */
const esperarQuieta = async (pagina: Page): Promise<ReadonlyArray<Contada> | undefined> => {
  const desde = performance.now();
  let anterior = await cuentas(pagina);
  let quietaDesde = performance.now();
  let crecen: ReadonlyArray<Contada> = [];
  while (performance.now() - desde < MAXIMO_HASTA_QUIETA_MS) {
    await pausa(250);
    const ahora = await cuentas(pagina);
    const pendientes = await pagina.evaluate(() => window.__resistencia.fotogramasPendientes());
    crecen = CONTADAS.filter(
      (api) => api !== "setTimeout" && (ahora[api] ?? 0) !== (anterior[api] ?? 0),
    );
    anterior = ahora;
    if (crecen.length > 0 || pendientes > 0) quietaDesde = performance.now();
    else if (performance.now() - quietaDesde >= QUIETA_MS) return undefined;
  }
  return crecen.length > 0 ? crecen : ["requestAnimationFrame"];
};

const esperarTexto = (pagina: Page, texto: RegExp) =>
  pagina.getByText(texto).first().waitFor({ state: "visible", timeout: 20_000 });

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

const principal = async () => {
  const temporal = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "celda-resistencia-"));
  const capa = await escribirCapaSintetica(temporal);
  const sitio = await servirSitio(NodePath.resolve(opciones.web), capa.carpeta);
  const navegador = await chromium.launch({
    executablePath: opciones.chromium,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const avisos: Array<string> = [];
  let fallo = false;
  try {
    // Al suroeste del emplazamiento central, a unos 200 m.
    const posicion = {
      latitude: capa.centro.latitud - 0.0012,
      longitude: capa.centro.longitud - 0.0015,
    };
    const contexto = await navegador.newContext({
      // Un Android de pantalla ancha, como una tableta: la ficha a un lado y los controles a la
      // vista, sin que la hoja tape nada. Sin GPU, mejor pocos píxeles.
      ...devices["Pixel 7"],
      viewport: { width: 1100, height: 850 },
      deviceScaleFactor: 1,
      locale: "es-ES",
      // La brújula de Chromium pide permiso a los sensores de movimiento.
      permissions: ["geolocation", "accelerometer", "gyroscope", "magnetometer"],
      geolocation: { ...posicion, accuracy: 20 },
    });
    await contexto.route("https://tiles.openfreemap.org/**", mapaBaseFalso);
    await contexto.addInitScript(instalarContador);
    const pagina = await contexto.newPage();
    pagina.on("console", (mensaje) => {
      if (mensaje.type() === "warning" || mensaje.type() === "error") avisos.push(mensaje.text());
    });
    pagina.on("pageerror", (error) => avisos.push(error.message));

    // PREPARAR: lo que haría una persona antes de dejar el móvil quieto
    await pagina.goto(`${sitio.origen}/?emplazamiento=${encodeURIComponent(capa.central)}`);
    await pagina.getByRole("heading", { name: capa.titulo }).waitFor({ timeout: 20_000 });
    await pagina.waitForFunction(
      () => !(document.body.textContent ?? "").includes("Cargando el mapa base"),
      undefined,
      { timeout: 20_000 },
    );

    const referencia = pagina.getByRole("region", { name: "Punto de referencia" });
    await referencia.getByRole("button", { name: "Usar mi ubicación" }).click();
    await esperarTexto(pagina, /Desde: tu ubicación/u);

    // Las secciones de la ficha fuera de la vista no se pintan (`content-visibility: auto`).
    await pagina
      .getByRole("heading", { name: "Mejorar la señal", includeHidden: true })
      .evaluate((titulo) => titulo.scrollIntoView());
    await pagina.evaluate(() => window.__resistencia.girar());
    await pagina.getByRole("button", { name: "Usar la brújula del móvil" }).click();
    const continuar = pagina.getByRole("button", { name: "Continuar" });
    if (await continuar.isVisible()) await continuar.click();
    await esperarTexto(pagina, /Brújula del móvil/u);

    // Con Digi, las celdas se calculan con los suyos y los de Movistar, la red que usa (ADR 0026).
    await pagina.getByRole("button", { name: "Compañías" }).click();
    await pagina.getByRole("button", { name: /^Digi/u }).click();
    await pagina.keyboard.press("Escape");
    await esperarTexto(pagina, /Solo Digi/u);

    const funciones = pagina.getByRole("button", { name: "Funciones" });
    if (await funciones.isVisible()) await funciones.click();
    await pagina.getByRole("button", { name: /^Interferencia/u }).click();
    await esperarTexto(pagina, /destaca la señal/u);
    // La salvedad de las celdas dura 5 s o hasta el primer gesto sobre el mapa, y al irse deja de
    // escuchar los gestos: si la página se queda quieta antes, eso caía dentro de la ventana. Una
    // tecla que el mapa no usa es ese primer gesto, como haría quien deja el móvil.
    await pagina.locator(".maplibregl-canvas").press("Shift");

    // Que acaben las transiciones, los cálculos y el pintado de lo que se ha abierto.
    const sinAsentarse = await esperarQuieta(pagina);
    if (sinAsentarse !== undefined) {
      fallo = true;
      console.log(
        `✗ En ${MAXIMO_HASTA_QUIETA_MS / 1000} s la página no se quedó quieta: seguían creciendo ${sinAsentarse.join(", ")}.\n`,
      );
    }
    const antes = await cuentas(pagina);

    // QUIETO: nadie toca nada; el GPS repite el mismo sitio con otra precisión
    for (let segundo = 0; segundo < SEGUNDOS; segundo += 1) {
      await contexto.setGeolocation({ ...posicion, accuracy: segundo % 2 === 0 ? 25 : 20 });
      await pausa(1000);
    }
    const despues = await cuentas(pagina);

    console.log(
      `Celda quieta ${SEGUNDOS} s, con ${LECTURAS_GPS} lecturas del GPS y ${LECTURAS_BRUJULA} de la brújula:\n`,
    );
    console.log(`${"API".padEnd(22)}${"al empezar".padStart(12)}${"crece".padStart(8)}  tope`);
    for (const api of CONTADAS) {
      const inicial = antes[api] ?? 0;
      const crece = (despues[api] ?? 0) - inicial;
      const { maximo, motivo } = UMBRALES[api];
      const bien = crece <= maximo;
      fallo ||= !bien;
      console.log(
        `${bien ? " " : "✗"} ${api.padEnd(20)}${String(inicial).padStart(12)}${String(crece).padStart(8)}  ${maximo} (${motivo})`,
      );
    }
    if (antes.watchPosition !== 1) {
      fallo = true;
      console.log(
        `\n✗ Al preparar, watchPosition se llamó ${antes.watchPosition ?? 0} veces, no 1.`,
      );
    }
    if (avisos.length > 0) console.log(`\nLa página avisó:\n${avisos.join("\n")}`);
  } finally {
    await navegador.close();
    await sitio.cerrar();
    await NodeFSP.rm(temporal, { recursive: true, force: true });
  }
  if (fallo) {
    console.log("\nAlgo se abre sin que nadie lo pida. Ver docs/patterns/efectos.md.");
    process.exitCode = 1;
  } else {
    console.log("\nNada se abre sin que nadie lo pida.");
  }
};

await principal();
