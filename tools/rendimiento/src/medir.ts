// La medida no usa Effect: Playwright es de promesas y el script corre con Node tal cual.
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { type BrowserContext, type CDPSession, chromium, type Page } from "playwright-core";

import { type FotogramasEnPagina, instalar } from "./pagina.ts";
import { servirSitio } from "./sitio.ts";
import { resumirPerfil, type ResumenDeTraza, resumirTraza } from "./traza.ts";

/**
 * Mide la carga y la fluidez de Celda en un móvil simulado: Chromium sin interfaz con GPU, a
 * 390 × 844 con DPR 2,6, la CPU frenada por CDP y la red de «Fast 4G» de DevTools. El mapa base
 * viene de OpenFreeMap de verdad, así que hace falta conexión. Ver docs/patterns/rendimiento.md.
 *
 *   pnpm run medir -- --capas <carpeta publicada> [--web ../../apps/web/dist] [--cpu 4,6]
 *                     [--repeticiones 3] [--trazas <carpeta>] [--json <fichero>]
 */

const { values: opciones } = NodeUtil.parseArgs({
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

const ANCHO = 390;
const ALTO = 844;

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
  const contexto = await navegador.newContext({
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: 2.6,
    isMobile: true,
    hasTouch: true,
    locale: "es-ES",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  });
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

const CENTRO = { x: ANCHO / 2, y: 420 };

/**
 * Arrastra el mapa con un dedo, ida y vuelta, a unos 60 eventos por segundo. `synthesizeScrollGesture`
 * no sirve: el navegador se queda el gesto como desplazamiento y MapLibre no recibe `touchmove`.
 */
const arrastrar = async (cdp: CDPSession) => {
  const pasos = 40;
  for (const [dx, dy] of [
    [-220, -160],
    [220, 160],
  ] as const) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [CENTRO] });
    for (let i = 1; i <= pasos; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: CENTRO.x + (dx * i) / pasos, y: CENTRO.y + (dy * i) / pasos }],
      });
      await esperar(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await esperar(200);
  }
};

const pellizcar = async (cdp: CDPSession) => {
  for (const escala of [1.8, 1 / 1.8]) {
    await cdp.send("Input.synthesizePinchGesture", {
      x: CENTRO.x,
      y: CENTRO.y,
      scaleFactor: escala,
      relativeSpeed: 500,
      gestureSourceType: "touch",
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
      await menu.tap();
      await esperar(150);
    }
    await boton.tap();
    await esperar(700);
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
  const objetivo = await pagina.evaluate((punto) => {
    const lamina = document.querySelector('section[aria-label="Emplazamientos"]');
    const candidatos = [...(lamina?.querySelectorAll(":scope > button[data-estado]") ?? [])]
      .map((b) => {
        const caja = b.getBoundingClientRect();
        return { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
      })
      // Lejos de la cabecera, de los controles de la derecha y de la hoja de abajo.
      .filter((c) => c.x > 30 && c.x < 300 && c.y > 160 && c.y < 520)
      .sort(
        (a, b) =>
          Math.hypot(a.x - punto.x, a.y - punto.y) - Math.hypot(b.x - punto.x, b.y - punto.y),
      );
    return candidatos[0];
  }, cerca);
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
    if (peticion.url().includes("/fichas@")) lotes += 1;
  };
  pagina.on("request", contar);
  await pagina.touchscreen.tap(objetivo.x, objetivo.y);
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

interface Ronda {
  readonly cpu: number;
  readonly carga: {
    readonly mapaBase: number | undefined;
    readonly marcadores: number | undefined;
    readonly lcp: number | undefined;
    readonly tesela: number | undefined;
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

  await pagina.goto(origen, { waitUntil: "load" });
  await pagina.waitForFunction(
    () => {
      const carga = window.__celda.carga();
      return carga.mapaBase !== undefined && carga.marcadores !== undefined;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );
  // Que terminen de llegar las teselas de la primera vista.
  await esperar(3000);
  const carga = await pagina.evaluate(() => window.__celda.carga());
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
  const medir = async (nombre: string, accion: () => Promise<void>) => {
    const hecho = await grabar(
      pagina,
      cdp,
      nombre,
      accion,
      trazas === undefined ? undefined : NodePath.join(trazas, `cpu${cpu}`),
    );
    gestos[nombre] = hecho.fotogramas;
    if (hecho.traza !== undefined) resumenes[nombre] = hecho.traza;
  };

  let ficha: Ronda["ficha"] = { fria: undefined, vecina: undefined, enCache: undefined };
  const gestosYFicha = async () => {
    // Lejos: la vista inicial, Barcelona entera.
    await esperar(500);
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
  if (opciones["solo-carga"] !== true) await gestosYFicha();
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
      lcp: carga.lcp,
      tesela: primera(/tiles\.openfreemap\.org\/planet\/.*\.pbf/u),
      capa: primera(/\/capas\/sitios@/u),
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

const informe = (rondas: ReadonlyArray<Ronda>): string => {
  const lineas: Array<string> = [];
  for (const cpu of new Set(rondas.map((r) => r.cpu))) {
    const suyas = rondas.filter((r) => r.cpu === cpu);
    const m = (leer: (r: Ronda) => number | undefined) => mediana(suyas.map(leer));
    lineas.push(`\n## CPU ×${cpu} (mediana de ${suyas.length})\n`);
    lineas.push("| Carga | ms |", "|---|---|");
    lineas.push(`| Primera tesela recibida | ${f(m((r) => r.carga.tesela))} |`);
    lineas.push(`| Mapa base visible | ${f(m((r) => r.carga.mapaBase))} |`);
    lineas.push(`| Capa recibida | ${f(m((r) => r.carga.capa))} |`);
    lineas.push(`| Primeros marcadores | ${f(m((r) => r.carga.marcadores))} |`);
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
      "\n| Gesto | fps | p95 ms | máx ms | >20 ms | >50 ms | LoAF | peor LoAF |",
      "|---|---|---|---|---|---|---|---|",
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
        )} | ${f(
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
  const sitios = await Promise.all(webs.map((web) => servirSitio(web, NodePath.resolve(capas))));
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
