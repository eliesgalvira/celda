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

/** Los destinos con nombre: la única forma de escribir una URL de la app. */
export const ruta = {
  mapa: "/",
  /**
   * El mapa con la ficha de un emplazamiento abierta. Es la misma pantalla, así que abrir y
   * cerrar la ficha no mueve el mapa; la dirección se puede compartir y recargar.
   */
  emplazamiento: (clave: string) => `/?${EMPLAZAMIENTO}=${encodeURIComponent(clave)}`,
} as const;

/** La clave del emplazamiento seleccionado en una ubicación, o `null` si no hay ninguno. */
export const emplazamientoDe = (ubicacion: Ubicacion): string | null => {
  const clave = ubicacion.search.get(EMPLAZAMIENTO)?.trim() ?? "";
  return clave === "" ? null : clave;
};

/** Un clic normal con el botón principal y sin modificadores: el que navega dentro de la app. */
export const esClicDeNavegacion = (evento: MouseEvent): boolean =>
  evento.button === 0 && !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey;
