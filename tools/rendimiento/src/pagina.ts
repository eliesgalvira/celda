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
  /**
   * Cuánto se separan los marcadores del sitio que les toca en el lienzo, en px CSS, medido al
   * final de cada fotograma que pinta MapLibre (`render`): la media, el máximo y en cuántos
   * fotogramas. Un marcador que va un fotograma por detrás del mapa se separa lo que el mapa se
   * mueve en ese fotograma.
   */
  readonly desfase: {
    readonly media: number;
    readonly maximo: number;
    readonly muestras: number;
    /** De los fotogramas con el mapa en movimiento, en qué parte iba el marcador un fotograma tarde. */
    readonly tarde: number;
  };
  /** Cuántos marcadores había en la lámina al terminar. */
  readonly marcadores: number;
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
  readonly easeTo: (opciones: {
    center?: Centro;
    zoom: number;
    duration: number;
    easing?: (t: number) => number;
  }) => void;
  readonly project: (lugar: Centro) => { readonly x: number; readonly y: number };
  readonly getZoom: () => number;
  readonly once: (evento: "idle", oyente: () => void) => void;
  readonly on: (evento: "render", oyente: () => void) => void;
  readonly off: (evento: "render", oyente: () => void) => void;
  readonly unproject: (punto: readonly [number, number]) => { lng: number; lat: number };
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

  /** La cinta `CargaDelMapa`, un `<output>` con «Cargando el mapa…». */
  const hayAvisoDeMapa = (): boolean =>
    [...document.querySelectorAll("output")].some((salida) =>
      (salida.textContent ?? "").includes("Cargando el mapa"),
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
    // Los primeros datos: un marcador o, con la vista de puntos, que no hay ninguno de lejos, la
    // fecha de los datos, que sale cuando han llegado el resumen y los puntos (ADR 0028).
    if (
      marcadores === undefined &&
      (document.querySelector('section[aria-label="Emplazamientos"] button') !== null ||
        (document.querySelector('section[aria-label="Emplazamientos"]') !== null &&
          document.querySelector('output[data-tono="fecha"]') !== null))
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

  // El desfase de los marcadores: hasta cinco botones de la lámina que se ven al empezar.
  const trasladoDe = (elemento: HTMLElement | null): [number, number] | undefined => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/u.exec(elemento?.style.transform ?? "");
    return m === null ? undefined : [Number(m[1]), Number(m[2])];
  };
  // El botón va en su sitio dentro de la lámina, y la lámina puede ir desplazada entera.
  const posicionDe = (boton: HTMLElement): [number, number] | undefined => {
    const propio = trasladoDe(boton);
    if (propio === undefined) return undefined;
    const lamina = trasladoDe(boton.parentElement) ?? [0, 0];
    return [propio[0] + lamina[0], propio[1] + lamina[1]];
  };
  // Cada marcador seguido lleva su sitio en el mapa y dónde tocaba en el fotograma anterior. En
  // cada fotograma en que el mapa se mueve más de 1 px, el marcador está «a tiempo» (donde toca
  // ahora), «tarde» (donde tocaba en el fotograma anterior: se separa lo que se ha movido el mapa)
  // o en otro sitio, porque la web lo ha recolocado (al agrupar): entonces se vuelve a anclar.
  let seguidos: Array<{
    boton: HTMLElement;
    lugar: [number, number];
    antes: { x: number; y: number } | undefined;
  }> = [];
  let aTiempo = 0;
  let tarde: Array<number> = [];
  let alPintar: (() => void) | undefined;
  const seguirMarcadores = () => {
    const mapa = window.__celdaMapa;
    seguidos = [];
    aTiempo = 0;
    tarde = [];
    if (mapa === undefined) return;
    const lamina = document.querySelector('section[aria-label="Emplazamientos"]');
    const ancho = innerWidth;
    const alto = innerHeight;
    for (const boton of lamina?.querySelectorAll<HTMLElement>(":scope > button") ?? []) {
      const p = posicionDe(boton);
      if (p === undefined || p[0] < 0 || p[1] < 0 || p[0] > ancho || p[1] > alto) continue;
      const l = mapa.unproject(p);
      seguidos.push({ boton, lugar: [l.lng, l.lat], antes: undefined });
      if (seguidos.length >= 5) break;
    }
    alPintar = () => {
      // Tras el `flush` de Solid, que va en una microtarea pedida antes que esta.
      queueMicrotask(() => {
        for (const seguido of seguidos) {
          if (!seguido.boton.isConnected) continue;
          const p = posicionDe(seguido.boton);
          if (p === undefined) continue;
          const ahora = mapa.project(seguido.lugar);
          const antes = seguido.antes;
          seguido.antes = { x: ahora.x, y: ahora.y };
          if (antes === undefined) continue;
          const paso = Math.hypot(ahora.x - antes.x, ahora.y - antes.y);
          if (paso < 1) continue;
          if (Math.hypot(p[0] - ahora.x, p[1] - ahora.y) < 0.6) aTiempo += 1;
          else if (Math.hypot(p[0] - antes.x, p[1] - antes.y) < 0.6) tarde.push(paso);
          else {
            const l = mapa.unproject(p);
            seguido.lugar = [l.lng, l.lat];
            seguido.antes = undefined;
          }
        }
      });
    };
    mapa.on("render", alPintar);
  };
  const dejarDeSeguir = () => {
    if (alPintar !== undefined) window.__celdaMapa?.off("render", alPintar);
    alPintar = undefined;
    const muestras = aTiempo + tarde.length;
    return {
      media: muestras === 0 ? 0 : tarde.reduce((a, b) => a + b, 0) / muestras,
      maximo: Math.max(0, ...tarde),
      muestras,
      tarde: muestras === 0 ? 0 : tarde.length / muestras,
    };
  };

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
      seguirMarcadores();
      requestAnimationFrame(latir(grabacion));
    },
    parar: () => {
      grabando = false;
      const desfase = dejarDeSeguir();
      return {
        desfase,
        marcadores: document.querySelectorAll('section[aria-label="Emplazamientos"] > button')
          .length,
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
