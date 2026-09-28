import { createSignal } from "solid-js";

/**
 * El enrutador de Celda: la ubicación como señal y `navegar` sobre la
 * historia del navegador. `@solidjs/router@2` sigue en `next` (ADR 0002).
 */
export interface Ubicacion {
  readonly pathname: string;
  readonly search: URLSearchParams;
}

const leerUbicacion = (): Ubicacion => ({
  pathname: window.location.pathname,
  search: new URLSearchParams(window.location.search),
});

const [ubicacion, setUbicacion] = createSignal(leerUbicacion());
window.addEventListener("popstate", () => setUbicacion(leerUbicacion()));

export { ubicacion };

export const navegar = (href: string, opciones?: { readonly reemplazar?: boolean }): void => {
  if (opciones?.reemplazar === true) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
  setUbicacion(leerUbicacion());
};

/** El parámetro de la URL con la clave del emplazamiento seleccionado. */
const EMPLAZAMIENTO = "emplazamiento";

/** El parámetro de la URL con la provincia en cuya capa va el emplazamiento seleccionado. */
const PROVINCIA = "provincia";

/**
 * La provincia de un enlace a un emplazamiento sin ella: los de antes de la capa por provincias
 * (ADR 0016), cuando Celda solo tenía Barcelona.
 */
export const PROVINCIA_DE_LOS_ENLACES_VIEJOS = "08";

/** El parámetro de la URL que abre el paso de medir la señal. No lleva valor. */
const MEDIR = "medir";

/** Los destinos con nombre: la única forma de escribir una URL de la app. */
export const ruta = {
  mapa: "/",
  /**
   * El mapa con la ficha de un emplazamiento abierta. Es la misma pantalla, así que abrir y
   * cerrar la ficha no mueve el mapa; la dirección se puede compartir y recargar.
   */
  emplazamiento: (clave: string, provincia: string) =>
    `/?${EMPLAZAMIENTO}=${encodeURIComponent(clave)}&${PROVINCIA}=${encodeURIComponent(provincia)}`,
  /**
   * El mapa con el paso de medir abierto. Es la dirección del código QR que se enseña en un
   * ordenador: en el móvil se abre directamente en este paso.
   */
  medir: `/?${MEDIR}`,
} as const;

/** Si la ubicación tiene abierto el paso de medir. */
export const medirAbierto = (ubicacion: Ubicacion): boolean => ubicacion.search.has(MEDIR);

/** La misma ubicación con el paso de medir abierto o cerrado; el resto de la URL no cambia. */
export const conMedir = (ubicacion: Ubicacion, abierto: boolean): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  if (abierto) {
    parametros.set(MEDIR, "");
  } else {
    parametros.delete(MEDIR);
  }
  // `medir` va sin `=`: la dirección queda como la del código QR.
  const busqueda = parametros.toString().replace(/(^|&)medir=(?=&|$)/u, "$1medir");
  return busqueda === "" ? ubicacion.pathname : `${ubicacion.pathname}?${busqueda}`;
};

/** El parámetro de la URL que abre el ejercicio de emplazamientos, con el código del barrio. */
const EJERCICIO = "ejercicio";

/** El parámetro de la URL que abre los ajustes. No lleva valor. */
const AJUSTES = "ajustes";

/**
 * El ejercicio abierto en una ubicación: `null` si está cerrado y, abierto, el código del barrio
 * elegido o `""` si aún no hay ninguno.
 */
export const ejercicioDe = (ubicacion: Ubicacion): string | null =>
  ubicacion.search.get(EJERCICIO)?.trim() ?? null;

/**
 * El mapa con el ejercicio abierto en un barrio (o sin barrio con `""`), o cerrado con `null`.
 * El ejercicio y la ficha ocupan el mismo panel: abrir uno cierra el otro.
 */
export const conEjercicio = (ubicacion: Ubicacion, barrio: string | null): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  parametros.delete(EMPLAZAMIENTO);
  parametros.delete(PROVINCIA);
  if (barrio === null) {
    parametros.delete(EJERCICIO);
  } else {
    parametros.set(EJERCICIO, barrio);
  }
  const busqueda = parametros.toString();
  return busqueda === "" ? ubicacion.pathname : `${ubicacion.pathname}?${busqueda}`;
};

/** Si la ubicación tiene abiertos los ajustes. */
export const ajustesAbiertos = (ubicacion: Ubicacion): boolean => ubicacion.search.has(AJUSTES);

/** La misma ubicación con los ajustes abiertos o cerrados; el resto de la URL no cambia. */
export const conAjustes = (ubicacion: Ubicacion, abiertos: boolean): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  if (abiertos) {
    parametros.set(AJUSTES, "");
  } else {
    parametros.delete(AJUSTES);
  }
  const busqueda = parametros.toString().replace(/(^|&)ajustes=(?=&|$)/u, "$1ajustes");
  return busqueda === "" ? ubicacion.pathname : `${ubicacion.pathname}?${busqueda}`;
};

/** La clave del emplazamiento seleccionado en una ubicación, o `null` si no hay ninguno. */
export const emplazamientoDe = (ubicacion: Ubicacion): string | null => {
  const clave = ubicacion.search.get(EMPLAZAMIENTO)?.trim() ?? "";
  return clave === "" ? null : clave;
};

/**
 * La provincia del emplazamiento seleccionado en una ubicación. Un enlace sin ella es de antes de
 * la capa por provincias, y entonces es de Barcelona.
 */
export const provinciaDe = (ubicacion: Ubicacion): string => {
  const provincia = ubicacion.search.get(PROVINCIA)?.trim() ?? "";
  return provincia === "" ? PROVINCIA_DE_LOS_ENLACES_VIEJOS : provincia;
};

/** Un clic normal con el botón principal y sin modificadores: el que navega dentro de la app. */
export const esClicDeNavegacion = (evento: MouseEvent): boolean =>
  evento.button === 0 && !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey;
