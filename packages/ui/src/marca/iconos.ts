/**
 * PROTOTIPO (logo y controles): el favicon, los iconos PNG y el manifiesto, generados en la build
 * desde la geometría de la marca (`geometria.ts`) y los tokens de `tema.css`. Así no hay colores
 * sueltos ni ficheros binarios que se desfasen del tema: cambiar un token cambia los iconos.
 *
 * `iconosDeCelda()` es un plugin de Vite: en desarrollo sirve los ficheros y en la build los
 * escribe en `dist/iconos/`. También pone en el HTML los enlaces a los de la marca de hoy.
 */
// El plugin corre en Node al construir, fuera de cualquier programa de Effect.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";

import type { Plugin } from "vite";

import { leerOklch } from "../mapa/color.ts";
import { leerTokens } from "../tokens.ts";
import {
  CAJA_MARCA,
  carpetaDeIconos,
  ICONOS,
  MARCAS,
  type Marca,
  type Pieza,
  type Punto,
  type Tono,
  trayecto,
  type VarianteMarca,
  VARIANTES_MARCA,
} from "./geometria.ts";
import { type Capa, circuloComoPoligono, rasterizar, type Rgb } from "./raster.ts";

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

interface Composicion {
  /** El fondo, en unidades de la caja de 32: la baldosa del favicon o el cuadrado entero. */
  readonly fondo: ReadonlyArray<Punto> | undefined;
  readonly escala: number;
  readonly tonos: Readonly<Record<Tono, Rgb>>;
}

/** Baldosa con dos esquinas cortadas, como los paneles (`chaflan`). */
const BALDOSA: ReadonlyArray<Punto> = [
  [6, 0],
  [32, 0],
  [32, 26],
  [26, 32],
  [0, 32],
  [0, 6],
];
const CUADRADO: ReadonlyArray<Punto> = [
  [0, 0],
  [32, 0],
  [32, 32],
  [0, 32],
];

/**
 * Cómo se pinta una marca en cada destino. Con baldosa, la figura va clara sobre oscuro. Sin
 * ella (la celda), el hexágono es el fondo oscuro y lo recortado va claro, para que se vea
 * también en una pestaña oscura.
 */
const componer = (marca: Marca, destino: Destino, colores: ColoresIcono): Composicion => {
  const tonos: Record<Tono, Rgb> = marca.baldosa
    ? { tinta: colores.figura, acento: colores.acento, claro: colores.fondo }
    : { tinta: colores.fondo, acento: colores.acento, claro: colores.figura };
  if (destino === "tapiz") {
    // El icono de la pantalla de inicio va a sangre: el sistema lo recorta a su forma.
    return { fondo: CUADRADO, escala: marca.baldosa ? 0.62 : 0.74, tonos };
  }
  return marca.baldosa
    ? { fondo: BALDOSA, escala: 0.8, tonos }
    : { fondo: undefined, escala: 1, tonos };
};

const escalar = (punto: Punto, escala: number): Punto => [
  CAJA_MARCA / 2 + (punto[0] - CAJA_MARCA / 2) * escala,
  CAJA_MARCA / 2 + (punto[1] - CAJA_MARCA / 2) * escala,
];

const contornosDe = (pieza: Pieza): ReadonlyArray<ReadonlyArray<Punto>> =>
  pieza.tipo === "poligono" ? pieza.contornos : [circuloComoPoligono(pieza.centro, pieza.radio)];

/** El SVG del favicon: la misma figura que la cabecera, con los colores del icono. */
export const svgDeIcono = (variante: VarianteMarca, colores: ColoresIcono): string => {
  const marca = MARCAS[variante];
  const { fondo, escala, tonos } = componer(marca, "favicon", colores);
  const piezas = marca.piezas.map((pieza) =>
    pieza.tipo === "poligono"
      ? `<path fill-rule="evenodd" fill="${comoHex(tonos[pieza.tono])}" d="${trayecto(pieza.contornos)}"/>`
      : `<circle fill="${comoHex(tonos[pieza.tono])}" cx="${pieza.centro[0]}" cy="${pieza.centro[1]}" r="${pieza.radio}"/>`,
  );
  const centro = CAJA_MARCA / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CAJA_MARCA} ${CAJA_MARCA}">`,
    `<title>Celda</title>`,
    fondo === undefined ? "" : `<path fill="${comoHex(colores.fondo)}" d="${trayecto([fondo])}"/>`,
    `<g transform="translate(${centro} ${centro}) scale(${escala}) translate(${-centro} ${-centro})">`,
    ...piezas,
    `</g></svg>`,
    "",
  ].join("");
};

/** Los píxeles RGBA de un icono cuadrado de `tamano` px. */
export const pixelesDeIcono = (
  variante: VarianteMarca,
  destino: Destino,
  tamano: number,
  colores: ColoresIcono,
): Uint8Array => {
  const marca = MARCAS[variante];
  const { fondo, escala, tonos } = componer(marca, destino, colores);
  const aPixeles = (punto: Punto): Punto => [
    (punto[0] * tamano) / CAJA_MARCA,
    (punto[1] * tamano) / CAJA_MARCA,
  ];
  const capas: Array<Capa> = [];
  if (fondo !== undefined) capas.push({ contornos: [fondo.map(aPixeles)], color: colores.fondo });
  for (const pieza of marca.piezas) {
    capas.push({
      contornos: contornosDe(pieza).map((contorno) =>
        contorno.map((punto) => aPixeles(escalar(punto, escala))),
      ),
      color: tonos[pieza.tono],
    });
  }
  return rasterizar(tamano, capas);
};

const trozo = (tipo: string, datos: Uint8Array): Uint8Array => {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(datos.length, 0);
  cabecera.write(tipo, 4, "ascii");
  const cola = Buffer.alloc(4);
  cola.writeUInt32BE(NodeZlib.crc32(Buffer.concat([cabecera.subarray(4), datos])), 0);
  return Buffer.concat([cabecera, datos, cola]);
};

/** Un PNG RGBA de 8 bits a partir de sus píxeles. */
export const codificarPng = (tamano: number, pixeles: Uint8Array): Uint8Array => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamano, 0);
  ihdr.writeUInt32BE(tamano, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  const filas = Buffer.alloc(tamano * (tamano * 4 + 1));
  for (let fila = 0; fila < tamano; fila += 1) {
    const inicio = fila * (tamano * 4 + 1);
    // Filtro 0 (ninguno) en cada fila.
    filas.set(pixeles.subarray(fila * tamano * 4, (fila + 1) * tamano * 4), inicio + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", NodeZlib.deflateSync(filas, { level: 9 })),
    trozo("IEND", new Uint8Array()),
  ]);
};

const manifiesto = (variante: VarianteMarca, colores: ColoresIcono): string => {
  const carpeta = carpetaDeIconos(variante);
  return `${JSON.stringify(
    {
      name: "Celda",
      short_name: "Celda",
      description:
        "Las antenas de telefonía móvil de Barcelona en un mapa: de qué compañía son y cómo llega su señal.",
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

/** Todos los ficheros de iconos, por ruta sin la barra inicial. */
export const ficherosDeIconos = (css: string): ReadonlyMap<string, string | Uint8Array> => {
  const colores = coloresDeIconos(css);
  const ficheros = new Map<string, string | Uint8Array>();
  for (const variante of VARIANTES_MARCA) {
    const carpeta = carpetaDeIconos(variante).slice(1);
    const png = (destino: Destino, tamano: number) =>
      codificarPng(tamano, pixelesDeIcono(variante, destino, tamano, colores));
    ficheros.set(`${carpeta}/${ICONOS.svg}`, svgDeIcono(variante, colores));
    ficheros.set(`${carpeta}/${ICONOS.png32}`, png("favicon", 32));
    ficheros.set(`${carpeta}/${ICONOS.toque}`, png("tapiz", 180));
    ficheros.set(`${carpeta}/${ICONOS.png192}`, png("tapiz", 192));
    ficheros.set(`${carpeta}/${ICONOS.png512}`, png("tapiz", 512));
    ficheros.set(`${carpeta}/${ICONOS.manifiesto}`, manifiesto(variante, colores));
  }
  return ficheros;
};

/** El tipo MIME de cada fichero de iconos, por su extensión. */
const tipoDe = (ruta: string): string =>
  ruta.endsWith(".svg")
    ? "image/svg+xml"
    : ruta.endsWith(".png")
      ? "image/png"
      : "application/manifest+json";

/** El plugin de Vite que sirve, escribe y enlaza los iconos. */
export const iconosDeCelda = (): Plugin => {
  const leer = () =>
    ficherosDeIconos(NodeFS.readFileSync(new URL("../tema.css", import.meta.url), "utf8"));
  const carpeta = carpetaDeIconos("actual");
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
    transformIndexHtml() {
      return [
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
  };
};
