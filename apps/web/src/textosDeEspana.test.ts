// @vitest-environment node
// La prueba lee el código fuente del disco: no usa Effect ni el navegador.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { parseSync, Visitor } from "vite/rolldown/utils";

/**
 * Celda es de toda España (#52). Ningún texto de la interfaz dice «Barcelona» salvo donde
 * Barcelona tiene datos que no tiene nadie más: sus 73 barrios, con sus límites y su padrón del
 * Ayuntamiento. Esta prueba lee las cadenas y el texto JSX de la web, la librería de componentes y
 * el dominio (sin comentarios, pruebas ni datos de prueba) y falla con cualquier «Barcelona» que
 * no esté en `JUSTIFICADOS`, y con cualquier entrada de `JUSTIFICADOS` que ya no haga falta.
 */

const RAIZ = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));

/** Dónde están los textos de la interfaz. */
const CARPETAS = ["apps/web/src", "packages/ui/src", "packages/dominio/src"];

/** Los metadatos de la página, que no son código. */
const PAGINAS = ["apps/web/index.html"];

/** Pruebas, sus dobles y sus datos: no llegan a la interfaz. */
const esDePrueba = (ruta: string): boolean =>
  /\.test\.tsx?$/u.test(ruta) || /(^|\/)pruebas(\/|[A-Z.])/u.test(ruta);

interface Justificado {
  readonly fichero: string;
  /** Un trozo del texto que lo dice. */
  readonly texto: string;
  readonly motivo: string;
}

/** Donde «Barcelona» es un dato que solo tiene Barcelona, o no llega a la interfaz. */
const JUSTIFICADOS: ReadonlyArray<Justificado> = [
  {
    fichero: "packages/dominio/src/licencias.ts",
    texto: "Barrios de Barcelona (Open Data BCN)",
    motivo:
      "los límites de barrio son del Ayuntamiento de Barcelona y su crédito lo pide (ADR 0021)",
  },
  {
    fichero: "packages/dominio/src/licencias.ts",
    texto: "Ajuntament de Barcelona",
    motivo: "es el crédito literal de los límites de barrio (ADR 0021)",
  },
  {
    fichero: "apps/web/src/ejercicio/estado.ts",
    texto: "Barrio de Barcelona",
    motivo: "los barrios del ejercicio son solo los de Barcelona",
  },
  {
    fichero: "apps/web/src/ejercicio/estado.ts",
    texto: "Barcelona",
    motivo: "la provincia de un barrio es siempre la de Barcelona",
  },
  {
    fichero: "apps/web/src/ejercicio/PanelEjercicio.tsx",
    texto: "En Barcelona, en el barrio",
    motivo: "elegir en el mapa da un barrio solo en Barcelona",
  },
  {
    fichero: "apps/web/src/ejercicio/PanelEjercicio.tsx",
    texto: "73 barrios de Barcelona",
    motivo: "el padrón por barrio es el del Ayuntamiento de Barcelona",
  },
  {
    fichero: "apps/web/src/ficha/fichasCorregidas.ts",
    texto: "08014 Barcelona",
    motivo: "fichas de ejemplo de las pruebas de correcciones",
  },
  {
    fichero: "packages/dominio/src/medida.ts",
    texto: "Plaça de Catalunya, Barcelona",
    motivo: "la medida de ejemplo se tomó ahí; es un ejemplo, no dice dónde está Celda",
  },
];

interface Aparicion {
  readonly fichero: string;
  readonly texto: string;
}

/** Los ficheros de código de una carpeta, sin los de prueba, en orden. */
const codigoDe = (carpeta: string): ReadonlyArray<string> =>
  NodeFS.readdirSync(NodePath.join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })
    .map((ruta) => NodePath.posix.join(carpeta, ruta.split(NodePath.sep).join("/")))
    .filter((ruta) => /\.tsx?$/u.test(ruta) && !esDePrueba(ruta))
    .toSorted();

/** Cada cadena, trozo de plantilla y texto JSX de un fichero, sin los comentarios. */
const textosDe = (fichero: string, fuente: string): ReadonlyArray<string> => {
  const textos: Array<string> = [];
  new Visitor({
    // Solo una cadena puede decir «Barcelona»; el resto de literales dan su número o su patrón.
    Literal: (nodo) => {
      textos.push(String(nodo.value));
    },
    TemplateElement: (nodo) => {
      textos.push(nodo.value.raw);
    },
    JSXText: (nodo) => {
      textos.push(nodo.value);
    },
  }).visit(parseSync(fichero, fuente).program);
  return textos;
};

const apariciones = (): ReadonlyArray<Aparicion> => {
  const encontradas: Array<Aparicion> = [];
  for (const fichero of CARPETAS.flatMap(codigoDe)) {
    const fuente = NodeFS.readFileSync(NodePath.join(RAIZ, fichero), "utf8");
    if (!fuente.includes("Barcelona")) continue;
    for (const texto of textosDe(fichero, fuente)) {
      if (texto.includes("Barcelona")) encontradas.push({ fichero, texto: texto.trim() });
    }
  }
  for (const fichero of PAGINAS) {
    const fuente = NodeFS.readFileSync(NodePath.join(RAIZ, fichero), "utf8");
    for (const linea of fuente.split("\n")) {
      if (linea.includes("Barcelona")) encontradas.push({ fichero, texto: linea.trim() });
    }
  }
  return encontradas;
};

const justifica = (justificado: Justificado, aparicion: Aparicion): boolean =>
  justificado.fichero === aparicion.fichero && aparicion.texto.includes(justificado.texto);

describe("textos de toda España", () => {
  const encontradas = apariciones();

  it("ningún texto de la interfaz dice Barcelona fuera de los sitios justificados", () => {
    const sueltas = encontradas.filter((a) => !JUSTIFICADOS.some((j) => justifica(j, a)));
    assert.deepStrictEqual(
      sueltas.map((a) => `${a.fichero}: «${a.texto}»`),
      [],
      "Celda es de toda España: quita «Barcelona» o, si es un dato que solo tiene Barcelona, " +
        "añádelo a JUSTIFICADOS con su motivo.",
    );
  });

  it("cada sitio justificado sigue haciendo falta", () => {
    const sobran = JUSTIFICADOS.filter((j) => !encontradas.some((a) => justifica(j, a)));
    assert.deepStrictEqual(
      sobran.map((j) => `${j.fichero}: «${j.texto}»`),
      [],
      "Esta entrada de JUSTIFICADOS ya no dice Barcelona en ninguna parte: bórrala.",
    );
  });

  it("la prueba encuentra lo que busca: un texto de la web, una plantilla y un texto JSX", () => {
    const textos = textosDe(
      "prueba.tsx",
      [
        "// Barcelona en un comentario no cuenta",
        'const a = "de Barcelona";',
        "const b = `En ${a}, Barcelona`;",
        "const C = () => <p>Mapa de Barcelona</p>;",
      ].join("\n"),
    ).filter((texto) => texto.includes("Barcelona"));
    assert.deepStrictEqual(textos, ["de Barcelona", ", Barcelona", "Mapa de Barcelona"]);
  });
});
