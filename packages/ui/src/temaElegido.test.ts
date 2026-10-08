import { assert, describe, it } from "@effect/vitest";

import {
  type AlmacenDelTema,
  aplicarEleccionDeTema,
  CLAVE_DEL_TEMA,
  ELECCIONES_DE_TEMA,
  GUION_DEL_TEMA,
  guardarEleccionDeTema,
  HASH_DEL_GUION_DEL_TEMA,
  leerEleccionDeTema,
  etiquetasDelTema,
  temaAntesDePintar,
} from "./temaElegido.ts";
import tema from "./tema.css?raw";

/** Un `localStorage` en memoria. */
const almacenDePrueba = (inicial: Record<string, string> = {}) => {
  const datos = new Map(Object.entries(inicial));
  const almacen: AlmacenDelTema = {
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => void datos.set(clave, valor),
    removeItem: (clave) => void datos.delete(clave),
  };
  return { almacen, datos };
};

/** Un almacén que el navegador no deja usar, como Safari con algunas opciones de privacidad. */
const almacenProhibido: AlmacenDelTema = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

/** El `<head>` de la web construida, con lo que ponen `index.html` e `iconosDeCelda`. */
const CABECERA = `
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#e4e1da" media="(prefers-color-scheme: light)" data-tema="claro">
  <meta name="theme-color" content="#272723" media="(prefers-color-scheme: dark)" data-tema="oscuro">`;

/** Un documento nuevo con esa cabecera y un almacén con lo guardado. */
const pagina = (guardado: string | undefined) => {
  const documento = document.implementation.createHTMLDocument("Celda");
  documento.head.innerHTML = CABECERA;
  const { almacen } = almacenDePrueba(guardado === undefined ? {} : { [CLAVE_DEL_TEMA]: guardado });
  return { documento, almacen };
};

/** Corre el guion como en el navegador, con el `document` y el `localStorage` de su página. */
const correrGuion = (documento: Document, almacen: AlmacenDelTema) =>
  new Function("document", "localStorage", GUION_DEL_TEMA)(documento, almacen);

/** Lo que el tema deja en el documento. */
const estado = (documento: Document) => ({
  atributo: documento.documentElement.getAttribute("data-tema"),
  barras: Array.from(
    documento.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
    (barra) => barra.getAttribute("media"),
  ),
  esquema: documento.querySelector('meta[name="color-scheme"]')?.getAttribute("content"),
});

describe("elección de tema guardada", () => {
  it("sin nada guardado, o con algo que no vale, es Sistema", () => {
    assert.strictEqual(leerEleccionDeTema(almacenDePrueba().almacen), "sistema");
    assert.strictEqual(
      leerEleccionDeTema(almacenDePrueba({ [CLAVE_DEL_TEMA]: "azul" }).almacen),
      "sistema",
    );
    assert.strictEqual(leerEleccionDeTema(undefined), "sistema");
    assert.strictEqual(leerEleccionDeTema(almacenProhibido), "sistema");
  });

  it("guarda Claro y Oscuro en el dispositivo, y Sistema borra lo guardado", () => {
    const { almacen, datos } = almacenDePrueba();
    assert.isTrue(guardarEleccionDeTema(almacen, "oscuro"));
    assert.strictEqual(datos.get(CLAVE_DEL_TEMA), "oscuro");
    assert.strictEqual(leerEleccionDeTema(almacen), "oscuro");
    assert.isTrue(guardarEleccionDeTema(almacen, "claro"));
    assert.strictEqual(leerEleccionDeTema(almacen), "claro");
    assert.isTrue(guardarEleccionDeTema(almacen, "sistema"));
    assert.isFalse(datos.has(CLAVE_DEL_TEMA));
  });

  it("dice si no se ha podido guardar", () => {
    assert.isFalse(guardarEleccionDeTema(almacenProhibido, "oscuro"));
    assert.isFalse(guardarEleccionDeTema(undefined, "oscuro"));
  });
});

describe("aplicar la elección al documento", () => {
  it("con un tema elegido, la raíz lo lleva y la barra y el lienzo toman ese tema", () => {
    const { documento } = pagina(undefined);
    aplicarEleccionDeTema(documento, "oscuro");
    assert.deepStrictEqual(estado(documento), {
      atributo: "oscuro",
      barras: ["not all", "all"],
      esquema: "dark",
    });
    aplicarEleccionDeTema(documento, "claro");
    assert.deepStrictEqual(estado(documento), {
      atributo: "claro",
      barras: ["all", "not all"],
      esquema: "light",
    });
  });

  it("con Sistema vuelve a como sale del HTML", () => {
    const { documento } = pagina(undefined);
    const antes = estado(documento);
    aplicarEleccionDeTema(documento, "oscuro");
    aplicarEleccionDeTema(documento, "sistema");
    assert.deepStrictEqual(estado(documento), antes);
    assert.deepStrictEqual(antes, {
      atributo: null,
      barras: ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"],
      esquema: "light dark",
    });
  });
});

describe("guion del <head>", () => {
  it("antes de pintar deja el documento igual que aplicar la elección guardada", () => {
    for (const guardado of [undefined, "azul", ...ELECCIONES_DE_TEMA]) {
      const conGuion = pagina(guardado);
      correrGuion(conGuion.documento, conGuion.almacen);
      const aMano = pagina(guardado);
      aplicarEleccionDeTema(aMano.documento, leerEleccionDeTema(aMano.almacen));
      assert.deepStrictEqual(estado(conGuion.documento), estado(aMano.documento), String(guardado));
    }
  });

  it("si el navegador no deja leer lo guardado, no falla y queda Sistema", () => {
    const { documento } = pagina(undefined);
    correrGuion(documento, almacenProhibido);
    assert.isNull(documento.documentElement.getAttribute("data-tema"));
  });

  it("el plugin lo pone tal cual en el <head>, antes de que Vite enlace la hoja de estilos", () => {
    assert.deepStrictEqual(temaAntesDePintar().transformIndexHtml, {
      order: "pre",
      handler: etiquetasDelTema,
    });
    assert.deepStrictEqual(etiquetasDelTema(), [
      { tag: "script", children: GUION_DEL_TEMA, injectTo: "head" },
    ]);
  });

  it("su hash para una CSP está al día", async () => {
    const huella = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(GUION_DEL_TEMA));
    const base64 = btoa(String.fromCharCode(...new Uint8Array(huella)));
    assert.strictEqual(HASH_DEL_GUION_DEL_TEMA, `sha256-${base64}`);
  });

  it("tema.css pone el oscuro con el sistema salvo con Claro elegido, y siempre con Oscuro", () => {
    const variante = tema.slice(tema.indexOf("@custom-variant oscuro {"));
    const cuerpo = variante.slice(0, variante.indexOf("\n}") + 2).replaceAll(/\s+/gu, " ");
    assert.strictEqual(
      cuerpo,
      '@custom-variant oscuro { @media (prefers-color-scheme: dark) { &:not([data-tema="claro"]) { @slot; } } &[data-tema="oscuro"] { @slot; } }',
    );
  });
});
