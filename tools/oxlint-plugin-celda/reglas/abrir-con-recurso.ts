import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, unwrapExpression } from "../utils.ts";

/**
 * En Solid 2 la segunda función de `createEffect` vuelve a correr, y antes cierra lo anterior, cada
 * vez que cambia algo que lee la primera, aunque dé lo mismo. Lo que abra ahí se cierra y se reabre
 * sin que nadie lo pida: así el GPS se abrió 3135 veces en 7 s. `onSettled` no se repite, pero
 * tampoco se vigila ni tiene clave. Lo que abre algo va en `recurso()` de `@celda/ui/recurso.ts`,
 * con una clave estable (docs/patterns/efectos.md).
 *
 * La regla mira lo que hay escrito dentro de la función, también en funciones anidadas. Lo que se
 * abra a través de otra función llamada desde ahí no lo ve.
 */

/** Métodos que abren algo, sea quien sea el objeto: el GPS, escuchadores, el mapa, un Worker. */
const METODOS = new Set([
  "watchPosition",
  "getCurrentPosition",
  "addEventListener",
  "on",
  "once",
  "postMessage",
  "observe",
  // Un runtime de Effect: cada ejecución es una fibra con su suscripción o su petición.
  "runPromise",
  "runPromiseExit",
  "runFork",
  "runCallback",
]);

/** Funciones globales que abren algo, llamadas solas o desde `window`, `globalThis` o `self`. */
const GLOBALES = new Set([
  "fetch",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
]);

const RAICES_GLOBALES = new Set(["window", "globalThis", "self"]);

/** Constructores que abren algo. */
const CONSTRUCTORES = new Set([
  "Worker",
  "SharedWorker",
  "WebSocket",
  "EventSource",
  "BroadcastChannel",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "PerformanceObserver",
]);

/** Dónde no se abre nada: el nombre de la función y qué argumento es la función que corre. */
const LUGARES = new Map([
  ["createEffect", 1],
  ["createRenderEffect", 1],
  ["onSettled", 0],
]);

const nombreDe = (nodo: ESTree.Node | null | undefined): Option.Option<string> =>
  Option.flatMap(unwrapExpression(nodo), (expresion) =>
    expresion.type === "Identifier" ? Option.some(expresion.name) : Option.none(),
  );

/** Lo que abre una llamada, si abre algo: `addEventListener`, `fetch`, `indexedDB.open`… */
const aperturaDeLlamada = (llamada: ESTree.CallExpression): Option.Option<string> => {
  const callee = unwrapExpression(llamada.callee);
  if (Option.isNone(callee)) return Option.none();
  const funcion = callee.value;
  if (funcion.type === "Identifier") {
    return GLOBALES.has(funcion.name) ? Option.some(funcion.name) : Option.none();
  }
  if (funcion.type !== "MemberExpression") return Option.none();
  const metodo = getPropertyName(funcion.property);
  if (Option.isNone(metodo)) return Option.none();
  const objeto = nombreDe(funcion.object);
  if (METODOS.has(metodo.value)) return metodo;
  if (GLOBALES.has(metodo.value) && Option.exists(objeto, (raiz) => RAICES_GLOBALES.has(raiz))) {
    return metodo;
  }
  if (metodo.value === "open" && Option.exists(objeto, (raiz) => raiz === "indexedDB")) {
    return Option.some("indexedDB.open");
  }
  return Option.none();
};

const aperturaDeConstructor = (nuevo: ESTree.NewExpression): Option.Option<string> =>
  Option.filter(nombreDe(nuevo.callee), (nombre) => CONSTRUCTORES.has(nombre)).pipe(
    Option.map((nombre) => `new ${nombre}`),
  );

/** La función que corre en ese lugar: el argumento, o `effect` si es `{ effect, error }`. */
const funcionDelLugar = (argumento: ESTree.Node | undefined): Option.Option<ESTree.Node> =>
  Option.flatMap(unwrapExpression(argumento), (expresion) => {
    if (expresion.type === "ArrowFunctionExpression" || expresion.type === "FunctionExpression") {
      return Option.some(expresion);
    }
    if (expresion.type !== "ObjectExpression") return Option.none();
    for (const propiedad of expresion.properties) {
      if (
        propiedad.type === "Property" &&
        Option.exists(getPropertyName(propiedad.key), (clave) => clave === "effect")
      ) {
        return funcionDelLugar(propiedad.value);
      }
    }
    return Option.none();
  });

const mensaje = (apertura: string, lugar: string) =>
  lugar === "onSettled"
    ? `\`${apertura}\` dentro de onSettled: abre los recursos con recursoFijo() o recurso() de @celda/ui/recurso.ts, que los cierra y vigila cuántas veces se abren (docs/patterns/efectos.md).`
    : `\`${apertura}\` dentro de la segunda función de ${lugar}: se reabriría cada vez que el efecto vuelve a correr, aunque su clave no cambie. Ábrelo con recurso() de @celda/ui/recurso.ts y una clave estable (docs/patterns/efectos.md).`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Prohíbe abrir recursos (GPS, escuchadores, temporizadores, fotogramas, peticiones, Workers, observadores, ejecuciones de Effect) en la segunda función de createEffect o en onSettled: van en recurso().",
    },
  },
  createOnce(context) {
    /** Los tramos del código que son funciones de efecto o de onSettled, con su lugar. */
    let tramos: Array<{ readonly desde: number; readonly hasta: number; readonly lugar: string }> =
      [];

    const lugarDe = (nodo: ESTree.Node): Option.Option<string> =>
      Option.fromNullishOr(
        tramos.findLast((tramo) => nodo.start >= tramo.desde && nodo.end <= tramo.hasta),
      ).pipe(Option.map((tramo) => tramo.lugar));

    const informar = (nodo: ESTree.Node, apertura: Option.Option<string>) => {
      if (Option.isNone(apertura)) return;
      const lugar = lugarDe(nodo);
      if (Option.isNone(lugar)) return;
      context.report({ node: nodo, message: mensaje(apertura.value, lugar.value) });
    };

    return {
      Program() {
        tramos = [];
      },
      CallExpression(nodo) {
        const nombre = nombreDe(nodo.callee);
        const posicion = Option.flatMap(nombre, (n) => Option.fromNullishOr(LUGARES.get(n)));
        if (Option.isSome(nombre) && Option.isSome(posicion)) {
          const funcion = funcionDelLugar(nodo.arguments[posicion.value]);
          if (Option.isSome(funcion)) {
            tramos.push({
              desde: funcion.value.start,
              hasta: funcion.value.end,
              lugar: nombre.value,
            });
          }
        }
        informar(nodo, aperturaDeLlamada(nodo));
      },
      NewExpression(nodo) {
        informar(nodo, aperturaDeConstructor(nodo));
      },
    };
  },
});
