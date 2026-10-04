// La medida no usa Effect: Playwright es de promesas y el script corre con Node tal cual.
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  type BrowserContext,
  type CDPSession,
  chromium,
  type Locator,
  type Page,
} from "playwright-core";

import { type Centro, type FotogramasEnPagina, instalar } from "./pagina.ts";
import { servirSitio } from "./sitio.ts";
import { resumirPerfil, type ResumenDeTraza, resumirTraza } from "./traza.ts";

/**
 * Mide la carga y la fluidez de Celda en un móvil simulado: Chromium sin interfaz con GPU, a
 * 390 × 844 con DPR 2,6, la CPU frenada por CDP y la red de «Fast 4G» de DevTools. Con
 * `--pantalla escritorio`, en una pantalla de 1400 × 900 con ratón. El mapa base viene de
 * OpenFreeMap de verdad, así que hace falta conexión. Ver docs/patterns/rendimiento.md.
 *
 *   pnpm run medir -- --capas <carpeta publicada> [--web ../../apps/web/dist] [--cpu 4,6]
 *                     [--repeticiones 3] [--trazas <carpeta>] [--json <fichero>]
 *                     [--escenario barcelona|espana|borde|vuelos] [--ruta /?emplazamiento=<clave>]
 *                     [--pantalla movil|escritorio] [--grupos saltos,vuelos,alejar,…]
 *
 * El escenario `barcelona` va a Barcelona entera y hace allí los gestos de siempre. El de `espana`, el
 * de varias provincias (ADR 0016): aleja hasta ver toda España con el resumen, toca el hexágono
 * de Barcelona, acerca con el botón hasta el nivel de municipios y arrastra y pellizca allí,
 * acerca hasta la calle tocando la agrupación o la zona mayor, vuelve al nivel de provincias y
 * cruza de una a otra arrastrando, y al final mide la memoria de la página y sus Workers.
 *
 * El de `borde` (#45) abre la web con `--ruta`, el enlace a la ficha de un emplazamiento junto al
 * borde de dos provincias, sin su provincia: la web la busca en el índice de claves y abre el
 * mapa a zoom 16 sobre él. Cierra la ficha y cruza el borde arrastrando con las celdas, abre la
 * vista de interferencia y lo cruza otra vez, y aleja y acerca.
 *
 * El de `vuelos` (#67) mueve la cámara de MapLibre como los recorridos del #61 y el #66: saltos de
 * vista en vista, cinco vuelos de España a la calle y vuelta, alejarse del Eixample hasta España y
 * acercar y alejar nivel a nivel sobre Zaragoza y Barcelona. No depende de qué marcadores se ven
 * ni de dónde caen en la pantalla, así que da lo mismo con cualquier capa publicada y pantalla.
 */

/**
 * Los argumentos de la orden. `pnpm run medir -- --capas …` deja pasar el `--`, que `parseArgs`
 * toma como el fin de las opciones: se quita.
 */
const argumentos = process.argv.slice(2);
const { values: opciones } = NodeUtil.parseArgs({
  args: argumentos[0] === "--" ? argumentos.slice(1) : argumentos,
  options: {
    capas: { type: "string" },
    web: { type: "string", default: "../../apps/web/dist" },
    cpu: { type: "string", default: "4,6" },
    repeticiones: { type: "string", default: "3" },
    trazas: { type: "string" },
    json: { type: "string" },
    chromium: { type: "string", default: process.env.CELDA_CHROMIUM ?? "/usr/bin/chromium" },
    red: { type: "string", default: "fast4g" },
    cascada: { type: "boolean", default: false },
    perfil: { type: "string" },
    "solo-carga": { type: "boolean", default: false },
    // Fracción de CPU ocupada por encima de la cual se espera antes de cada ronda.
    calma: { type: "string", default: "0.08" },
    escenario: { type: "string", default: "barcelona" },
    ruta: { type: "string", default: "/" },
    pantalla: { type: "string", default: "movil" },
    // Con `--escenario vuelos`, solo estos grupos de gestos, separados por comas.
    grupos: { type: "string" },
  },
});

const capas = opciones.capas ?? process.env.CELDA_CAPAS_CARPETA;
if (capas === undefined) {
  process.stderr.write("Falta --capas: la carpeta con vigente.json, la capa y las fichas.\n");
  process.exit(2);
}

/** «Fast 4G» de Chrome DevTools: 9 Mb/s de bajada, 1,5 de subida y 60 ms × 2,75 de latencia. */
const RED = {
  fast4g: {
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9,
    uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
  },
  sin: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
} as const;

/** Lo que ha trabajado la CPU desde el arranque, en ticks de /proc/stat: ocupada y total. */
const ticks = async () => {
  const linea = (await NodeFSP.readFile("/proc/stat", "utf8")).split("\n")[0] ?? "";
  const campos = linea.split(/\s+/u).slice(1).map(Number);
  const total = campos.reduce((a, b) => a + b, 0);
  // idle e iowait son los campos 4 y 5.
  return { ocupada: total - (campos[3] ?? 0) - (campos[4] ?? 0), total };
};

/**
 * Espera a que la máquina esté tranquila antes de una ronda: con otro navegador o una compilación
 * en marcha, el móvil simulado va más lento de lo que toca. Como mucho diez minutos; si no se
 * calma, sigue y lo dice. Solo en Linux: en otro sistema no espera.
 */
const esperarCalma = async (): Promise<void> => {
  if (process.platform !== "linux") return;
  for (let intento = 0; intento < 120; intento += 1) {
    const antes = await ticks();
    await esperar(1000);
    const despues = await ticks();
    const uso = (despues.ocupada - antes.ocupada) / Math.max(1, despues.total - antes.total);
    if (uso < Number(opciones.calma)) return;
    if (intento % 12 === 0) {
      process.stderr.write(`  máquina ocupada (${Math.round(uso * 100)} %), esperando…\n`);
    }
    await esperar(4000);
  }
  process.stderr.write("  la máquina no se calma: la ronda puede salir más lenta\n");
};

/**
 * Las pantallas: el móvil de siempre, con el dedo, y una de escritorio, con el ratón. `centro` es
 * donde empiezan los gestos, en medio del mapa.
 */
const PANTALLAS = {
  movil: { ancho: 390, alto: 844, dpr: 2.6, tactil: true, centro: { x: 195, y: 420 } },
  escritorio: { ancho: 1400, alto: 900, dpr: 1, tactil: false, centro: { x: 700, y: 450 } },
} as const;

const PANTALLA = opciones.pantalla === "escritorio" ? PANTALLAS.escritorio : PANTALLAS.movil;
const ANCHO = PANTALLA.ancho;
const ALTO = PANTALLA.alto;

const esperar = (ms: number) =>
  new Promise<void>((resolver) => {
    setTimeout(resolver, ms);
  });

interface Peticion {
  readonly url: string;
  readonly inicio: number;
  readonly fin: number | undefined;
  readonly bytes: number;
  readonly tipo: string;
}

const abrirContexto = async (
  navegador: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<BrowserContext> => {
  const contexto = await navegador.newContext(
    PANTALLA.tactil
      ? {
          viewport: { width: ANCHO, height: ALTO },
          deviceScaleFactor: PANTALLA.dpr,
          isMobile: true,
          hasTouch: true,
          locale: "es-ES",
          userAgent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
        }
      : {
          viewport: { width: ANCHO, height: ALTO },
          deviceScaleFactor: PANTALLA.dpr,
          locale: "es-ES",
        },
  );
  await contexto.addInitScript(instalar);
  return contexto;
};

const frenar = async (cdp: CDPSession, cpu: number) => {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", opciones.red === "sin" ? RED.sin : RED.fast4g);
};

/**
 * Sigue las peticiones de la página y de sus workers (las teselas las pide el worker de MapLibre),
 * con sus bytes por la red y cuándo empiezan y terminan, en ms desde el origen de la página.
 */
const seguirRed = (pagina: Page) => {
  const peticiones: Array<Peticion> = [];
  const pendientes: Array<Promise<void>> = [];
  pagina.on("requestfinished", (peticion) => {
    pendientes.push(
      (async () => {
        const tiempos = peticion.timing();
        const tamanos = await peticion
          .sizes()
          .catch(() => ({ responseBodySize: 0, responseHeadersSize: 0 }));
        peticiones.push({
          url: peticion.url(),
          inicio: tiempos.startTime,
          fin: tiempos.startTime + tiempos.responseEnd,
          bytes: tamanos.responseBodySize + tamanos.responseHeadersSize,
          tipo: peticion.resourceType(),
        });
      })(),
    );
  });
  return {
    peticiones: async (origenDePagina: number) => {
      await Promise.all(pendientes);
      return peticiones.map((p) => ({
        ...p,
        inicio: p.inicio - origenDePagina,
        fin: p.fin === undefined ? undefined : p.fin - origenDePagina,
      }));
    },
  };
};

const resumirFotogramas = (datos: FotogramasEnPagina) => {
  const intervalos = [...datos.intervalos].sort((a, b) => a - b);
  const p = (q: number) =>
    intervalos[Math.min(intervalos.length - 1, Math.floor(q * intervalos.length))] ?? 0;
  const tiempo = datos.intervalos.reduce((a, b) => a + b, 0);
  return {
    fps: tiempo > 0 ? (datos.intervalos.length * 1000) / tiempo : 0,
    p95: p(0.95),
    maximo: intervalos.at(-1) ?? 0,
    // Un intervalo de más de 20 ms es al menos un refresco perdido a 60 Hz.
    perdidos: datos.intervalos.filter((i) => i > 20).length,
    mas50: datos.intervalos.filter((i) => i > 50).length,
    fotogramas: datos.intervalos.length,
    loaf: datos.largos.length,
    peorLoaf: datos.largos.reduce((a, b) => (b.duracion > a.duracion ? b : a), {
      duracion: 0,
      bloqueo: 0,
      estilo: 0,
      guion: "",
    }),
    nodos: datos.nodos,
  };
};

type Fotogramas = ReturnType<typeof resumirFotogramas>;

const CATEGORIAS_TRAZA = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "v8.execute",
  "blink",
  "blink.user_timing",
  "gpu",
  "cc",
  "viz",
  "toplevel",
].join(",");

/** Graba `accion` en la página y devuelve sus fotogramas y, si se pide, el resumen de su traza. */
const grabar = async (
  pagina: Page,
  cdp: CDPSession,
  nombre: string,
  accion: () => Promise<void>,
  traza: string | undefined,
): Promise<{ fotogramas: Fotogramas; traza?: ResumenDeTraza }> => {
  if (traza !== undefined) {
    await cdp.send("Tracing.start", {
      categories: CATEGORIAS_TRAZA,
      transferMode: "ReturnAsStream",
    });
  }
  if (opciones.perfil !== undefined) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  await pagina.evaluate(() => window.__celda.empezar());
  await accion();
  // Lo que pasa al asentarse (el `moveend`, el cambio de nivel) también cuenta.
  await esperar(900);
  const datos = await pagina.evaluate(() => window.__celda.parar());
  if (opciones.perfil !== undefined) {
    const { profile } = await cdp.send("Profiler.stop");
    await NodeFSP.mkdir(opciones.perfil, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(opciones.perfil, `${nombre}.cpuprofile`),
      JSON.stringify(profile),
    );
    process.stdout.write(`\nPerfil de ${nombre}: ${resumirPerfil(profile)}\n`);
  }
  let resumen: ResumenDeTraza | undefined;
  if (traza !== undefined) {
    const completa = new Promise<string>((resolver) => {
      cdp.once("Tracing.tracingComplete", (evento) => resolver(evento.stream ?? ""));
    });
    await cdp.send("Tracing.end");
    const flujo = await completa;
    let texto = "";
    for (;;) {
      const trozo = await cdp.send("IO.read", { handle: flujo, size: 1 << 20 });
      texto +=
        trozo.base64Encoded === true ? Buffer.from(trozo.data, "base64").toString() : trozo.data;
      if (trozo.eof) break;
    }
    await cdp.send("IO.close", { handle: flujo });
    await NodeFSP.mkdir(traza, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(traza, `${nombre}.json`), texto);
    // SAFETY: Chromium escribe la traza en el formato Trace Event, con `traceEvents`.
    const eventos = JSON.parse(texto) as { traceEvents: Parameters<typeof resumirTraza>[0] };
    resumen = resumirTraza(eventos.traceEvents);
  }
  return resumen === undefined
    ? { fotogramas: resumirFotogramas(datos) }
    : { fotogramas: resumirFotogramas(datos), traza: resumen };
};

const CENTRO = PANTALLA.centro;

/** Toca un elemento con el dedo o, en el escritorio, lo pulsa con el ratón. */
const tocar = (elemento: Locator): Promise<void> =>
  PANTALLA.tactil ? elemento.tap() : elemento.click();

/** Toca un punto de la pantalla con el dedo o lo pulsa con el ratón. */
const tocarEn = (pagina: Page, x: number, y: number): Promise<void> =>
  PANTALLA.tactil ? pagina.touchscreen.tap(x, y) : pagina.mouse.click(x, y);

/**
 * Lo que hace un dedo, o el ratón con el botón pulsado en el escritorio, para arrastrar el mapa.
 * Va por CDP: `synthesizeScrollGesture` no sirve, porque el navegador se queda el gesto como
 * desplazamiento y MapLibre no recibe `touchmove`.
 */
const dedo = (cdp: CDPSession) => ({
  apoyar: (punto: { x: number; y: number }) =>
    PANTALLA.tactil
      ? cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [punto] })
      : cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...punto,
          button: "left",
          buttons: 1,
          clickCount: 1,
        }),
  mover: (punto: { x: number; y: number }) =>
    PANTALLA.tactil
      ? cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [punto] })
      : cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...punto,
          button: "left",
          buttons: 1,
        }),
  levantar: (punto: { x: number; y: number }) =>
    PANTALLA.tactil
      ? cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      : cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...punto,
          button: "left",
          buttons: 0,
          clickCount: 1,
        }),
});

/** Un arrastre de `dx`, `dy` píxeles desde el centro en `pasos` eventos, uno cada 16 ms. */
const arrastrarDesdeElCentro = async (cdp: CDPSession, dx: number, dy: number, pasos: number) => {
  const mano = dedo(cdp);
  const puntos = Array.from({ length: pasos }, (_, k) => ({
    x: CENTRO.x + (dx * (k + 1)) / pasos,
    y: CENTRO.y + (dy * (k + 1)) / pasos,
  }));
  await mano.apoyar(CENTRO);
  for (const punto of puntos) {
    await mano.mover(punto);
    await esperar(16);
  }
  await mano.levantar(puntos.at(-1) ?? CENTRO);
};

/** Arrastra el mapa, ida y vuelta, a unos 60 eventos por segundo. */
const arrastrar = async (cdp: CDPSession) => {
  for (const [dx, dy] of [
    [-220, -160],
    [220, 160],
  ] as const) {
    await arrastrarDesdeElCentro(cdp, dx, dy, 40);
    await esperar(200);
  }
};

/** Un arrastre de `dx`, `dy` píxeles en unos 0,6 s, y un momento para asentarse. */
const arrastrarUnaVez = async (cdp: CDPSession, dx: number, dy: number) => {
  await arrastrarDesdeElCentro(cdp, dx, dy, 36);
  await esperar(700);
};

/**
 * La memoria de la página y de sus Workers (`measureUserAgentSpecificMemory`, que pide la página
 * aislada) y el montón de JavaScript del hilo principal (CDP).
 */
const medirMemoria = async (pagina: Page, cdp: CDPSession) => {
  const total = await pagina
    .evaluate(async () => {
      // SAFETY: la API existe en Chromium con la página aislada; sin ella, no hay medida.
      const medir = (
        performance as Performance & {
          measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
        }
      ).measureUserAgentSpecificMemory;
      return medir === undefined ? undefined : (await medir.call(performance)).bytes;
    })
    .catch(() => undefined);
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const hilo = metrics.find((m) => m.name === "JSHeapUsedSize")?.value;
  return { total, hilo };
};

const pellizcar = async (cdp: CDPSession) => {
  for (const escala of [1.8, 1 / 1.8]) {
    await cdp.send("Input.synthesizePinchGesture", {
      x: CENTRO.x,
      y: CENTRO.y,
      scaleFactor: escala,
      relativeSpeed: 500,
      gestureSourceType: PANTALLA.tactil ? "touch" : "mouse",
    });
    await esperar(300);
  }
};

const rueda = async (cdp: CDPSession) => {
  for (const sentido of [-1, 1]) {
    for (let i = 0; i < 8; i += 1) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: CENTRO.x,
        y: CENTRO.y,
        deltaX: 0,
        deltaY: sentido * 120,
      });
      await esperar(40);
    }
    await esperar(400);
  }
};

/**
 * Pulsa un control del mapa. En el móvil, Acercar y Alejar van dentro del menú «Funciones», que se
 * cierra tras cada pulsación: si el control no se ve, abre antes el menú, como haría una persona.
 */
const pulsar = async (pagina: Page, etiqueta: string, veces: number) => {
  const boton = pagina.getByRole("button", { name: etiqueta, exact: true });
  const menu = pagina.getByRole("button", { name: "Funciones", exact: true });
  for (let i = 0; i < veces; i += 1) {
    if (!(await boton.isVisible()) && (await menu.count()) > 0) {
      await tocar(menu);
      await esperar(150);
    }
    await tocar(boton);
    await esperar(700);
  }
};

/**
 * Acerca hasta la calle como lo haría una persona: toca la agrupación, el municipio o el barrio
 * con más emplazamientos de los que se ven, y así hasta `veces` o hasta que ya no queda ninguno.
 */
const abrirAgrupaciones = async (pagina: Page, veces: number) => {
  for (let i = 0; i < veces; i += 1) {
    const objetivo = await pagina.evaluate((pantalla) => {
      const lamina = document.querySelector('section[aria-label="Emplazamientos"]');
      const botones = [...(lamina?.querySelectorAll(":scope > button:not([inert])") ?? [])];
      return (
        botones
          .map((b) => {
            const caja = b.getBoundingClientRect();
            // «12 emplazamientos, acercar» o «Terrassa, 118 emplazamientos, sin Digi, acercar».
            const numero = Number(
              /(\d+) emplazamientos?,/u.exec(b.getAttribute("aria-label") ?? "")?.[1] ?? Number.NaN,
            );
            return { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2, numero };
          })
          // Lejos de la cabecera, de los controles de la derecha y de la hoja de abajo.
          .filter(
            (c) =>
              Number.isFinite(c.numero) &&
              c.x > 30 &&
              c.x < pantalla.ancho - 60 &&
              c.y > 160 &&
              c.y < pantalla.alto - 144,
          )
          .sort((a, b) => b.numero - a.numero)[0]
      );
    }, PANTALLA);
    if (objetivo === undefined) return;
    await tocarEn(pagina, objetivo.x, objetivo.y);
    await esperar(1200);
  }
};

/** Qué marcadores hay en la lámina: logos, hexágonos y barrios. */
const contarMarcadores = (pagina: Page) =>
  pagina.evaluate(() => {
    const lamina = document.querySelector('section[aria-label="Emplazamientos"]');
    const botones = [...(lamina?.querySelectorAll(":scope > button") ?? [])];
    return {
      logos: botones.filter((b) => b.hasAttribute("data-estado")).length,
      hexagonos: botones.filter((b) => b.classList.contains("cursor-zoom-in")).length,
      otros: botones.filter(
        (b) => !b.hasAttribute("data-estado") && !b.classList.contains("cursor-zoom-in"),
      ).length,
    };
  });

/**
 * Toca el marcador de logos más cercano a `cerca` y mide hasta que la ficha se pinta: desde el
 * `pointerdown` hasta el fotograma que ya tiene el artículo de la ficha.
 */
const tocarFicha = async (pagina: Page, cerca: { x: number; y: number }) => {
  const objetivo = await pagina.evaluate(
    ({ punto, pantalla }) => {
      const lamina = document.querySelector('section[aria-label="Emplazamientos"]');
      const candidatos = [...(lamina?.querySelectorAll(":scope > button[data-estado]") ?? [])]
        .map((b) => {
          const caja = b.getBoundingClientRect();
          return { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
        })
        // Lejos de la cabecera, de los controles de la derecha y de la hoja de abajo.
        .filter(
          (c) => c.x > 30 && c.x < pantalla.ancho - 90 && c.y > 160 && c.y < pantalla.alto - 324,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - punto.x, a.y - punto.y) - Math.hypot(b.x - punto.x, b.y - punto.y),
        );
      return candidatos[0];
    },
    { punto: cerca, pantalla: PANTALLA },
  );
  if (objetivo === undefined) return undefined;
  const medida = pagina.evaluate(
    () =>
      new Promise<number>((resolver) => {
        let t0 = 0;
        document.addEventListener(
          "pointerdown",
          () => {
            t0 = performance.now();
          },
          { capture: true, once: true },
        );
        const mirar = () => {
          if (t0 > 0 && document.querySelector("article[aria-label]") !== null) {
            const canal = new MessageChannel();
            canal.port1.addEventListener("message", () => resolver(performance.now() - t0));
            canal.port1.start();
            canal.port2.postMessage(undefined);
            return;
          }
          requestAnimationFrame(mirar);
        };
        requestAnimationFrame(mirar);
      }),
  );
  await esperar(50);
  let lotes = 0;
  const contar = (peticion: { url: () => string }) => {
    if (peticion.url().includes("/fichas/")) lotes += 1;
  };
  pagina.on("request", contar);
  await tocarEn(pagina, objetivo.x, objetivo.y);
  const ms = await medida;
  pagina.off("request", contar);
  if (lotes > 0)
    process.stderr.write(`  la ficha de ${Math.round(ms)} ms pidió ${lotes} lote(s)\n`);
  return { ms, punto: objetivo };
};

const cerrarFicha = async (pagina: Page) => {
  await pagina.goBack();
  await pagina.waitForSelector("article[aria-label]", { state: "detached" });
  await esperar(800);
};

/**
 * Encuentra el mapa de MapLibre de la página y lo deja en `window.__celdaMapa`, para mover la
 * cámara (`CamaraEnPagina`). La web no lo expone, así que se busca en el montón de V8 por CDP: la
 * clase cuyo prototipo tiene `flyTo` y `getCanvasContainer`, y el ejemplar de esa clase que está
 * en la página. Va antes de medir: recorrer el montón cuesta.
 */
const atraparMapa = async (cdp: CDPSession): Promise<boolean> => {
  const grupo = "celda-mapa";
  const funciones = await cdp.send("Runtime.evaluate", {
    expression: "Function.prototype",
    objectGroup: grupo,
  });
  const todas = await cdp.send("Runtime.queryObjects", {
    prototypeObjectId: funciones.result.objectId ?? "",
    objectGroup: grupo,
  });
  const prototipo = await cdp.send("Runtime.callFunctionOn", {
    objectId: todas.objects.objectId ?? "",
    functionDeclaration: `function () {
      const clase = this.find((f) => {
        try {
          return typeof f.prototype?.flyTo === "function" &&
            typeof f.prototype?.getCanvasContainer === "function";
        } catch {
          return false;
        }
      });
      return clase?.prototype;
    }`,
    objectGroup: grupo,
  });
  let encontrado = false;
  if (prototipo.result.objectId !== undefined) {
    const mapas = await cdp.send("Runtime.queryObjects", {
      prototypeObjectId: prototipo.result.objectId,
      objectGroup: grupo,
    });
    const puesto = await cdp.send("Runtime.callFunctionOn", {
      objectId: mapas.objects.objectId ?? "",
      functionDeclaration: `function () {
        window.__celdaMapa = this.find((mapa) => mapa.getContainer().isConnected);
        return window.__celdaMapa !== undefined;
      }`,
      returnByValue: true,
    });
    encontrado = puesto.result.value === true;
  }
  await cdp.send("Runtime.releaseObjectGroup", { objectGroup: grupo });
  return encontrado;
};

/**
 * Espera a que el mapa quede quieto y pintado, con todas sus teselas (`idle` de MapLibre), o a
 * que pasen `maximo` ms. Pide un repintado: si ya estaba quieto, `idle` no volvería a llegar.
 */
const esperarQuieto = (pagina: Page, maximo = 10_000): Promise<boolean> =>
  pagina.evaluate(
    (ms) =>
      new Promise<boolean>((resolver) => {
        const mapa = window.__celdaMapa;
        if (mapa === undefined) {
          resolver(false);
          return;
        }
        const plazo = setTimeout(() => resolver(false), ms);
        mapa.once("idle", () => {
          clearTimeout(plazo);
          resolver(true);
        });
        mapa.triggerRepaint();
      }),
    maximo,
  );

/** Un sitio de los recorridos, con su zoom. */
interface Lugar {
  readonly nombre: string;
  readonly centro: Centro;
  readonly zoom: number;
}

const lugar = (nombre: string, centro: Centro, zoom: number): Lugar => ({ nombre, centro, zoom });

const BARCELONA: Centro = [2.17, 41.39];
/** Passeig de Gràcia 68, en el Eixample: el tejado de los recorridos del #61 y el #64. */
const EIXAMPLE: Centro = [2.1625, 41.3934];
const ESPANA = lugar("espana-5,5", [-3.7, 40.2], 5.5);

/*
 * Las órdenes a la cámara van entre llaves y no devuelven nada: `jumpTo` y los demás devuelven el
 * mapa, y Playwright lo serializaría entero, segundos de JavaScript en el hilo principal que no
 * son de Celda.
 */

/** Salta sin animación a `destino`, como al abrir un enlace o elegir un resultado del buscador. */
const saltar = (pagina: Page, destino: Lugar) =>
  pagina.evaluate((l) => {
    window.__celdaMapa?.jumpTo({ center: l.centro, zoom: l.zoom });
  }, destino);

/** Vuela a `destino` en `ms`, como `flyTo` de MapLibre: se aleja, cruza y se acerca. */
const volar = (pagina: Page, destino: Lugar, ms: number) =>
  pagina.evaluate(
    ({ l, duracion }) => {
      window.__celdaMapa?.flyTo({ center: l.centro, zoom: l.zoom, duration: duracion });
    },
    { l: destino, duracion: ms },
  );

/** Acerca o aleja hasta `zoom` en `ms`, sin mover el centro. */
const acercarA = (pagina: Page, zoom: number, ms: number) =>
  pagina.evaluate(
    ({ z, duracion }) => {
      window.__celdaMapa?.easeTo({ zoom: z, duration: duracion });
    },
    { z: zoom, duracion: ms },
  );

/** Centra el mapa en `centro` sin cambiar el zoom, como quien arrastra hasta verlo, y espera. */
const centrarEn = async (pagina: Page, centro: Centro): Promise<void> => {
  await pagina.evaluate((c) => {
    window.__celdaMapa?.jumpTo({ center: c });
  }, centro);
  await esperarQuieto(pagina);
};

/**
 * Deja el hexágono de Barcelona donde se puede tocar. Con la vista de toda España en el móvil de
 * 390 px queda fuera de la pantalla: entonces centra el mapa en Barcelona.
 */
const asomarBarcelona = async (pagina: Page): Promise<Locator> => {
  const hexagono = pagina.getByRole("button", { name: /^Barcelona, / }).first();
  const caja = (await hexagono.count()) > 0 ? await hexagono.boundingBox() : null;
  const seToca =
    caja !== null &&
    caja.x + caja.width / 2 > 30 &&
    caja.x + caja.width / 2 < ANCHO - 60 &&
    caja.y + caja.height / 2 > 160 &&
    caja.y + caja.height / 2 < ALTO - 144;
  if (!seToca) await centrarEn(pagina, BARCELONA);
  return hexagono;
};

/** Graba un gesto con su nombre. */
type Medir = (nombre: string, accion: () => Promise<void>) => Promise<void>;

/**
 * Abre la web y espera a que se vean el mapa base y los marcadores, y tres segundos más para que
 * terminen de llegar las teselas de la primera vista.
 */
const abrirYEsperar = async (pagina: Page, origen: string): Promise<void> => {
  await pagina.goto(new URL(opciones.ruta, origen).href, { waitUntil: "load" });
  await pagina.waitForFunction(
    () => {
      const carga = window.__celda.carga();
      return carga.mapaBase !== undefined && carga.marcadores !== undefined;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );
  await esperar(3000);
};

/** Un grupo de gestos del escenario `vuelos`, que empieza en la vista inicial de la web. */
interface GrupoEnVuelo {
  readonly nombre: string;
  readonly hacer: (pagina: Page, medir: Medir) => Promise<void>;
}

/** Los niveles del #66: del 9,5 al 14,5 y vuelta, uno cada 1,5 s. */
const NIVELES = [10.5, 11.5, 12.5, 13.5, 14.5, 13.5, 12.5, 11.5, 10.5, 9.5];

/** Del 9,5 al 14,5 y vuelta sobre `centro`. */
const niveles = (centro: Lugar): GrupoEnVuelo => ({
  nombre: `niveles-${centro.nombre}`,
  hacer: async (pagina, medir) => {
    await saltar(pagina, centro);
    await esperarQuieto(pagina);
    await medir(`niveles-${centro.nombre}-9,5-14,5`, async () => {
      for (const zoom of NIVELES) {
        await acercarA(pagina, zoom, 500);
        await esperar(1500);
      }
    });
  },
});

/**
 * Los grupos del escenario `vuelos`: saltos de vista en vista (España, València, Barcelona y el
 * Eixample), los cinco vuelos de 2,5 s del #61, alejarse del Eixample a España en 4 s y los
 * niveles del #66 sobre Zaragoza y Barcelona. Cada gesto empieza con el mapa quieto y pintado.
 */
const GRUPOS_EN_VUELO: ReadonlyArray<GrupoEnVuelo> = [
  {
    nombre: "saltos",
    hacer: async (pagina, medir) => {
      await saltar(pagina, ESPANA);
      await esperarQuieto(pagina);
      for (const destino of [
        lugar("valencia-8", [-0.376, 39.47], 8),
        lugar("barcelona-12", BARCELONA, 12),
        lugar("eixample-17", EIXAMPLE, 17),
        lugar("eixample-18", EIXAMPLE, 18),
        ESPANA,
      ]) {
        await medir(`salto-${destino.nombre}`, async () => {
          await saltar(pagina, destino);
          await esperar(2500);
        });
        await esperarQuieto(pagina);
      }
    },
  },
  {
    nombre: "vuelos",
    hacer: async (pagina, medir) => {
      await saltar(pagina, ESPANA);
      await esperarQuieto(pagina);
      for (const destino of [
        lugar("cataluna-8", [1.7, 41.75], 8),
        lugar("barcelona-12", BARCELONA, 12),
        lugar("eixample-17", EIXAMPLE, 17),
        lugar("barcelona-11", BARCELONA, 11),
        ESPANA,
      ]) {
        await medir(`vuelo-${destino.nombre}`, async () => {
          await volar(pagina, destino, 2500);
          await esperar(2500);
        });
        await esperarQuieto(pagina);
      }
    },
  },
  {
    nombre: "alejar",
    hacer: async (pagina, medir) => {
      await saltar(pagina, lugar("eixample-17", EIXAMPLE, 17));
      await esperarQuieto(pagina);
      await medir("alejar-del-eixample-a-espana", async () => {
        await acercarA(pagina, ESPANA.zoom, 4000);
        await esperar(4000);
      });
    },
  },
  niveles(lugar("zaragoza", [-0.8891, 41.6488], 9.5)),
  niveles(lugar("barcelona", BARCELONA, 9.5)),
];

interface Ronda {
  readonly cpu: number;
  readonly carga: {
    readonly mapaBase: number | undefined;
    readonly marcadores: number | undefined;
    readonly detalle: number | undefined;
    readonly lcp: number | undefined;
    readonly tesela: number | undefined;
    readonly resumen: number | undefined;
    readonly capa: number | undefined;
    readonly bytes: number;
    readonly peticiones: number;
    readonly porOrigen: Readonly<Record<string, { bytes: number; peticiones: number }>>;
    readonly tareasLargas: number;
    readonly tareaMasLarga: number;
    readonly bloqueo: number;
  };
  readonly gestos: Readonly<Record<string, Fotogramas>>;
  readonly marcadores: Readonly<Record<string, Awaited<ReturnType<typeof contarMarcadores>>>>;
  /** La segunda visita, con la caché HTTP de la primera. */
  readonly repetida: {
    readonly mapaBase: number | undefined;
    readonly marcadores: number | undefined;
  };
  readonly ficha: {
    readonly fria: number | undefined;
    readonly vecina: number | undefined;
    readonly enCache: number | undefined;
  };
  readonly inp: number;
  /** Las interacciones más lentas, para saber de dónde sale el INP. */
  readonly interacciones: ReadonlyArray<{ readonly duracion: number; readonly tipo: string }>;
  readonly trazas: Readonly<Record<string, ResumenDeTraza>>;
  /** Tras el escenario de España: memoria de la página y sus Workers, y del hilo principal. */
  readonly memoria: { readonly total: number | undefined; readonly hilo: number | undefined };
  /** Tras el escenario de España: lo pedido de las capas, en total. */
  readonly capasTrasElRecorrido: { readonly bytes: number; readonly peticiones: number };
}

const ronda = async (
  navegador: Awaited<ReturnType<typeof chromium.launch>>,
  origen: string,
  cpu: number,
  trazas: string | undefined,
): Promise<Ronda> => {
  const contexto = await abrirContexto(navegador);
  const pagina = await contexto.newPage();
  const cdp = await contexto.newCDPSession(pagina);
  await frenar(cdp, cpu);
  const red = seguirRed(pagina);

  await abrirYEsperar(pagina, origen);
  const carga = await pagina.evaluate(() => window.__celda.carga());
  if (!(await atraparMapa(cdp))) {
    process.stderr.write(
      "  no se encuentra el mapa de MapLibre: los gestos de cámara no harán nada\n",
    );
  }
  const peticiones = await red.peticiones(await pagina.evaluate(() => performance.timeOrigin));
  if (opciones.cascada === true) {
    for (const p of [...peticiones].sort((a, b) => a.inicio - b.inicio)) {
      process.stderr.write(
        `${p.inicio.toFixed(0).padStart(6)} ${(p.fin ?? 0).toFixed(0).padStart(6)} ${(p.bytes / 1024).toFixed(1).padStart(7)} KB  ${p.url.slice(0, 110)}\n`,
      );
    }
    process.stderr.write(
      `mapa base ${carga.mapaBase?.toFixed(0)}, marcadores ${carga.marcadores?.toFixed(0)}, LCP ${carga.lcp?.toFixed(0)} en ${carga.elementoLcp}\n`,
    );
  }
  const porOrigen: Record<string, { bytes: number; peticiones: number }> = {};
  for (const peticion of peticiones) {
    const url = new URL(peticion.url);
    const clave =
      url.origin === origen ? (url.pathname.startsWith("/capas/") ? "capas" : "web") : url.host;
    const actual = porOrigen[clave] ?? { bytes: 0, peticiones: 0 };
    actual.bytes += peticion.bytes;
    actual.peticiones += 1;
    porOrigen[clave] = actual;
  }
  const primera = (patron: RegExp) =>
    peticiones
      .filter((p) => patron.test(p.url) && p.fin !== undefined)
      .map((p) => p.fin ?? 0)
      .sort((a, b) => a - b)[0];

  const gestos: Record<string, Fotogramas> = {};
  const marcadores: Record<string, Awaited<ReturnType<typeof contarMarcadores>>> = {};
  const resumenes: Record<string, ResumenDeTraza> = {};
  const medirEn =
    (enPagina: Page, enCdp: CDPSession): Medir =>
    async (nombre, accion) => {
      const hecho = await grabar(
        enPagina,
        enCdp,
        nombre,
        accion,
        trazas === undefined ? undefined : NodePath.join(trazas, `cpu${cpu}`),
      );
      gestos[nombre] = hecho.fotogramas;
      if (hecho.traza !== undefined) resumenes[nombre] = hecho.traza;
    };
  const medir = medirEn(pagina, cdp);

  let ficha: Ronda["ficha"] = { fria: undefined, vecina: undefined, enCache: undefined };
  let memoria: Ronda["memoria"] = { total: undefined, hilo: undefined };
  /**
   * Varias provincias: de la vista inicial a toda España con el resumen, de ahí a Barcelona y a
   * la calle, vuelta al nivel de provincias y cruzar de una a otra. Al acabar, la memoria.
   */
  const recorridoPorEspana = async () => {
    await esperar(500);
    marcadores.inicio = await contarMarcadores(pagina);
    await medir("alejar-a-espana", () => pulsar(pagina, "Alejar", 6));
    marcadores.espana = await contarMarcadores(pagina);
    // Con toda España a la vista, los límites del mapa lo han centrado: se vuelve a Barcelona
    // tocando su hexágono, como haría una persona.
    const hexagono = await asomarBarcelona(pagina);
    await medir("abrir-provincia", async () => {
      await tocar(hexagono);
      await esperar(1200);
    });
    marcadores.provincia = await contarMarcadores(pagina);
    // Del zoom 8 al 11: los municipios de alrededor de Manresa.
    await medir("acercar-a-municipios", () => pulsar(pagina, "Acercar", 3));
    marcadores.municipios = await contarMarcadores(pagina);
    await medir("municipios-arrastre", () => arrastrar(cdp));
    await medir("municipios-pellizco", () => pellizcar(cdp));
    await medir("acercar-a-calle", () => abrirAgrupaciones(pagina, 6));
    marcadores.calle = await contarMarcadores(pagina);
    await medir("alejar-a-provincias", () => pulsar(pagina, "Alejar", 6));
    marcadores.provincias = await contarMarcadores(pagina);
    // Hacia el oeste y el norte, cruzando bordes de provincia, y vuelta.
    await medir("cruzar-provincias", async () => {
      for (const [dx, dy] of [
        [300, 0],
        [300, 0],
        [300, 150],
        [-300, -150],
        [-300, 0],
        [-300, 0],
      ] as const) {
        await arrastrarUnaVez(cdp, dx, dy);
      }
    });
    marcadores.cruzar = await contarMarcadores(pagina);
    await esperar(1500);
    memoria = await medirMemoria(pagina, cdp);
  };
  /**
   * Junto al borde de dos provincias, con la vista abierta en un emplazamiento: celdas e
   * interferencia necesitan las dos. Cada arrastre cruza el borde de ida o de vuelta.
   */
  const recorridoPorElBorde = async () => {
    await esperar(1500);
    await medir("cerrar-ficha", async () => {
      await tocar(pagina.getByRole("button", { name: "Cerrar", exact: true }).first());
      await pagina.waitForSelector("article[aria-label]", { state: "detached" });
      await esperar(1200);
    });
    marcadores.borde = await contarMarcadores(pagina);
    const cruzar = async () => {
      // A zoom 16, 500 px son unos 600 m: de un lado del borde al otro.
      for (const [dx, dy] of [
        [500, 0],
        [-500, 0],
        [-500, 100],
        [500, -100],
      ] as const) {
        await arrastrarUnaVez(cdp, dx, dy);
      }
    };
    await medir("cruzar-con-celdas", cruzar);
    await medir("abrir-interferencia", async () => {
      await pulsar(pagina, "Interferencia", 1);
      await esperar(1500);
    });
    await medir("cruzar-con-interferencia", cruzar);
    await medir("alejar-y-acercar", async () => {
      await pulsar(pagina, "Alejar", 2);
      await pulsar(pagina, "Acercar", 2);
    });
    marcadores.final = await contarMarcadores(pagina);
    await esperar(1500);
    memoria = await medirMemoria(pagina, cdp);
  };
  /**
   * Los recorridos del #61 y el #66 con la cámara de MapLibre (#67). La primera página los hace
   * todos sin medir, para que la caché HTTP tenga las teselas y la red no meta ruido. Después cada
   * grupo de gestos va en una página nueva, con un mapa sin teselas en memoria: así un grupo no se
   * aprovecha de lo que dejó el anterior, y alejarse del Eixample parte o no de lo mismo en todas
   * las rondas.
   */
  const recorridoEnVuelo = async () => {
    const elegidos = opciones.grupos?.split(",");
    const grupos = GRUPOS_EN_VUELO.filter(
      (grupo) => elegidos === undefined || elegidos.includes(grupo.nombre),
    );
    for (const grupo of grupos) {
      await grupo.hacer(pagina, async (_nombre, accion) => {
        await accion();
      });
    }
    for (const grupo of grupos) {
      const otra = await contexto.newPage();
      const cdpOtra = await contexto.newCDPSession(otra);
      await frenar(cdpOtra, cpu);
      await abrirYEsperar(otra, origen);
      await atraparMapa(cdpOtra);
      await grupo.hacer(otra, medirEn(otra, cdpOtra));
      if (grupo.nombre === "saltos") marcadores.espana = await contarMarcadores(otra);
      await otra.close();
    }
  };
  const gestosYFicha = async () => {
    // La vista inicial es lo que Celda tiene, de lejos (#52). Se va a Barcelona entera como haría
    // una persona: su hexágono, la ciudad en el centro y tres veces Acercar, hasta el zoom 10,7 o
    // así. El hexágono va en el centro de la provincia (ADR 0024), lejos de la ciudad.
    await esperar(500);
    await tocar(await asomarBarcelona(pagina));
    await esperar(1200);
    await centrarEn(pagina, BARCELONA);
    await pulsar(pagina, "Acercar", 3);
    await esperar(1500);
    // Lejos: Barcelona entera.
    marcadores.lejos = await contarMarcadores(pagina);
    await medir("lejos-arrastre", () => arrastrar(cdp));
    await medir("lejos-pellizco", () => pellizcar(cdp));
    await medir("lejos-rueda", () => rueda(cdp));
    // Con los botones hasta el nivel de barrios y el de hexágonos.
    await medir("botones-acercar", () => pulsar(pagina, "Acercar", 3));
    marcadores.medio = await contarMarcadores(pagina);
    await medir("medio-arrastre", () => arrastrar(cdp));
    await medir("medio-pellizco", () => pellizcar(cdp));
    await medir("medio-rueda", () => rueda(cdp));
    // Al nivel 16, el último con agrupaciones: casi todo son logos sueltos.
    await medir("botones-acercar-cerca", () => pulsar(pagina, "Acercar", 2));
    marcadores.cerca = await contarMarcadores(pagina);
    await medir("cerca-arrastre", () => arrastrar(cdp));
    await medir("cerca-pellizco", () => pellizcar(cdp));
    await medir("cerca-rueda", () => rueda(cdp));

    // La ficha: la primera vez con su lote por la red, luego una vecina y otra vez la primera.
    const fria = await tocarFicha(pagina, CENTRO);
    let vecina: number | undefined;
    let enCache: number | undefined;
    if (fria !== undefined) {
      await cerrarFicha(pagina);
      const otra = await tocarFicha(pagina, { x: fria.punto.x + 60, y: fria.punto.y + 60 });
      vecina = otra?.ms;
      await cerrarFicha(pagina);
      enCache = (await tocarFicha(pagina, fria.punto))?.ms;
      await cerrarFicha(pagina);
    }
    await medir("botones-alejar", () => pulsar(pagina, "Alejar", 5));

    ficha = { fria: fria?.ms, vecina, enCache };
  };
  if (opciones["solo-carga"] !== true) {
    await (opciones.escenario === "espana"
      ? recorridoPorEspana()
      : opciones.escenario === "borde"
        ? recorridoPorElBorde()
        : opciones.escenario === "vuelos"
          ? recorridoEnVuelo()
          : gestosYFicha());
  }
  const trasElRecorrido = (
    await red.peticiones(await pagina.evaluate(() => performance.timeOrigin))
  ).filter((p) => new URL(p.url).pathname.startsWith("/capas/"));
  const interacciones = await pagina.evaluate(() => window.__celda.interacciones());
  // Otra visita con la caché HTTP de la primera: lo que ve quien vuelve.
  const otra = await contexto.newPage();
  const cdpOtra = await contexto.newCDPSession(otra);
  await frenar(cdpOtra, cpu);
  await otra.goto(origen, { waitUntil: "load" });
  await otra.waitForFunction(
    () => {
      const carga = window.__celda.carga();
      return carga.mapaBase !== undefined && carga.marcadores !== undefined;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );
  const repetida = await otra.evaluate(() => window.__celda.carga());
  await contexto.close();
  const bytes = peticiones.reduce((a, p) => a + p.bytes, 0);
  return {
    cpu,
    carga: {
      mapaBase: carga.mapaBase,
      marcadores: carga.marcadores,
      detalle: carga.detalle,
      lcp: carga.lcp,
      tesela: primera(/tiles\.openfreemap\.org\/planet\/.*\.pbf/u),
      resumen: primera(/\/capas\/resumen@/u),
      capa: primera(/\/capas\/provincias\//u),
      bytes,
      peticiones: peticiones.length,
      porOrigen,
      tareasLargas: carga.tareasLargas.length,
      tareaMasLarga: Math.max(0, ...carga.tareasLargas.map((t) => t.duracion)),
      bloqueo: carga.tareasLargas.reduce((a, t) => a + Math.max(0, t.duracion - 50), 0),
    },
    gestos,
    marcadores,
    repetida: { mapaBase: repetida.mapaBase, marcadores: repetida.marcadores },
    ficha,
    memoria,
    capasTrasElRecorrido: {
      bytes: trasElRecorrido.reduce((a, p) => a + p.bytes, 0),
      peticiones: trasElRecorrido.length,
    },
    inp: Math.max(0, ...interacciones.map((i) => i.duracion)),
    interacciones: [...interacciones].sort((a, b) => b.duracion - a.duracion).slice(0, 5),
    trazas: resumenes,
  };
};

const mediana = (valores: ReadonlyArray<number | undefined>): number | undefined => {
  const definidos = valores.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (definidos.length === 0) return undefined;
  const mitad = Math.floor(definidos.length / 2);
  return definidos.length % 2 === 1
    ? definidos[mitad]
    : ((definidos[mitad - 1] ?? 0) + (definidos[mitad] ?? 0)) / 2;
};

const f = (v: number | undefined, decimales = 0) => (v === undefined ? "—" : v.toFixed(decimales));

/**
 * Cuánto cambia un valor de una ronda a otra: el menor, el mayor y la desviación típica. Una
 * diferencia entre dos webs menor que esto es ruido de la máquina.
 */
const dispersion = (valores: ReadonlyArray<number | undefined>): string => {
  const definidos = valores.filter((v): v is number => v !== undefined);
  if (definidos.length < 2) return "—";
  const media = definidos.reduce((a, b) => a + b, 0) / definidos.length;
  const varianza = definidos.reduce((a, b) => a + (b - media) ** 2, 0) / (definidos.length - 1);
  return `${Math.min(...definidos).toFixed(1)}–${Math.max(...definidos).toFixed(1)} · σ ${Math.sqrt(varianza).toFixed(1)}`;
};

const informe = (rondas: ReadonlyArray<Ronda>): string => {
  const lineas: Array<string> = [];
  for (const cpu of new Set(rondas.map((r) => r.cpu))) {
    const suyas = rondas.filter((r) => r.cpu === cpu);
    const m = (leer: (r: Ronda) => number | undefined) => mediana(suyas.map(leer));
    lineas.push(`\n## CPU ×${cpu} (mediana de ${suyas.length})\n`);
    lineas.push("| Carga | ms |", "|---|---|");
    lineas.push(`| Primera tesela recibida | ${f(m((r) => r.carga.tesela))} |`);
    lineas.push(`| Mapa base visible | ${f(m((r) => r.carga.mapaBase))} |`);
    lineas.push(`| Resumen recibido | ${f(m((r) => r.carga.resumen))} |`);
    lineas.push(`| Primera capa de provincia recibida | ${f(m((r) => r.carga.capa))} |`);
    lineas.push(`| Primeros marcadores | ${f(m((r) => r.carga.marcadores))} |`);
    lineas.push(`| Primeros emplazamientos o agrupaciones | ${f(m((r) => r.carga.detalle))} |`);
    lineas.push(`| LCP | ${f(m((r) => r.carga.lcp))} |`);
    lineas.push(
      `| Tareas largas (n / la mayor / bloqueo total) | ${f(m((r) => r.carga.tareasLargas))} / ${f(m((r) => r.carga.tareaMasLarga))} / ${f(m((r) => r.carga.bloqueo))} |`,
    );
    lineas.push(
      `| Visita repetida: mapa base / marcadores | ${f(m((r) => r.repetida.mapaBase))} / ${f(m((r) => r.repetida.marcadores))} |`,
    );
    lineas.push(
      `| Bytes / peticiones | ${f(m((r) => r.carga.bytes / 1024))} KB / ${f(m((r) => r.carga.peticiones))} |`,
    );
    const origenes = new Set(suyas.flatMap((r) => Object.keys(r.carga.porOrigen)));
    for (const origen of origenes) {
      lineas.push(
        `| · ${origen} | ${f(m((r) => (r.carga.porOrigen[origen]?.bytes ?? 0) / 1024))} KB / ${f(m((r) => r.carga.porOrigen[origen]?.peticiones ?? 0))} |`,
      );
    }
    lineas.push(
      "\n| Gesto | fps | fps por ronda | p95 ms | máx ms | >20 ms | >50 ms | LoAF | peor LoAF |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const gesto of Object.keys(suyas[0]?.gestos ?? {})) {
      const g = (leer: (x: Fotogramas) => number) =>
        m((r) => {
          const x = r.gestos[gesto];
          return x === undefined ? undefined : leer(x);
        });
      const peor = suyas
        .map((r) => r.gestos[gesto]?.peorLoaf)
        .reduce((a, b) => ((b?.duracion ?? 0) > (a?.duracion ?? 0) ? b : a), undefined);
      lineas.push(
        `| ${gesto} | ${f(
          g((x) => x.fps),
          1,
        )} | ${dispersion(suyas.map((r) => r.gestos[gesto]?.fps))} | ${f(
          g((x) => x.p95),
          1,
        )} | ${f(g((x) => x.maximo))} | ${f(g((x) => x.perdidos))} | ${f(g((x) => x.mas50))} | ${f(g((x) => x.loaf))} | ${peor === undefined || peor.duracion === 0 ? "—" : `${Math.round(peor.duracion)} ms (estilo ${Math.round(peor.estilo)}) ${peor.guion}`} |`,
      );
    }
    lineas.push("\n| Ficha | ms |", "|---|---|");
    lineas.push(`| Primera, con su lote por la red | ${f(m((r) => r.ficha.fria))} |`);
    lineas.push(`| Vecina | ${f(m((r) => r.ficha.vecina))} |`);
    lineas.push(`| La primera otra vez (lote en caché) | ${f(m((r) => r.ficha.enCache))} |`);
    lineas.push(`| INP de toda la sesión | ${f(m((r) => r.inp))} |`);
    lineas.push(
      `\nCapas tras el recorrido: ${f(m((r) => r.capasTrasElRecorrido.bytes / 1024))} KB / ${f(m((r) => r.capasTrasElRecorrido.peticiones))} peticiones`,
    );
    lineas.push(
      `Memoria: ${f(m((r) => (r.memoria.total === undefined ? undefined : r.memoria.total / 1048576)))} MB página y Workers, ${f(m((r) => (r.memoria.hilo === undefined ? undefined : r.memoria.hilo / 1048576)))} MB de montón del hilo principal`,
    );
    lineas.push(
      `\nInteracciones más lentas: ${suyas.map((r) => r.interacciones.map((i) => `${i.tipo} ${Math.round(i.duracion)}`).join(", ")).join(" · ")}`,
    );
    const primera = suyas[0];
    if (primera !== undefined) lineas.push(`\nMarcadores: ${JSON.stringify(primera.marcadores)}`);
  }
  return lineas.join("\n");
};

const informeDeTrazas = (trazada: Ronda): string => {
  const lineas: Array<string> = [];
  for (const [gesto, traza] of Object.entries(trazada.trazas)) {
    lineas.push(`\nTraza de ${gesto} (CPU ×${trazada.cpu}):`);
    for (const hilo of traza.hilos.slice(0, 5)) {
      const grupos = Object.entries(hilo.grupos)
        .sort((a, b) => b[1] - a[1])
        .map(([g, ms]) => `${g} ${ms.toFixed(0)}`)
        .join(", ");
      lineas.push(`- ${hilo.hilo}: ${hilo.total.toFixed(0)} ms (${grupos})`);
      const eventos = hilo.eventos.slice(0, 8).map(([n, ms]) => `${n} ${ms.toFixed(0)}`);
      lineas.push(`  ${eventos.join(", ")}`);
    }
  }
  return lineas.join("\n");
};

const principal = async () => {
  // Varias webs a la vez (`--web antes,despues`): las rondas se alternan, así el ruido de la
  // máquina reparte igual entre ellas.
  const webs = opciones.web.split(",").map((web) => NodePath.resolve(web));
  const sitios = await Promise.all(
    webs.map((web) =>
      servirSitio(
        web,
        NodePath.resolve(capas),
        opciones.escenario === "espana" || opciones.escenario === "borde",
      ),
    ),
  );
  const navegador = await chromium.launch({
    executablePath: opciones.chromium,
    args: [
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader=false",
    ],
  });
  const rondas = webs.map((): Array<Ronda> => []);
  try {
    for (const cpu of opciones.cpu.split(",").map(Number)) {
      for (let i = 0; i < Number(opciones.repeticiones); i += 1) {
        for (const [j, sitio] of sitios.entries()) {
          await esperarCalma();
          process.stderr.write(`${webs[j] ?? ""}: CPU ×${cpu}, ronda ${i + 1}…\n`);
          rondas[j]?.push(await ronda(navegador, sitio.origen, cpu, undefined));
        }
      }
    }
    // La traza frena lo que mide: va en una ronda aparte que no cuenta en las medianas.
    if (opciones.trazas !== undefined) {
      const cpu = Number(opciones.cpu.split(",")[0]);
      for (const [j, sitio] of sitios.entries()) {
        await esperarCalma();
        process.stderr.write(`${webs[j] ?? ""}: CPU ×${cpu}, ronda con traza…\n`);
        const carpeta = NodePath.join(opciones.trazas, NodePath.basename(webs[j] ?? `${j}`));
        const trazada = await ronda(navegador, sitio.origen, cpu, carpeta);
        process.stdout.write(`\n# ${webs[j] ?? ""}\n${informeDeTrazas(trazada)}\n`);
      }
    }
  } finally {
    await navegador.close();
    await Promise.all(sitios.map((sitio) => sitio.cerrar()));
  }
  if (opciones.json !== undefined) {
    await NodeFSP.writeFile(
      opciones.json,
      JSON.stringify(Object.fromEntries(webs.map((w, j) => [w, rondas[j]])), null, 2),
    );
  }
  for (const [j, web] of webs.entries()) {
    process.stdout.write(`\n# ${web}\n${informe(rondas[j] ?? [])}\n`);
  }
};

await principal();
