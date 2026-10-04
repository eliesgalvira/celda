/**
 * Lo que la prueba de resistencia instala en la página antes de que cargue. Cuenta las llamadas a
 * las API que abren algo y simula la brújula del móvil. Se ejecuta en el navegador: no puede
 * importar nada ni cerrar sobre variables de fuera.
 */

/** Las API que se cuentan. */
export const CONTADAS = [
  "watchPosition",
  "clearWatch",
  "getCurrentPosition",
  "addEventListener",
  "removeEventListener",
  "fetch",
  "new Worker",
  "postMessage",
  "setInterval",
  "setTimeout",
  "requestAnimationFrame",
] as const;

export type Contada = (typeof CONTADAS)[number];

declare global {
  interface Window {
    __resistencia: {
      /** Cuántas veces se ha llamado a cada API desde que cargó la página. */
      readonly cuentas: () => Readonly<Record<string, number>>;
      /** Los fotogramas pedidos que aún no han llegado ni se han cancelado. */
      readonly fotogramasPendientes: () => number;
      /** Empieza a lanzar lecturas de la brújula, diez por segundo, girando poco a poco. */
      readonly girar: () => void;
    };
  }
}

/** Se instala con `addInitScript` en cada página. */
export const instalarContador = (): void => {
  const cuentas: Record<string, number> = {};
  const contar = (nombre: string) => {
    cuentas[nombre] = (cuentas[nombre] ?? 0) + 1;
  };
  // Los originales, para que lo que hace la propia prueba no cuente.
  const setIntervalOriginal = window.setInterval.bind(window);

  /** Sustituye un método por uno que cuenta y llama al original con los mismos argumentos. */
  const contarEn = (
    dueno: EventTarget | Geolocation,
    metodo: string,
    nombre: string,
    original: Function,
  ) => {
    Object.defineProperty(dueno, metodo, {
      configurable: true,
      writable: true,
      value: function (this: EventTarget | Geolocation, ...argumentos: ReadonlyArray<object>) {
        contar(nombre);
        return original.apply(this, argumentos);
      },
    });
  };

  contarEn(window, "setTimeout", "setTimeout", window.setTimeout);
  contarEn(window, "setInterval", "setInterval", window.setInterval);
  // Los fotogramas se cuentan al pedirlos y se apuntan hasta que llegan: el mapa pide uno, y deja
  // de escuchar su cancelación, al pintarlo. Uno pendiente es que la página aún no está quieta.
  const pendientes = new Set<number>();
  const pedirFotograma = window.requestAnimationFrame.bind(window);
  const cancelarFotograma = window.cancelAnimationFrame.bind(window);
  contarEn(
    window,
    "requestAnimationFrame",
    "requestAnimationFrame",
    (llamada: FrameRequestCallback) => {
      const id = pedirFotograma((instante) => {
        pendientes.delete(id);
        llamada(instante);
      });
      pendientes.add(id);
      return id;
    },
  );
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (id: number) => {
      pendientes.delete(id);
      cancelarFotograma(id);
    },
  });
  contarEn(window, "fetch", "fetch", window.fetch);
  const eventos = EventTarget.prototype;
  contarEn(eventos, "addEventListener", "addEventListener", eventos.addEventListener);
  contarEn(eventos, "removeEventListener", "removeEventListener", eventos.removeEventListener);
  contarEn(Worker.prototype, "postMessage", "postMessage", Worker.prototype.postMessage);
  const gps = Geolocation.prototype;
  contarEn(gps, "watchPosition", "watchPosition", gps.watchPosition);
  contarEn(gps, "clearWatch", "clearWatch", gps.clearWatch);
  contarEn(gps, "getCurrentPosition", "getCurrentPosition", gps.getCurrentPosition);

  const WorkerOriginal = window.Worker;
  window.Worker = class extends WorkerOriginal {
    constructor(url: string | URL, opciones?: WorkerOptions) {
      contar("new Worker");
      super(url, opciones);
    }
  };

  let rumbo = 0;
  window.__resistencia = {
    cuentas: () => ({ ...cuentas }),
    fotogramasPendientes: () => pendientes.size,
    girar: () => {
      setIntervalOriginal(() => {
        rumbo = (rumbo + 1) % 360;
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientationabsolute", {
            alpha: rumbo,
            beta: 0,
            gamma: 0,
            absolute: true,
          }),
        );
      }, 100);
    },
  };
};
