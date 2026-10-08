// La prueba no usa Effect: Playwright es de promesas y el script corre con Node tal cual.
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalConsole:off globalFetch:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { chromium, type Page } from "playwright-core";

import { escribirCapaSintetica } from "./capaSintetica.ts";
import { atraparMapa, mapaBaseFalso } from "./mapa.ts";
import { servirSitio } from "./sitio.ts";

/**
 * Prueba en el navegador del paso entre la vista de puntos y los logos (ADR 0028, #74): los puntos
 * del DOM que salen de los logos al alejar, o van a ellos al acercar, tienen que estar siempre en
 * el sitio de su emplazamiento, aunque el zoom siga cambiando a mitad del paso. Colocados solo al
 * empezar, se separaban hasta 360 px de su sitio mientras el mapa seguía alejándose.
 *
 * Abre la web construida en Chromium sin interfaz con la capa sintética (`capaSintetica.ts`), el
 * mapa base con teselas vacías y WebGL por SwiftShader, sin GPU ni conexión. Desde el zoom 15,5,
 * con los logos a la vista, hace cada gesto con la CPU sin frenar y frenada. En cada fotograma,
 * después de que MapLibre pinte, compara el centro de cada punto que se mueve con
 * `map.project` de su emplazamiento. Falla si alguno se separa más de 1 px, o si en un gesto que
 * cruza el zoom 15 al alejar no se ve ninguno: entonces la prueba no probaría nada.
 *
 *   pnpm run deriva [--web ../../apps/web/dist] [--cpu 1,4] [--chromium <ruta>]
 */

const { values: opciones } = NodeUtil.parseArgs({
  args: process.argv.slice(2).filter((argumento) => argumento !== "--"),
  options: {
    web: { type: "string", default: "../../apps/web/dist" },
    cpu: { type: "string", default: "1,4" },
    chromium: { type: "string", default: process.env.CELDA_CHROMIUM ?? "/usr/bin/chromium" },
  },
});

/** Lo más que se puede separar un punto de su sitio, en px CSS. */
const TOLERANCIA_PX = 1;

interface Medida {
  /** Cuántas veces se ha medido un punto, y en cuántos fotogramas había alguno. */
  readonly muestras: number;
  readonly fotogramas: number;
  readonly puntos: number;
  readonly media: number;
  readonly maximo: number;
  /** El zoom del fotograma con el peor punto. */
  readonly zoomDelMaximo: number;
}

declare global {
  interface Window {
    __deriva: {
      readonly empezar: () => void;
      readonly parar: () => Medida;
    };
  }
}

/**
 * Instala la medida en la página: al pintar cada fotograma, mide los puntos que se mueven frente
 * al emplazamiento de `sitios` del que salen. Se ejecuta en el navegador.
 */
const instalarMedida = (sitios: ReadonlyArray<[number, number]>): void => {
  const mapa = window.__celdaMapa;
  if (mapa === undefined) throw new Error("No se encuentra el mapa de MapLibre de la página");
  const suyo = new WeakMap<Element, [number, number]>();
  const traslado = (elemento: Element | null): { x: number; y: number } => {
    const estilo = elemento instanceof HTMLElement ? elemento.style.transform : "";
    const partes = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/u.exec(estilo);
    return partes === null ? { x: 0, y: 0 } : { x: Number(partes[1]), y: Number(partes[2]) };
  };
  let errores: Array<number> = [];
  let fotogramas = 0;
  let puntos = 0;
  let peor = { error: 0, zoom: 0 };
  const medir = () => {
    // Los puntos que se mueven son los círculos de una lámina sin marcadores ni nombre.
    const circulos = document.querySelectorAll(
      'div[aria-hidden="true"] > span > span.rounded-full',
    );
    if (circulos.length > 0) fotogramas += 1;
    for (const circulo of circulos) {
      const punto = circulo.parentElement;
      const radio = Number.parseFloat(punto?.style.width ?? "0") / 2;
      const propio = traslado(punto);
      const lamina = traslado(punto?.parentElement ?? null);
      const x = propio.x + radio + lamina.x;
      const y = propio.y + radio + lamina.y;
      let sitio = suyo.get(circulo);
      if (sitio === undefined) {
        // El emplazamiento más cercano al aparecer: si ya aparece lejos, el error lo dice.
        let mejor: { sitio: [number, number]; distancia: number } | undefined;
        for (const candidato of sitios) {
          const p = mapa.project(candidato);
          const distancia = Math.hypot(p.x - x, p.y - y);
          if (mejor === undefined || distancia < mejor.distancia) {
            mejor = { sitio: candidato, distancia };
          }
        }
        if (mejor === undefined) continue;
        sitio = mejor.sitio;
        suyo.set(circulo, sitio);
        puntos += 1;
      }
      const p = mapa.project(sitio);
      const error = Math.hypot(p.x - x, p.y - y);
      errores.push(error);
      if (error > peor.error) peor = { error, zoom: mapa.getZoom() };
    }
  };
  // Tras el `flush` de Solid, que va en una microtarea pedida antes que esta.
  const alPintar = () => queueMicrotask(medir);
  window.__deriva = {
    empezar: () => {
      errores = [];
      fotogramas = 0;
      puntos = 0;
      peor = { error: 0, zoom: 0 };
      mapa.on("render", alPintar);
    },
    parar: () => {
      mapa.off("render", alPintar);
      return {
        muestras: errores.length,
        fotogramas,
        puntos,
        media: errores.length === 0 ? 0 : errores.reduce((a, b) => a + b, 0) / errores.length,
        maximo: peor.error,
        zoomDelMaximo: peor.zoom,
      };
    },
  };
};

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** Espera a que el mapa quede quieto y pintado, o a que pasen `maximo` ms. */
const quieto = (pagina: Page, maximo = 15_000): Promise<boolean> =>
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

/**
 * Una serie de `easeTo` en línea recta, cada uno empezado en el reloj de la página a los `en` ms
 * del primero: así un cambio de sentido llega a mitad del anterior aunque la CPU vaya frenada.
 */
type Tramo = { readonly en: number; readonly zoom: number; readonly ms: number };

const recorrer = (pagina: Page, tramos: ReadonlyArray<Tramo>) =>
  pagina.evaluate(
    (lista) =>
      new Promise<void>((resolver) => {
        const mapa = window.__celdaMapa;
        const inicio = performance.now();
        let siguiente = 0;
        const latir = () => {
          const ahora = performance.now() - inicio;
          const tramo = lista[siguiente];
          if (tramo !== undefined && ahora >= tramo.en) {
            mapa?.easeTo({ zoom: tramo.zoom, duration: tramo.ms, easing: (t) => t });
            siguiente += 1;
          }
          if (siguiente >= lista.length) {
            resolver();
            return;
          }
          requestAnimationFrame(latir);
        };
        latir();
      }),
    tramos,
  );

interface Gesto {
  readonly nombre: string;
  readonly desde: number;
  readonly tramos: ReadonlyArray<Tramo>;
  /** Si cruza el zoom 15 alejando: entonces tiene que haber puntos que se mueven. */
  readonly conPuntos: boolean;
}

const GESTOS: ReadonlyArray<Gesto> = [
  {
    nombre: "Alejar del 15,5 al 13 de un tirón",
    desde: 15.5,
    tramos: [{ en: 0, zoom: 13, ms: 900 }],
    conPuntos: true,
  },
  {
    nombre: "Alejar, acercar a mitad del paso y alejar otra vez",
    desde: 15.5,
    tramos: [
      { en: 0, zoom: 14.6, ms: 350 },
      { en: 320, zoom: 15.4, ms: 300 },
      { en: 600, zoom: 13.5, ms: 600 },
    ],
    conPuntos: true,
  },
  {
    nombre: "Acercar del 14,3 al 15,8",
    desde: 14.3,
    tramos: [{ en: 0, zoom: 15.8, ms: 900 }],
    conPuntos: false,
  },
];

const principal = async () => {
  const temporal = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "celda-deriva-"));
  const capa = await escribirCapaSintetica(temporal);
  const sitio = await servirSitio(NodePath.resolve(opciones.web), capa.carpeta);
  const navegador = await chromium.launch({
    executablePath: opciones.chromium,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  let fallo = false;
  try {
    const contexto = await navegador.newContext({
      viewport: { width: 1100, height: 850 },
      locale: "es-ES",
    });
    await contexto.route("https://tiles.openfreemap.org/**", mapaBaseFalso);
    // El mapa base de reserva del IGN, por si el de OpenFreeMap falla: tampoco se pide fuera.
    await contexto.route(/\.idee\.es\//u, (ruta) =>
      ruta.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) }),
    );
    const pagina = await contexto.newPage();
    const avisos: Array<string> = [];
    pagina.on("pageerror", (error) => avisos.push(error.message));
    await pagina.goto(`${sitio.origen}/`);
    const cdp = await contexto.newCDPSession(pagina);
    for (let intento = 0; !(await atraparMapa(cdp)); intento += 1) {
      if (intento > 60) throw new Error("No se encuentra el mapa de MapLibre de la página");
      await pausa(250);
    }
    const sitios = capa.posiciones.map((p): [number, number] => [p.longitud, p.latitud]);
    await pagina.evaluate(instalarMedida, sitios);
    const centro: [number, number] = [capa.centro.longitud, capa.centro.latitud];

    console.log(
      `Los puntos que se mueven entre la vista de puntos y los logos, con ${sitios.length} emplazamientos:\n`,
    );
    console.log(
      `  ${"Gesto".padEnd(52)}${"CPU".padStart(4)}${"puntos".padStart(8)}${"medidas".padStart(9)}${"media".padStart(9)}${"máx".padStart(12)}`,
    );
    for (const cpu of opciones.cpu.split(",").map(Number)) {
      for (const gesto of GESTOS) {
        await pagina.evaluate(
          ([lugar, zoom]) => window.__celdaMapa?.jumpTo({ center: lugar, zoom }),
          [centro, gesto.desde] as const,
        );
        await quieto(pagina);
        // Con los logos a la vista, o sin ellos al acercar: que lleguen y se asienten.
        if (gesto.desde >= 15) {
          await pagina.locator('section[aria-label="Emplazamientos"] > button').first().waitFor();
        }
        await pausa(1000);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        await pagina.evaluate(() => window.__deriva.empezar());
        await recorrer(pagina, gesto.tramos);
        await pausa(2500);
        await quieto(pagina);
        const medida = await pagina.evaluate(() => window.__deriva.parar());
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        const lejos = medida.maximo > TOLERANCIA_PX;
        const vacia = gesto.conPuntos && medida.puntos === 0;
        fallo ||= lejos || vacia;
        console.log(
          `${lejos || vacia ? "✗" : " "} ${gesto.nombre.padEnd(52)}${`×${cpu}`.padStart(4)}${String(medida.puntos).padStart(8)}${String(medida.muestras).padStart(9)}${medida.media.toFixed(2).padStart(9)}${`${medida.maximo.toFixed(2)} px`.padStart(12)}`,
        );
        if (lejos) {
          console.log(
            `    un punto se separó ${medida.maximo.toFixed(1)} px de su emplazamiento a zoom ${medida.zoomDelMaximo.toFixed(2)}`,
          );
        }
        if (vacia) console.log("    no se vio ningún punto moverse: el paso no ha ocurrido");
      }
    }
    if (avisos.length > 0) console.log(`\nLa página avisó:\n${avisos.join("\n")}`);
  } finally {
    await navegador.close();
    await sitio.cerrar();
    await NodeFSP.rm(temporal, { recursive: true, force: true });
  }
  if (fallo) {
    console.log("\nAlgún punto se separa de su emplazamiento. Ver docs/patterns/rendimiento.md.");
    process.exitCode = 1;
  } else {
    console.log(`\nTodos los puntos siguen a menos de ${TOLERANCIA_PX} px de su emplazamiento.`);
  }
};

await principal();
