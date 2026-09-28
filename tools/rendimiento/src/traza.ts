/**
 * Resumen de una traza de rendimiento de Chromium (formato Trace Event): cuánto tiempo propio se va
 * en cada hilo y en cada tipo de trabajo, para ver qué cuesta de verdad en el peor caso.
 */

interface Evento {
  readonly name: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly args?: { readonly name?: string; readonly data?: { readonly url?: string } };
}

/** Los nombres de la traza, agrupados en lo que interesa: guion, estilo, maquetación, pintado. */
const GRUPOS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^(FunctionCall|EvaluateScript|v8\.|V8\.|RunMicrotasks|TimerFire|FireAnimationFrame|EventDispatch|v8\.callFunction|ScheduledAction|MajorGC|MinorGC|GC)/u,
    "guion",
  ],
  [
    /^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|ScheduleStyleRecalculation)/u,
    "estilo",
  ],
  [
    /^(Layout|UpdateLayerTree|IntersectionObserverController::computeIntersections)/u,
    "maquetacion",
  ],
  [
    /^(Paint|PrePaint|Layerize|UpdateLayer|CompositeLayers|Commit|PaintImage|RasterTask|Decode)/u,
    "pintado",
  ],
  [/^(ParseHTML|HTMLDocumentParser)/u, "html"],
];

const grupoDe = (nombre: string): string =>
  GRUPOS.find(([patron]) => patron.test(nombre))?.[1] ?? "otros";

export interface ResumenDeTraza {
  /** Por hilo (con nombre), el tiempo propio por grupo, en ms. */
  readonly hilos: ReadonlyArray<{
    readonly hilo: string;
    readonly total: number;
    readonly grupos: Readonly<Record<string, number>>;
    readonly eventos: ReadonlyArray<readonly [string, number]>;
  }>;
}

/**
 * El tiempo propio de cada evento completo (`X`), restando el de sus hijos, sumado por hilo y por
 * grupo. Solo los hilos que interesan: el principal, los workers, el compositor y la GPU.
 */
export const resumirTraza = (eventos: ReadonlyArray<Evento>): ResumenDeTraza => {
  const nombres = new Map<string, string>();
  for (const evento of eventos) {
    if (evento.ph === "M" && evento.name === "thread_name") {
      nombres.set(`${evento.pid}:${evento.tid}`, evento.args?.name ?? "");
    }
  }
  const porHilo = new Map<string, Array<Evento>>();
  for (const evento of eventos) {
    if (evento.ph !== "X" || evento.dur === undefined) continue;
    const clave = `${evento.pid}:${evento.tid}`;
    const lista = porHilo.get(clave) ?? [];
    lista.push(evento);
    porHilo.set(clave, lista);
  }
  const hilos: Array<ResumenDeTraza["hilos"][number]> = [];
  for (const [clave, lista] of porHilo) {
    const hilo = nombres.get(clave) ?? clave;
    if (
      !/CrRendererMain|DedicatedWorker|Compositor|CrGpuMain|VizCompositor|ThreadPoolForeground/u.test(
        hilo,
      )
    )
      continue;
    lista.sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
    const propio = new Map<string, number>();
    const pila: Array<{ fin: number; nombre: string; hijos: number; dur: number }> = [];
    const cerrar = (hasta: number) => {
      while (pila.length > 0 && (pila.at(-1)?.fin ?? 0) <= hasta) {
        const cima = pila.pop();
        if (cima === undefined) break;
        propio.set(cima.nombre, (propio.get(cima.nombre) ?? 0) + (cima.dur - cima.hijos));
      }
    };
    for (const evento of lista) {
      cerrar(evento.ts);
      const dur = evento.dur ?? 0;
      const padre = pila.at(-1);
      if (padre !== undefined) padre.hijos += dur;
      pila.push({ fin: evento.ts + dur, nombre: evento.name, hijos: 0, dur });
    }
    cerrar(Number.POSITIVE_INFINITY);
    const grupos: Record<string, number> = {};
    let total = 0;
    for (const [nombre, us] of propio) {
      const grupo = grupoDe(nombre);
      // Las tareas del planificador son el envoltorio de todo lo demás.
      if (/^(ThreadControllerImpl::RunTask|RunTask|SequenceManager)/u.test(nombre)) continue;
      grupos[grupo] = (grupos[grupo] ?? 0) + us / 1000;
      total += us / 1000;
    }
    const ordenados = [...propio]
      .filter(([nombre]) => !/^(ThreadControllerImpl::RunTask|RunTask)/u.test(nombre))
      .map(([nombre, us]): readonly [string, number] => [nombre, us / 1000])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    hilos.push({ hilo, total, grupos, eventos: ordenados });
  }
  hilos.sort((a, b) => b.total - a.total);
  return { hilos };
};

interface NodoDePerfil {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
}

/** Las funciones con más tiempo propio de un perfil de CPU de V8, con su fichero y su línea. */
export const resumirPerfil = (perfil: {
  readonly nodes: ReadonlyArray<NodoDePerfil>;
  readonly samples?: ReadonlyArray<number>;
  readonly timeDeltas?: ReadonlyArray<number>;
}): string => {
  const porId = new Map(perfil.nodes.map((n) => [n.id, n]));
  const propio = new Map<string, number>();
  const muestras = perfil.samples ?? [];
  const deltas = perfil.timeDeltas ?? [];
  for (const [i, id] of muestras.entries()) {
    const nodo = porId.get(id);
    if (nodo === undefined) continue;
    const { functionName, url, lineNumber } = nodo.callFrame;
    if (functionName === "(idle)" || functionName === "(program)") continue;
    const clave = `${functionName || "(anónima)"} ${url.split("/").pop() ?? ""}:${lineNumber + 1}`;
    propio.set(clave, (propio.get(clave) ?? 0) + (deltas[i + 1] ?? 0) / 1000);
  }
  return [...propio]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([clave, ms]) => `${clave} ${ms.toFixed(1)}`)
    .join(" | ");
};
