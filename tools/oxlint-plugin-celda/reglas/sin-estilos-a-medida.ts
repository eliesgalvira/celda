import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { unwrapExpression } from "../utils.ts";

/**
 * ADR 0006: la librería de componentes es el único sitio con estilos. Fuera de
 * `packages/ui` no se escriben `style`, clases propias, hojas de estilo ni
 * colores sueltos; si una pantalla necesita algo nuevo, se añade una variante
 * o un componente a la librería.
 */

const LIBRERIA_UI = /(?:^|\/)packages\/ui\//u;
const MODULO_UI = /^@celda\/ui(?:\/|$)/u;
const ATRIBUTOS_DE_CLASE = new Set(["class", "className", "classList"]);

const HEX_ENTERO = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu;
const HEX_ARBITRARIO = /\[#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\]/iu;
const FUNCION_DE_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/iu;
const PALETA_TAILWIND = new RegExp(
  String.raw`(?<=^|[\s:"'\x60!])(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|accent|caret|divide|placeholder|shadow|inset-shadow|drop-shadow)-` +
    String.raw`(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe)-(?:50|[1-9]00|950)|black|white)(?![\w-])`,
  "u",
);

const esDeLaLibreria = (filename: string): boolean =>
  LIBRERIA_UI.test(filename.replaceAll("\\", "/"));

/** El color suelto que contiene el texto, si lo hay. */
export const colorSuelto = (texto: string): Option.Option<string> => {
  const recortado = texto.trim();
  if (HEX_ENTERO.test(recortado)) return Option.some(recortado);
  const encontrado =
    HEX_ARBITRARIO.exec(texto) ?? FUNCION_DE_COLOR.exec(texto) ?? PALETA_TAILWIND.exec(texto);
  return encontrado === null ? Option.none() : Option.some(encontrado[0].trim());
};

const nombreDeAtributo = (nombre: ESTree.JSXAttribute["name"]): string =>
  nombre.type === "JSXIdentifier" ? nombre.name : `${nombre.namespace.name}:${nombre.name.name}`;

/** El identificador del que sale una expresión: `a` en `a`, `a.b`, `a(…)` o `a.b(…)`. */
const identificadorRaiz = (nodo: ESTree.Node | null | undefined): Option.Option<string> => {
  let actual = unwrapExpression(nodo);
  while (Option.isSome(actual)) {
    const valor = actual.value;
    if (valor.type === "Identifier") return Option.some(valor.name);
    if (valor.type === "CallExpression") {
      actual = unwrapExpression(valor.callee);
    } else if (valor.type === "MemberExpression") {
      actual = unwrapExpression(valor.object);
    } else {
      return Option.none();
    }
  }
  return Option.none();
};

const MENSAJE_ESTILO =
  "No se escriben estilos en línea fuera de packages/ui (ADR 0006). Añade una variante o un componente a la librería.";
const MENSAJE_CLASE =
  "Las clases fuera de packages/ui solo pueden venir de la librería (ADR 0006). Usa un componente o una variante de @celda/ui.";
const MENSAJE_HOJA =
  "Las hojas de estilo viven en packages/ui (ADR 0006). Importa el tema desde @celda/ui.";
const mensajeColor = (color: string) =>
  `Color suelto «${color}» fuera de packages/ui (ADR 0006). Usa un token del tema.`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Prohíbe style, clases propias, hojas de estilo y colores sueltos fuera de packages/ui.",
    },
  },
  create(context) {
    if (esDeLaLibreria(context.filename)) return {};

    const nombresDeLaLibreria = new Set<string>();

    const revisarTexto = (nodo: ESTree.Node, texto: string) => {
      const color = colorSuelto(texto);
      if (Option.isSome(color)) {
        context.report({ node: nodo, message: mensajeColor(color.value) });
      }
    };

    return {
      ImportDeclaration(nodo) {
        const origen = nodo.source.value;
        if (MODULO_UI.test(origen)) {
          for (const especificador of nodo.specifiers) {
            nombresDeLaLibreria.add(especificador.local.name);
          }
          return;
        }
        if (/\.(?:css|scss|sass|less|styl)(?:\?.*)?$/u.test(origen)) {
          context.report({ node: nodo, message: MENSAJE_HOJA });
        }
      },
      JSXAttribute(nodo) {
        const nombre = nombreDeAtributo(nodo.name);
        if (nombre === "style") {
          context.report({ node: nodo, message: MENSAJE_ESTILO });
          return;
        }
        if (!ATRIBUTOS_DE_CLASE.has(nombre)) return;

        const valor = nodo.value;
        const permitido =
          valor?.type === "JSXExpressionContainer" &&
          Option.match(identificadorRaiz(valor.expression), {
            onNone: () => false,
            onSome: (raiz) => nombresDeLaLibreria.has(raiz),
          });
        if (!permitido) {
          context.report({ node: nodo, message: MENSAJE_CLASE });
        }
      },
      Literal(nodo) {
        if (Predicate.isString(nodo.value)) revisarTexto(nodo, nodo.value);
      },
      TemplateElement(nodo) {
        revisarTexto(nodo, nodo.value.cooked ?? nodo.value.raw);
      },
    };
  },
});
