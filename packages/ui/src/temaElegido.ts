/**
 * El tema elegido en Ajustes: el del sistema (por defecto), el claro o el oscuro.
 *
 * `tema.css` pone el oscuro con el sistema en oscuro, salvo que la raíz lleve
 * `data-tema="claro"`, y siempre que lleve `data-tema="oscuro"`. La elección se guarda en el
 * `localStorage` del dispositivo, porque es lo único que se puede leer de forma síncrona: un guion
 * en línea del `<head>` (`GUION_DEL_TEMA`) la lee y pone el atributo antes de la primera pintura,
 * así que nunca se ve el otro tema. Con Sistema no hay atributo y manda el CSS.
 *
 * El guion también ajusta las etiquetas `theme-color` (la barra del navegador) y `color-scheme`
 * (el lienzo antes de que llegue la hoja), y `aplicarEleccionDeTema` hace lo mismo al cambiar
 * de elección con la web abierta.
 */
import type { HtmlTagDescriptor, Plugin } from "vite";

import type { Tema } from "./tokens.ts";

export type EleccionDeTema = "sistema" | Tema;

export const ELECCIONES_DE_TEMA: ReadonlyArray<EleccionDeTema> = ["sistema", "claro", "oscuro"];

/** La clave de la elección en el `localStorage`. Sin ella, Sistema. */
export const CLAVE_DEL_TEMA = "celda:tema";

/** El tema del sistema, que la web sigue con Sistema. */
export const CONSULTA_DEL_OSCURO = "(prefers-color-scheme: dark)";

/** Lo que hace falta del `localStorage`. */
export type AlmacenDelTema = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** La elección guardada. Si no hay ninguna, no vale o no se puede leer, Sistema. */
export const leerEleccionDeTema = (almacen: AlmacenDelTema | undefined): EleccionDeTema => {
  try {
    const guardada = almacen?.getItem(CLAVE_DEL_TEMA);
    return guardada === "claro" || guardada === "oscuro" ? guardada : "sistema";
  } catch {
    return "sistema";
  }
};

/** Guarda la elección; Sistema borra la clave. Dice si se ha podido guardar. */
export const guardarEleccionDeTema = (
  almacen: AlmacenDelTema | undefined,
  eleccion: EleccionDeTema,
): boolean => {
  if (almacen === undefined) return false;
  try {
    if (eleccion === "sistema") almacen.removeItem(CLAVE_DEL_TEMA);
    else almacen.setItem(CLAVE_DEL_TEMA, eleccion);
    return true;
  } catch {
    return false;
  }
};

const CONSULTA_DE_CADA_TEMA: Readonly<Record<Tema, string>> = {
  claro: "(prefers-color-scheme: light)",
  oscuro: CONSULTA_DEL_OSCURO,
};

/**
 * La consulta `media` de la etiqueta `theme-color` de cada tema. Con Sistema, la del tema del
 * sistema; con un tema elegido, la suya vale siempre y la del otro nunca.
 */
export const consultaDeLaBarra = (tema: Tema, eleccion: EleccionDeTema): string =>
  eleccion === "sistema" ? CONSULTA_DE_CADA_TEMA[tema] : eleccion === tema ? "all" : "not all";

const ESQUEMA: Readonly<Record<EleccionDeTema, string>> = {
  sistema: "light dark",
  claro: "light",
  oscuro: "dark",
};

/**
 * Pone la elección en el documento: el atributo de la raíz, las etiquetas `theme-color`
 * (marcadas con el tema de cada una en `data-tema`) y `color-scheme`.
 */
export const aplicarEleccionDeTema = (documento: Document, eleccion: EleccionDeTema): void => {
  const raiz = documento.documentElement;
  if (eleccion === "sistema") raiz.removeAttribute("data-tema");
  else raiz.setAttribute("data-tema", eleccion);
  for (const barra of documento.querySelectorAll('meta[name="theme-color"][data-tema]')) {
    const tema = barra.getAttribute("data-tema");
    if (tema === "claro" || tema === "oscuro")
      barra.setAttribute("media", consultaDeLaBarra(tema, eleccion));
  }
  const esquema = documento.querySelector('meta[name="color-scheme"]');
  esquema?.setAttribute("content", ESQUEMA[eleccion]);
};

/**
 * Lo mismo que `aplicarEleccionDeTema` al abrir la página con un tema elegido, en JavaScript
 * sencillo para el `<head>`. Va detrás de las etiquetas `theme-color` y antes de pintar nada. Si
 * el navegador no deja leer el `localStorage`, no hace nada y queda Sistema.
 */
export const GUION_DEL_TEMA =
  `try{var t=localStorage.getItem(${JSON.stringify(CLAVE_DEL_TEMA)});` +
  `if(t==="claro"||t==="oscuro"){var d=document;d.documentElement.setAttribute("data-tema",t);` +
  `d.querySelectorAll('meta[name="theme-color"][data-tema]').forEach(function(m){` +
  `m.setAttribute("media",m.getAttribute("data-tema")===t?"all":"not all")});` +
  `var c=d.querySelector('meta[name="color-scheme"]');if(c)c.setAttribute("content",t==="claro"?"light":"dark")}` +
  `}catch(e){}`;

/**
 * El hash del guion para una CSP. Hoy la web no lleva CSP; si un día la lleva, `script-src`
 * tiene que incluir este valor entre comillas simples o el guion no correrá y la web saldrá
 * siempre con el tema del sistema. Una prueba falla si el guion cambia y el hash no.
 */
export const HASH_DEL_GUION_DEL_TEMA = "sha256-/kNsuin1S0rUl0nQCsonXR3I5I8eha6VIsnlR8K2nGc=";

/**
 * Plugin de Vite que pone `GUION_DEL_TEMA` en el `<head>` del HTML, antes de la hoja de estilos:
 * un guion detrás de una hoja espera a que llegue. Va detrás de `iconosDeCelda()` en la lista de
 * plugins, para que el guion quede después de las etiquetas `theme-color` que ajusta.
 */
export const temaAntesDePintar = (): Plugin => ({
  name: "celda-tema-elegido",
  transformIndexHtml: { order: "pre", handler: etiquetasDelTema },
});

/** Lo que el plugin pone en el HTML: el guion, tal cual, al final del `<head>` de partida. */
export const etiquetasDelTema = (): Array<HtmlTagDescriptor> => [
  { tag: "script", children: GUION_DEL_TEMA, injectTo: "head" },
];
