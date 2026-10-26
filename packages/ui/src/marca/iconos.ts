/**
 * El favicon, los iconos PNG y el manifiesto, generados en la build
 * desde la geometría de la marca (`geometria.ts`) y los tokens de `tema.css`. Así no hay colores
 * sueltos ni ficheros binarios que se desfasen del tema: cambiar un token cambia los iconos.
 *
 * `iconosDeCelda()` es un plugin de Vite: en desarrollo sirve los ficheros y en la build los
 * escribe en `dist/iconos/`. También pone en el HTML los enlaces a ellos.
 */
// El plugin corre en Node al construir, fuera de cualquier programa de Effect.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import type { Plugin } from "vite";

import { leerOklch } from "../mapa/color.ts";
import { consultaDeLaBarra } from "../temaElegido.ts";
import { leerTokens, type Tema } from "../tokens.ts";
import {
  CAJA_MARCA,
  CARPETA_ICONOS,
  ICONOS,
  MARCA,
  type Punto,
  type Tono,
  trayecto,
} from "./geometria.ts";
import { estiloDeLaPagina, HOJA_DE_LA_PAGINA } from "../api/pagina.ts";
import { ALTERNATIVO_AL_COMPARTIR, COMPARTIR, SITIO, TITULO_AL_COMPARTIR } from "./alCompartir.ts";
import { codificarPng } from "./png.ts";
import { type Capa, rasterizar, type Rgb } from "./raster.ts";

/** Los colores de un icono, leídos de los tokens `--icono-*` y del tema claro. */
export interface ColoresIcono {
  readonly fondo: Rgb;
  readonly figura: Rgb;
  readonly acento: Rgb;
  /** Barra del navegador de la web instalada. */
  readonly tema: Rgb;
  /** Fondo de la pantalla de arranque de la web instalada. */
  readonly arranque: Rgb;
}

export const coloresDeIconos = (css: string): ColoresIcono => {
  const tokens = leerTokens(css, "claro");
  const color = (nombre: string): Rgb => {
    const leido = leerOklch(tokens.get(nombre) ?? "");
    if (leido === null) throw new Error(`Falta el token --${nombre} en tema.css`);
    return leido;
  };
  return {
    fondo: color("icono-fondo"),
    figura: color("icono-figura"),
    acento: color("icono-acento"),
    tema: color("superficie"),
    arranque: color("mapa-fondo"),
  };
};

const canal = (valor: number): string =>
  Math.round(Math.min(1, Math.max(0, valor)) * 255)
    .toString(16)
    .padStart(2, "0");

/** `#rrggbb`, que entienden el SVG, el manifiesto y cualquier navegador. */
export const comoHex = (color: Rgb): string =>
  `#${canal(color.r)}${canal(color.g)}${canal(color.b)}`;

type Destino = "favicon" | "tapiz";

const CUADRADO: ReadonlyArray<Punto> = [
  [0, 0],
  [32, 0],
  [32, 32],
  [0, 32],
];

/**
 * Los colores de cada tono en los iconos. La figura oscura es el fondo del icono y lo recortado
 * va claro: así se ve en pestañas claras y oscuras sin baldosa detrás.
 */
const tonosDeIcono = (colores: ColoresIcono): Readonly<Record<Tono, Rgb>> => ({
  tinta: colores.fondo,
  acento: colores.acento,
  claro: colores.figura,
});

/**
 * El favicon es la figura a tamaño completo, sin fondo. El icono de la pantalla de inicio va a
 * sangre, sobre un cuadrado oscuro, porque el sistema lo recorta a su forma.
 */
const composicion = (destino: Destino) =>
  destino === "tapiz" ? { fondo: CUADRADO, escala: 0.74 } : { fondo: undefined, escala: 1 };

const escalar = (punto: Punto, escala: number): Punto => [
  CAJA_MARCA / 2 + (punto[0] - CAJA_MARCA / 2) * escala,
  CAJA_MARCA / 2 + (punto[1] - CAJA_MARCA / 2) * escala,
];

/** El SVG del favicon: la misma figura que la cabecera, con los colores del icono. */
export const svgDeIcono = (colores: ColoresIcono): string => {
  const tonos = tonosDeIcono(colores);
  const piezas = MARCA.map(
    (pieza) =>
      `<path fill-rule="evenodd" fill="${comoHex(tonos[pieza.tono])}" d="${trayecto(pieza.contornos)}"/>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CAJA_MARCA} ${CAJA_MARCA}">`,
    `<title>Celda</title>`,
    ...piezas,
    `</svg>`,
    "",
  ].join("");
};

/** Los píxeles RGBA de un icono cuadrado de `tamano` px. */
export const pixelesDeIcono = (
  destino: Destino,
  tamano: number,
  colores: ColoresIcono,
): Uint8Array => {
  const { fondo, escala } = composicion(destino);
  const tonos = tonosDeIcono(colores);
  const aPixeles = (punto: Punto): Punto => [
    (punto[0] * tamano) / CAJA_MARCA,
    (punto[1] * tamano) / CAJA_MARCA,
  ];
  const capas: Array<Capa> = [];
  if (fondo !== undefined) capas.push({ contornos: [fondo.map(aPixeles)], color: colores.fondo });
  for (const pieza of MARCA) {
    capas.push({
      contornos: pieza.contornos.map((contorno) =>
        contorno.map((punto) => aPixeles(escalar(punto, escala))),
      ),
      color: tonos[pieza.tono],
    });
  }
  return rasterizar(tamano, tamano, capas);
};

/**
 * La descripción de la página, del manifiesto y de la tarjeta al compartir un enlace, con la misión
 * de Celda (ADR 0031). Cabe entera en un buscador y en la vista previa de WhatsApp.
 */
export const DESCRIPCION =
  "Las antenas de telefonía móvil de España en un mapa, con datos oficiales: de qué compañía son, en qué bandas emiten y qué ha medido el ministerio.";

const manifiesto = (colores: ColoresIcono): string => {
  const carpeta = CARPETA_ICONOS;
  return `${JSON.stringify(
    {
      name: "Celda",
      short_name: "Celda",
      description: DESCRIPCION,
      lang: "es",
      start_url: "/",
      display: "standalone",
      background_color: comoHex(colores.arranque),
      theme_color: comoHex(colores.tema),
      icons: [
        { src: `${carpeta}/${ICONOS.png192}`, sizes: "192x192", type: "image/png" },
        { src: `${carpeta}/${ICONOS.png512}`, sizes: "512x512", type: "image/png" },
        { src: `${carpeta}/${ICONOS.svg}`, sizes: "any", type: "image/svg+xml" },
      ],
    },
    null,
    2,
  )}\n`;
};

/**
 * El color de la barra del navegador y de la web instalada en cada tema: la superficie de la
 * interfaz. Va en una etiqueta `theme-color` por tema, que pasa por delante del `theme_color` del
 * manifiesto, que solo puede tener uno.
 */
export const coloresDeLaBarra = (css: string): Readonly<Record<Tema, string>> => {
  const superficie = (tema: Tema): string => {
    const leido = leerOklch(leerTokens(css, tema).get("superficie") ?? "");
    if (leido === null) throw new Error(`Falta el token --superficie del tema ${tema} en tema.css`);
    return comoHex(leido);
  };
  return { claro: superficie("claro"), oscuro: superficie("oscuro") };
};

/** Todos los ficheros de iconos, por ruta sin la barra inicial. */
export const ficherosDeIconos = (css: string): ReadonlyMap<string, string | Uint8Array> => {
  const colores = coloresDeIconos(css);
  const ficheros = new Map<string, string | Uint8Array>();
  const carpeta = CARPETA_ICONOS.slice(1);
  const png = (destino: Destino, tamano: number) =>
    codificarPng(tamano, tamano, pixelesDeIcono(destino, tamano, colores));
  ficheros.set(`${carpeta}/${ICONOS.svg}`, svgDeIcono(colores));
  ficheros.set(`${carpeta}/${ICONOS.png32}`, png("favicon", 32));
  ficheros.set(`${carpeta}/${ICONOS.toque}`, png("tapiz", 180));
  ficheros.set(`${carpeta}/${ICONOS.png192}`, png("tapiz", 192));
  ficheros.set(`${carpeta}/${ICONOS.png512}`, png("tapiz", 512));
  ficheros.set(`${carpeta}/${ICONOS.manifiesto}`, manifiesto(colores));
  // La hoja de la página de la API (`../api/pagina.ts`): la función de Vercel no puede leer el tema.
  ficheros.set(`${carpeta}/${HOJA_DE_LA_PAGINA}`, estiloDeLaPagina(css));
  return ficheros;
};

/** El tipo MIME de cada fichero de iconos, por su extensión. */
const tipoDe = (ruta: string): string =>
  ruta.endsWith(".svg")
    ? "image/svg+xml"
    : ruta.endsWith(".png")
      ? "image/png"
      : ruta.endsWith(".css")
        ? "text/css"
        : "application/manifest+json";

/**
 * Las etiquetas Open Graph, que leen WhatsApp, Telegram, LinkedIn y las demás, y la de X, que con
 * ellas enseña la tarjeta grande. La imagen la escribe el build de Vercel (`compartir.ts`).
 */
export const etiquetasAlCompartir = () => {
  const propiedades: ReadonlyArray<readonly [string, string]> = [
    ["og:type", "website"],
    ["og:site_name", "Celda"],
    ["og:locale", "es_ES"],
    ["og:url", `${SITIO}/`],
    ["og:title", TITULO_AL_COMPARTIR],
    ["og:description", DESCRIPCION],
    ["og:image", `${SITIO}${COMPARTIR.ruta}`],
    ["og:image:type", "image/png"],
    ["og:image:width", String(COMPARTIR.ancho)],
    ["og:image:height", String(COMPARTIR.alto)],
    ["og:image:alt", ALTERNATIVO_AL_COMPARTIR],
  ];
  return [
    ...propiedades.map(([property, content]) => ({
      tag: "meta",
      attrs: { property, content },
      injectTo: "head" as const,
    })),
    {
      tag: "meta",
      attrs: { name: "twitter:card", content: "summary_large_image" },
      injectTo: "head" as const,
    },
  ];
};

/** El plugin de Vite que sirve, escribe y enlaza los iconos. */
export const iconosDeCelda = (): Plugin => {
  const leerTema = () => NodeFS.readFileSync(new URL("../tema.css", import.meta.url), "utf8");
  const leer = () => ficherosDeIconos(leerTema());
  const carpeta = CARPETA_ICONOS;
  return {
    name: "celda-iconos",
    configureServer(servidor) {
      servidor.middlewares.use((peticion, respuesta, siguiente) => {
        const ruta = (peticion.url ?? "").split("?")[0]?.slice(1) ?? "";
        const fichero = ruta.startsWith("iconos/") ? leer().get(ruta) : undefined;
        if (fichero === undefined) {
          siguiente();
          return;
        }
        respuesta.setHeader("Content-Type", tipoDe(ruta));
        respuesta.end(fichero);
      });
    },
    generateBundle() {
      for (const [ruta, contenido] of leer()) {
        this.emitFile({ type: "asset", fileName: ruta, source: contenido });
      }
    },
    // Antes de que Vite enlace la hoja de estilos, para que el guion del tema, que va detrás y
    // ajusta las etiquetas `theme-color`, corra antes de que llegue la hoja (`temaElegido.ts`).
    transformIndexHtml: {
      order: "pre",
      handler() {
        const barra = coloresDeLaBarra(leerTema());
        return [
          { tag: "meta", attrs: { name: "description", content: DESCRIPCION }, injectTo: "head" },
          ...etiquetasAlCompartir(),
          ...(["claro", "oscuro"] as const).map((tema) => ({
            tag: "meta",
            // `data-tema` dice de qué tema es: con uno elegido en Ajustes, su `media` cambia
            // (`temaElegido.ts`).
            attrs: {
              name: "theme-color",
              content: barra[tema],
              media: consultaDeLaBarra(tema, "sistema"),
              "data-tema": tema,
            },
            injectTo: "head" as const,
          })),
          {
            tag: "link",
            attrs: { rel: "icon", href: `${carpeta}/${ICONOS.svg}`, type: "image/svg+xml" },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: {
              rel: "icon",
              href: `${carpeta}/${ICONOS.png32}`,
              sizes: "32x32",
              type: "image/png",
            },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: { rel: "apple-touch-icon", href: `${carpeta}/${ICONOS.toque}` },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: { rel: "manifest", href: `${carpeta}/${ICONOS.manifiesto}` },
            injectTo: "head",
          },
        ];
      },
    },
  };
};
