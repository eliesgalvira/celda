// @vitest-environment node
// La prueba lee el código fuente del disco: no usa Effect ni el navegador.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { parseSync, Visitor } from "vite/rolldown/utils";

/**
 * Ningún texto de la interfaz enseña un detalle de implementación (docs/patterns/ui.md, «Sin
 * detalles de implementación»): ni un identificador con versión, como «baremos@2» o «indice v1»,
 * ni la versión de una capa o de unas fichas, como «sitios@2026-09-26T02:15:00Z». Esta prueba lee las cadenas, las plantillas y el texto JSX de la
 * web, la librería de componentes y los módulos del dominio que escriben textos, sin comentarios
 * ni pruebas. Una plantilla se lee con un hueco en cada `${…}`, así que también ve
 * `${id}@${version}` y `v${version}`. Lo que se ve al renderizar lo comprueba `jergaEn` en las
 * pruebas de las pantallas, con las claves internas de las fuentes y de los emplazamientos.
 */

const RAIZ = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));

/** Dónde están los textos de la interfaz. */
const CARPETAS = ["apps/web/src", "packages/ui/src"];

/**
 * Los módulos del dominio con textos que se ven: el glosario, las compañías, los códigos del modo
 * de información, los motivos de rechazo del buzón y la medida de ejemplo. El resto del dominio
 * nombra ficheros y versiones (`fichas@…`) que no llegan a la interfaz.
 */
const DEL_DOMINIO = [
  "packages/dominio/src/glosario.ts",
  "packages/dominio/src/compania.ts",
  "packages/dominio/src/modoInformacion.ts",
  "packages/dominio/src/buzon.ts",
  "packages/dominio/src/medida.ts",
];

/** Los metadatos de la página, que no son código. */
const PAGINAS = ["apps/web/index.html"];

/**
 * Pruebas, sus dobles y sus datos: no llegan a la interfaz. Tampoco cuenta la respuesta de ejemplo
 * de la página de la API, que enseña datos exportados con su versión, como los devuelve la API.
 */
const esDePrueba = (ruta: string): boolean =>
  /\.test\.tsx?$/u.test(ruta) ||
  /(^|\/)pruebas(\/|[A-Z.])/u.test(ruta) ||
  ruta === "packages/ui/src/api/ejemplo.ts";

/** El hueco que ocupa cada `${…}` de una plantilla al leerla. */
const HUECO = "${…}";

/** Lo que delata un detalle de implementación en una cadena del código. */
const PATRONES: ReadonlyArray<{ readonly que: string; readonly patron: RegExp }> = [
  { que: "identificador con versión", patron: /@(?:\d|\$\{…\})/u },
  { que: "versión suelta", patron: /(?:^|[^\p{L}\d])v(?:\d+(?![\p{L}\d])|\$\{…\})/u },
  { que: "versión de capa o de fichas", patron: /\b(?:sitios|fichas)@/u },
];

/** Los ficheros de código de una carpeta, sin los de prueba, en orden. */
const codigoDe = (carpeta: string): ReadonlyArray<string> =>
  NodeFS.readdirSync(NodePath.join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })
    .map((ruta) => NodePath.posix.join(carpeta, ruta.split(NodePath.sep).join("/")))
    .filter((ruta) => /\.tsx?$/u.test(ruta) && !esDePrueba(ruta))
    .toSorted();

/** Cada cadena, plantilla (con sus huecos) y texto JSX de un fichero, sin los comentarios. */
const textosDe = (fichero: string, fuente: string): ReadonlyArray<string> => {
  const textos: Array<string> = [];
  new Visitor({
    Literal: (nodo) => {
      textos.push(String(nodo.value));
    },
    TemplateLiteral: (nodo) => {
      textos.push(nodo.quasis.map((trozo) => trozo.value.raw).join(HUECO));
    },
    JSXText: (nodo) => {
      textos.push(nodo.value);
    },
  }).visit(parseSync(fichero, fuente).program);
  return textos;
};

/** Cada texto con jerga, con su fichero y lo que delata. */
const jerga = (fichero: string, textos: ReadonlyArray<string>): ReadonlyArray<string> =>
  textos.flatMap((texto) =>
    PATRONES.filter(({ patron }) => patron.test(texto)).map(
      ({ que }) => `${fichero}: ${que} en «${texto.trim()}»`,
    ),
  );

describe("textos sin detalles de implementación", () => {
  it("ningún texto de la interfaz lleva un identificador con versión ni una versión", () => {
    const ficheros = [...CARPETAS.flatMap(codigoDe), ...DEL_DOMINIO];
    const encontrados = [
      ...ficheros.flatMap((fichero) =>
        jerga(
          fichero,
          textosDe(fichero, NodeFS.readFileSync(NodePath.join(RAIZ, fichero), "utf8")),
        ),
      ),
      ...PAGINAS.flatMap((pagina) =>
        jerga(pagina, NodeFS.readFileSync(NodePath.join(RAIZ, pagina), "utf8").split("\n")),
      ),
    ];
    assert.deepStrictEqual(
      encontrados,
      [],
      "Es un detalle de implementación: quítalo o dilo con palabras llanas. El identificador y " +
        "la versión van en los datos exportados, no en la interfaz.",
    );
  });

  it("la prueba ve el identificador y la versión en una cadena, una plantilla y un texto JSX", () => {
    const textos = textosDe(
      "prueba.tsx",
      [
        "// Formato baremos@2 en un comentario no cuenta",
        'const a = "Formato baremos@2";',
        "const b = `${baremo.id}@${baremo.formato}`;",
        "const c = `${diagrama.id} v${diagrama.version}`;",
        "const d = `capa sitios@${fecha}`;",
        "const E = () => <p>indice v1</p>;",
        'const f = "Ver en el registro oficial";',
        'const g = "Banda de 700 MHz · CC BY 4.0";',
      ].join("\n"),
    );
    assert.deepStrictEqual(
      jerga("prueba.tsx", textos).map((linea) => linea.split(" en «")[0]),
      [
        "prueba.tsx: identificador con versión",
        "prueba.tsx: identificador con versión",
        "prueba.tsx: versión suelta",
        "prueba.tsx: identificador con versión",
        "prueba.tsx: versión de capa o de fichas",
        "prueba.tsx: versión suelta",
      ],
    );
  });
});
