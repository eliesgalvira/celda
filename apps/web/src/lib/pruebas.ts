import { GLOSARIO, type Termino } from "@celda/dominio/glosario";
import * as Effect from "effect/Effect";

/**
 * Espera a la siguiente tarea del navegador, como una respuesta de IndexedDB, de la red o de un
 * aviso de permiso: los servicios de prueba contestan así y no en el acto.
 */
export const otraTarea = (): Promise<void> =>
  new Promise((resolver) => {
    // @effect-diagnostics-next-line globalTimers:off
    setTimeout(resolver, 0);
  });

/** `otraTarea` como efecto, para los servicios de prueba. */
export const enOtraTarea: Effect.Effect<void> = Effect.promise(otraTarea);

/**
 * Busca por el texto entero de un elemento aunque un término subrayado lo parta en varios
 * nodos: `getByText(textoEntero("Datos del mapa: 26 sept 2026"))`. Devuelve el elemento más
 * interior que lo contiene entero.
 */
export const textoEntero =
  (texto: string) =>
  (_contenido: string, elemento: Element | null): boolean =>
    elemento?.textContent === texto &&
    Array.from(elemento.children).every((hijo) => hijo.textContent !== texto);

/** Los términos subrayados dentro de un elemento, en orden de lectura. */
export const terminosSubrayados = (dentro: Element): ReadonlyArray<string> =>
  Array.from(
    dentro.querySelectorAll("[data-termino]"),
    (e) => e.getAttribute("data-termino") ?? "",
  );

/** Si un término subrayado en la interfaz tiene entrada en el glosario. */
export const estaEnElGlosario = (termino: string): termino is Termino =>
  Object.hasOwn(GLOSARIO, termino);

/**
 * Lo que delata un detalle de implementación en un texto de la interfaz (docs/patterns/ui.md,
 * «Sin detalles de implementación»): un identificador con versión como «baremos@2», una versión
 * suelta como «v1», el nombre de una versión de capa o de fichas, una clave interna de fuente o de
 * emplazamiento, un UUID o una fecha ISO con hora. Se comprueba sobre lo que se ve y lo que oye
 * un lector de pantalla.
 */
const JERGA: ReadonlyArray<{ readonly que: string; readonly patron: RegExp }> = [
  { que: "identificador con versión", patron: /[\p{L}\d-]@\d/u },
  { que: "versión suelta", patron: /\bv\d+\b/u },
  { que: "versión de capa o de fichas", patron: /\b(?:sitios|fichas)@/u },
  { que: "clave de una fuente", patron: /\bregistro-oficial\b/u },
  {
    que: "clave de un emplazamiento",
    patron: /\b(?:movistar|vodafone|orange|digi|yoigo)(?:-| - )[\dA-Z]/u,
  },
  { que: "UUID", patron: /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/u },
  { que: "fecha ISO con hora", patron: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u },
];

/** Los atributos que dan nombre, descripción o pista a un elemento. */
const ATRIBUTOS_LEIDOS = ["aria-label", "aria-description", "title", "alt", "placeholder"];

/** Cada nodo de texto de un elemento, por separado: juntos, «v1» y «Sector» darían «v1Sector». */
const nodosDeTexto = (raiz: Element): ReadonlyArray<string> => {
  const textos: Array<string> = [];
  const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let nodo = recorrido.nextNode(); nodo !== null; nodo = recorrido.nextNode()) {
    textos.push(nodo.textContent ?? "");
  }
  return textos;
};

/**
 * La jerga de `JERGA` que hay en el texto o en los atributos leídos de un elemento y sus hijos,
 * con lo que es y el trozo que la lleva: vacío si no hay ninguna.
 */
export const jergaEn = (raiz: Element): ReadonlyArray<string> => {
  const textos = [
    ...nodosDeTexto(raiz),
    ...[raiz, ...raiz.querySelectorAll("*")].flatMap((elemento) =>
      ATRIBUTOS_LEIDOS.flatMap((atributo) => elemento.getAttribute(atributo) ?? []),
    ),
  ];
  return JERGA.flatMap(({ que, patron }) =>
    textos.flatMap((texto) => {
      const hallado = patron.exec(texto);
      if (hallado === null) return [];
      const desde = Math.max(0, hallado.index - 30);
      return [`${que}: «…${texto.slice(desde, hallado.index + hallado[0].length + 30)}…»`];
    }),
  );
};
