/**
 * Lo que la medida instala en la página antes de que cargue. Se ejecuta en el navegador: no puede
 * importar nada ni cerrar sobre variables de fuera.
 */

export interface CargaEnPagina {
  /** Cuándo se quita el aviso «Cargando el mapa base»: ha llegado la primera tesela. */
  readonly mapaBase: number | undefined;
  /** Cuándo se pinta el primer marcador, aunque sea el hexágono de una provincia que llega. */
  readonly marcadores: number | undefined;
  /** Cuándo se pinta el primer emplazamiento o agrupación de una provincia ya cargada. */
  readonly detalle: number | undefined;
  readonly lcp: number | undefined;
  /** Qué elemento es el LCP: su etiqueta y el principio de su texto. */
  readonly elementoLcp: string;
  /** Las tareas largas (más de 50 ms) del hilo principal hasta ahora: inicio y duración. */
  readonly tareasLargas: ReadonlyArray<{ readonly inicio: number; readonly duracion: number }>;
}

export interface FotogramasEnPagina {
  /** Los intervalos entre dos `requestAnimationFrame` seguidos, en ms. */
  readonly intervalos: ReadonlyArray<number>;
  readonly duracion: number;
  /** Los fotogramas largos que ve el navegador (Long Animation Frames), con el guion que más pesa. */
  readonly largos: ReadonlyArray<{
    readonly duracion: number;
    readonly bloqueo: number;
    readonly estilo: number;
    readonly guion: string;
  }>;
  /** Cuántos elementos tenía la lámina de marcadores al terminar. */
  readonly nodos: number;
}

export interface Interaccion {
  readonly duracion: number;
  readonly tipo: string;
}

/** Un sitio del mapa: longitud y latitud, como las pide MapLibre. */
export type Centro = readonly [number, number];

/**
 * Lo que la medida usa del mapa de MapLibre de la página para mover la cámara. La web no lo
 * expone: la medida lo encuentra por CDP (`atraparMapa` en `medir.ts`).
 */
export interface CamaraEnPagina {
  readonly jumpTo: (opciones: { center?: Centro; zoom?: number }) => void;
  readonly flyTo: (opciones: { center: Centro; zoom: number; duration: number }) => void;
  readonly easeTo: (opciones: { center?: Centro; zoom: number; duration: number }) => void;
  readonly project: (lugar: Centro) => { readonly x: number; readonly y: number };
  readonly getZoom: () => number;
  readonly once: (evento: "idle", oyente: () => void) => void;
  readonly triggerRepaint: () => void;
}

declare global {
  interface Window {
    __celda: {
      readonly carga: () => CargaEnPagina;
      readonly empezar: () => void;
      readonly parar: () => FotogramasEnPagina;
      readonly interacciones: () => ReadonlyArray<Interaccion>;
    };
    /** El mapa de la página, cuando la medida lo ha encontrado. */
    __celdaMapa?: CamaraEnPagina;
  }
}

/** Se instala con `addInitScript` en cada página. */
export const instalar = (): void => {
  const pintado = (): Promise<number> =>
    new Promise((resolver) => {
      requestAnimationFrame(() => {
        // El mensaje llega después de pintar el fotograma.
        const canal = new MessageChannel();
        canal.port1.addEventListener("message", () => resolver(performance.now()));
        canal.port1.start();
        canal.port2.postMessage(undefined);
      });
    });

  let mapaBase: number | undefined;
  let marcadores: number | undefined;
  let detalle: number | undefined;
  let lcp: number | undefined;
  let elementoLcp = "";
  let avisoVisto = false;
  const tareasLargas: Array<{ inicio: number; duracion: number }> = [];

  const hayAvisoDeMapa = (): boolean =>
    [...document.querySelectorAll("[role=status] h2")].some((h) =>
      (h.textContent ?? "").includes("Cargando el mapa base"),
    );
  const mirarCarga = (): void => {
    if (mapaBase === undefined) {
      const aviso = hayAvisoDeMapa();
      if (aviso) avisoVisto = true;
      else if (avisoVisto) {
        mapaBase = -1;
        void pintado().then((t) => {
          mapaBase = t;
        });
      }
    }
    if (
      marcadores === undefined &&
      document.querySelector('section[aria-label="Emplazamientos"] button') !== null
    ) {
      marcadores = -1;
      void pintado().then((t) => {
        marcadores = t;
      });
    }
    if (
      detalle === undefined &&
      document.querySelector(
        'section[aria-label="Emplazamientos"] button:not([data-cobertura])',
      ) !== null
    ) {
      detalle = -1;
      void pintado().then((t) => {
        detalle = t;
      });
    }
    if (mapaBase === undefined || marcadores === undefined || detalle === undefined) {
      requestAnimationFrame(mirarCarga);
    }
  };
  requestAnimationFrame(mirarCarga);

  new PerformanceObserver((lista) => {
    for (const entrada of lista.getEntries()) {
      lcp = entrada.startTime;
      // SAFETY: un observador de tipo `largest-contentful-paint` solo recibe esas entradas.
      const elemento = (entrada as PerformanceEntry & { readonly element: Element | null }).element;
      elementoLcp = `${elemento?.tagName ?? ""} «${(elemento?.textContent ?? "").slice(0, 40)}»`;
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((lista) => {
    for (const entrada of lista.getEntries()) {
      tareasLargas.push({ inicio: entrada.startTime, duracion: entrada.duration });
    }
  }).observe({ type: "longtask", buffered: true });

  // INP: la duración de cada interacción, de la entrada al siguiente pintado.
  // SAFETY: `durationThreshold` es de Event Timing y los tipos del DOM de TypeScript no lo traen.
  const eventos = {
    type: "event",
    durationThreshold: 16,
    buffered: true,
  } as PerformanceObserverInit;
  const interacciones = new Map<number, { duracion: number; tipo: string }>();
  new PerformanceObserver((lista) => {
    // SAFETY: un observador de tipo `event` solo recibe PerformanceEventTiming.
    for (const entrada of lista.getEntries() as Array<PerformanceEventTiming>) {
      if (entrada.interactionId === 0) continue;
      const anterior = interacciones.get(entrada.interactionId);
      if (anterior === undefined || anterior.duracion < entrada.duration) {
        const objetivo = entrada.target instanceof Element ? entrada.target : null;
        const nombre =
          objetivo?.closest("[aria-label]")?.getAttribute("aria-label") ?? objetivo?.tagName ?? "";
        interacciones.set(entrada.interactionId, {
          duracion: entrada.duration,
          tipo: `${entrada.name} en «${nombre.slice(0, 40)}»`,
        });
      }
    }
  }).observe(eventos);

  // Fotogramas: entre `empezar` y `parar`.
  let grabando = false;
  // Cada grabación tiene su número: el bucle de una anterior no se cuela en la siguiente.
  let grabacion = 0;
  let inicio = 0;
  let ultimo = 0;
  let intervalos: Array<number> = [];
  let largos: Array<FotogramasEnPagina["largos"][number]> = [];
  const latir =
    (esta: number) =>
    (t: number): void => {
      if (!grabando || esta !== grabacion) return;
      if (ultimo > 0) intervalos.push(t - ultimo);
      ultimo = t;
      requestAnimationFrame(latir(esta));
    };
  interface EntradaLoaf extends PerformanceEntry {
    readonly blockingDuration: number;
    readonly styleAndLayoutStart: number;
    readonly renderStart: number;
    readonly scripts: ReadonlyArray<{
      readonly duration: number;
      readonly sourceFunctionName: string;
      readonly sourceURL: string;
      readonly invoker: string;
    }>;
  }
  new PerformanceObserver((lista) => {
    if (!grabando) return;
    // SAFETY: un observador de tipo `long-animation-frame` solo recibe esas entradas.
    for (const entrada of lista.getEntries() as Array<EntradaLoaf>) {
      const guion = [...entrada.scripts].sort((a, b) => b.duration - a.duration)[0];
      largos.push({
        duracion: entrada.duration,
        bloqueo: entrada.blockingDuration,
        estilo:
          entrada.styleAndLayoutStart > 0
            ? entrada.startTime + entrada.duration - entrada.styleAndLayoutStart
            : 0,
        guion:
          guion === undefined
            ? ""
            : `${guion.invoker} ${guion.sourceFunctionName}@${guion.sourceURL.split("/").pop() ?? ""} ${Math.round(guion.duration)}ms`,
      });
    }
  }).observe({ type: "long-animation-frame", buffered: false });

  window.__celda = {
    carga: () => ({
      mapaBase: mapaBase === -1 ? undefined : mapaBase,
      marcadores: marcadores === -1 ? undefined : marcadores,
      detalle: detalle === -1 ? undefined : detalle,
      lcp,
      elementoLcp,
      tareasLargas: [...tareasLargas],
    }),
    empezar: () => {
      grabando = true;
      grabacion += 1;
      inicio = performance.now();
      ultimo = 0;
      intervalos = [];
      largos = [];
      requestAnimationFrame(latir(grabacion));
    },
    parar: () => {
      grabando = false;
      return {
        intervalos,
        duracion: performance.now() - inicio,
        largos,
        nodos:
          document.querySelector('section[aria-label="Emplazamientos"]')?.querySelectorAll("*")
            .length ?? 0,
      };
    },
    interacciones: () => [...interacciones.values()],
  };
};
