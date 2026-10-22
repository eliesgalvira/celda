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
 * La provincia de un emplazamiento que no la dice: los enlaces de antes de la capa por provincias
 * (ADR 0016), cuando Celda solo tenía Barcelona, si el resumen aún no tiene índice de claves.
 */
export const PROVINCIA_DE_LOS_ENLACES_VIEJOS = "08";

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
  medir: "/?medir",
} as const;

/** Los diálogos que se abren desde «Funciones», cada uno con un parámetro de la URL sin valor. */
const DIALOGOS = ["medir", "ajustes", "aportaciones", "lista", "si-algo-va-mal"] as const;

export type DialogoDeLaUrl = (typeof DIALOGOS)[number];

/** El `=` vacío que `URLSearchParams` pone a los parámetros de los diálogos. */
const IGUAL_DE_UN_DIALOGO = new RegExp(`(^|&)(${DIALOGOS.join("|")})=(?=&|$)`, "gu");

/** La dirección con esos parámetros, con los de los diálogos sin `=`. */
const direccion = (pathname: string, parametros: URLSearchParams): string => {
  const busqueda = parametros.toString().replace(IGUAL_DE_UN_DIALOGO, "$1$2");
  return busqueda === "" ? pathname : `${pathname}?${busqueda}`;
};

/** Si la ubicación tiene abierto ese diálogo. */
export const dialogoAbierto = (ubicacion: Ubicacion, dialogo: DialogoDeLaUrl): boolean =>
  ubicacion.search.has(dialogo);

/** La misma ubicación con ese diálogo abierto o cerrado; el resto de la URL no cambia. */
export const conDialogo = (
  ubicacion: Ubicacion,
  dialogo: DialogoDeLaUrl,
  abierto: boolean,
): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  if (abierto) {
    parametros.set(dialogo, "");
  } else {
    parametros.delete(dialogo);
  }
  return direccion(ubicacion.pathname, parametros);
};

/**
 * El parámetro de la URL que abre el ejercicio de emplazamientos, con el código de la zona: el del
 * barrio o el del municipio.
 */
const EJERCICIO = "ejercicio";

/**
 * El ejercicio abierto en una ubicación: `null` si está cerrado y, abierto, el código de la zona
 * elegida o `""` si aún no hay ninguna.
 */
export const ejercicioDe = (ubicacion: Ubicacion): string | null =>
  ubicacion.search.get(EJERCICIO)?.trim() ?? null;

/**
 * El mapa con el ejercicio abierto en una zona (o sin zona con `""`), o cerrado con `null`.
 * El ejercicio y la ficha ocupan el mismo panel: abrir uno cierra el otro.
 */
export const conEjercicio = (ubicacion: Ubicacion, zona: string | null): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  parametros.delete(EMPLAZAMIENTO);
  parametros.delete(PROVINCIA);
  if (zona === null) {
    parametros.delete(EJERCICIO);
  } else {
    parametros.set(EJERCICIO, zona);
  }
  return direccion(ubicacion.pathname, parametros);
};

/** La clave del emplazamiento seleccionado en una ubicación, o `null` si no hay ninguno. */
export const emplazamientoDe = (ubicacion: Ubicacion): string | null => {
  const clave = ubicacion.search.get(EMPLAZAMIENTO)?.trim() ?? "";
  return clave === "" ? null : clave;
};

/**
 * La provincia del emplazamiento seleccionado en una ubicación, o `null` si el enlace no la dice:
 * uno de antes de la capa por provincias o uno escrito a mano con la clave. Entonces la busca el
 * índice de claves del resumen.
 */
export const provinciaDe = (ubicacion: Ubicacion): string | null => {
  const provincia = ubicacion.search.get(PROVINCIA)?.trim() ?? "";
  return provincia === "" ? null : provincia;
};

/**
 * La misma ubicación con la clave y la provincia del emplazamiento seleccionado; el resto de la
 * URL no cambia. Es lo que se hace con un enlace que no dice la provincia, o con uno a un
 * emplazamiento que se juntó con otro, en cuanto el índice de claves dice dónde está.
 */
export const conEmplazamiento = (
  ubicacion: Ubicacion,
  situado: { readonly clave: string; readonly provincia: string },
): string => {
  const parametros = new URLSearchParams(ubicacion.search);
  parametros.set(EMPLAZAMIENTO, situado.clave);
  parametros.set(PROVINCIA, situado.provincia);
  return direccion(ubicacion.pathname, parametros);
};

/** Un clic normal con el botón principal y sin modificadores: el que navega dentro de la app. */
export const esClicDeNavegacion = (evento: MouseEvent): boolean =>
  evento.button === 0 && !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey;
