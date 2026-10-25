/**
 * La imagen que enseñan X, WhatsApp y las demás redes al compartir un enlace a Celda: España con
 * sus provincias y un punto por emplazamiento, y la marca en el centro, sin texto. La escribe el
 * build de Vercel con los puntos de la versión que monta (`apps/web/scripts/compartir.ts`), y
 * `iconosDeCelda` pone en el HTML las etiquetas que la enlazan.
 */
import type { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";

import { leerOklch } from "../mapa/color.ts";
import type { ContornoDeEspana } from "../mapa/rotulos.ts";
import { leerTokens, type Tema } from "../tokens.ts";
import { CAJA_MARCA, CARPETA_ICONOS, MARCA, type Punto, type Tono } from "./geometria.ts";
import { codificarPng } from "./png.ts";
import { type Capa, rasterizar, type Rgb } from "./raster.ts";

/** La dirección pública de Celda: las redes solo aceptan la imagen con la URL entera. */
export const SITIO = "https://celda.elies.site";

/** El tamaño que piden X y Facebook para una tarjeta grande: 1,91 a 1. */
export const COMPARTIR = {
  ancho: 1200,
  alto: 630,
  fichero: "compartir.png",
  ruta: `${CARPETA_ICONOS}/compartir.png`,
} as const;

/** El título y la descripción de la tarjeta, y el texto alternativo de su imagen. */
export const TITULO_AL_COMPARTIR = "Celda · Antenas de telefonía móvil de España";
export const ALTERNATIVO_AL_COMPARTIR =
  "Mapa de España con sus provincias y un punto por cada emplazamiento de antenas de telefonía móvil, con el logo de Celda en el centro.";

/** Los colores de la imagen, de los tokens del mapa y de los iconos de un tema. */
export interface ColoresAlCompartir {
  readonly fuera: Rgb;
  readonly tierra: Rgb;
  readonly costa: Rgb;
  readonly comunidad: Rgb;
  readonly provincia: Rgb;
  readonly punto: Rgb;
  readonly marca: Readonly<Record<Tono, Rgb>>;
}

export const coloresAlCompartir = (css: string, tema: Tema): ColoresAlCompartir => {
  const claro = leerTokens(css, "claro");
  const propios = leerTokens(css, tema);
  const color = (nombre: string): Rgb => {
    const leido = leerOklch(propios.get(nombre) ?? claro.get(nombre) ?? "");
    if (leido === null) throw new Error(`Falta el token --${nombre} en tema.css`);
    return leido;
  };
  return {
    fuera: color("mapa-silueta-fuera"),
    tierra: color("mapa-fondo"),
    costa: color("mapa-limite-pais"),
    comunidad: color("mapa-limite-comunidad"),
    provincia: color("mapa-limite-provincia"),
    punto: color("mapa-punto"),
    marca: {
      tinta: color("icono-fondo"),
      acento: color("icono-acento"),
      claro: color("icono-figura"),
    },
  };
};

/** Lo que dibuja la imagen, en grados. */
export interface DatosAlCompartir {
  readonly contorno: ContornoDeEspana;
  readonly limites: LimitesDeComunidadesYProvincias;
  readonly longitud: ArrayLike<number>;
  readonly latitud: ArrayLike<number>;
}

/** Un trozo de España en la imagen: lo que entra de él y dónde va su esquina noroeste. */
interface Encuadre {
  readonly oeste: number;
  readonly este: number;
  readonly sur: number;
  readonly norte: number;
  readonly x: number;
  readonly y: number;
}

/** La latitud en Mercator, en grados, como la ve el mapa de la web. */
const mercator = (latitud: number): number =>
  (Math.log(Math.tan(Math.PI / 4 + (latitud * Math.PI) / 360)) * 180) / Math.PI;

/** La península, Baleares, Ceuta y Melilla. */
const PENINSULA = { oeste: -9.4, este: 4.4, sur: 35.15, norte: 43.85 };

/**
 * Canarias, en un recuadro a la izquierda como en los mapas de España. Va por encima de la franja
 * de abajo, donde X pone el dominio encima de la imagen.
 */
const CANARIAS = { oeste: -18.25, este: -13.3, sur: 27.55, norte: 29.5 };

/** Margen arriba y abajo de la península. */
const MARGEN = 16;

/** Píxeles por grado: la península llena el alto, y Canarias va a la misma escala. */
const ESCALA =
  (COMPARTIR.alto - 2 * MARGEN) / (mercator(PENINSULA.norte) - mercator(PENINSULA.sur));

const EN_LA_PENINSULA: Encuadre = {
  ...PENINSULA,
  x: (COMPARTIR.ancho - (PENINSULA.este - PENINSULA.oeste) * ESCALA) / 2,
  y: MARGEN,
};

/** Lo que deja libre el recuadro de Canarias abajo, para el dominio que pone X. */
const FRANJA_DEL_DOMINIO = 110;

const EN_CANARIAS: Encuadre = {
  ...CANARIAS,
  x: 40,
  y:
    COMPARTIR.alto -
    FRANJA_DEL_DOMINIO -
    (mercator(CANARIAS.norte) - mercator(CANARIAS.sur)) * ESCALA,
};

const ENCUADRES: ReadonlyArray<Encuadre> = [EN_LA_PENINSULA, EN_CANARIAS];

const enEncuadre = (encuadre: Encuadre, longitud: number, latitud: number): boolean =>
  longitud >= encuadre.oeste &&
  longitud <= encuadre.este &&
  latitud >= encuadre.sur &&
  latitud <= encuadre.norte;

/** Dónde cae un punto en la imagen, o `undefined` si no entra en ningún encuadre. */
const proyectar = (longitud: number, latitud: number): Punto | undefined => {
  const encuadre = ENCUADRES.find((e) => enEncuadre(e, longitud, latitud));
  if (encuadre === undefined) return undefined;
  return [
    encuadre.x + (longitud - encuadre.oeste) * ESCALA,
    encuadre.y + (mercator(encuadre.norte) - mercator(latitud)) * ESCALA,
  ];
};

/** Un anillo o una línea en la imagen, sin los vértices que caen fuera de los encuadres. */
const proyectarLinea = (linea: ReadonlyArray<ReadonlyArray<number>>): Array<Punto> =>
  linea
    .map(([lon = 0, lat = 0]) => proyectar(lon, lat))
    .filter((punto): punto is Punto => punto !== undefined);

/** Las líneas de un fichero de límites, en grados: cada una va en diferencias. */
const lineasEnGrados = (
  lineas: ReadonlyArray<ReadonlyArray<number>>,
  porGrado: number,
): Array<Array<[number, number]>> =>
  lineas.map((linea) => {
    const salida: Array<[number, number]> = [];
    let x = 0;
    let y = 0;
    for (let k = 0; k + 1 < linea.length; k += 2) {
      x += linea[k] ?? 0;
      y += linea[k + 1] ?? 0;
      salida.push([x / porGrado, y / porGrado]);
    }
    return salida;
  });

const areaConSigno = (contorno: ReadonlyArray<Punto>): number => {
  let area = 0;
  for (let i = 0; i < contorno.length; i += 1) {
    const [x1, y1] = contorno[i] ?? [0, 0];
    const [x2, y2] = contorno[(i + 1) % contorno.length] ?? [0, 0];
    area += x1 * y2 - x2 * y1;
  }
  return area;
};

/** Todos los contornos en el mismo sentido, para que la regla no-cero los sume. */
const enSentido = (contorno: Array<Punto>): Array<Punto> =>
  areaConSigno(contorno) < 0 ? contorno.toReversed() : contorno;

const circulo = ([cx, cy]: Punto, radio: number): Array<Punto> =>
  Array.from({ length: 8 }, (_, i): Punto => {
    const angulo = (i * Math.PI) / 4;
    return [cx + radio * Math.cos(angulo), cy + radio * Math.sin(angulo)];
  });

/** Un trazo de `ancho` px a lo largo de una línea: un cuadrilátero por tramo y juntas redondas. */
const trazo = (linea: ReadonlyArray<Punto>, ancho: number): Array<Array<Punto>> => {
  const contornos: Array<Array<Punto>> = [];
  const medio = ancho / 2;
  for (const [i, b] of linea.entries()) {
    const a = linea[i - 1];
    if (a === undefined) continue;
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (largo === 0) continue;
    const nx = (-(b[1] - a[1]) / largo) * medio;
    const ny = ((b[0] - a[0]) / largo) * medio;
    contornos.push(
      enSentido([
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ]),
    );
    if (i > 1) contornos.push(enSentido(circulo(a, medio)));
  }
  return contornos;
};

/** Lo que mide la caja de la marca en la imagen. */
const LADO_MARCA = 250;

/**
 * Alrededor de la marca no se pintan puntos, para que se lea sobre el mapa. El radio va en
 * unidades de su caja: el hexágono de la marca mide 15,6.
 */
const RADIO_SIN_PUNTOS = 18.5;

const RAIZ3 = Math.sqrt(3);

/** Si un punto de la imagen cae en el hexágono sin puntos de alrededor de la marca. */
const juntoALaMarca = (x: number, y: number): boolean => {
  const radio = (RADIO_SIN_PUNTOS * LADO_MARCA) / CAJA_MARCA;
  const dx = Math.abs(x - COMPARTIR.ancho / 2);
  const dy = Math.abs(y - COMPARTIR.alto / 2);
  return dx <= (radio * RAIZ3) / 2 && dy <= radio - dx / RAIZ3;
};

const aLaImagen = ([x, y]: Punto): Punto => [
  COMPARTIR.ancho / 2 + ((x - CAJA_MARCA / 2) * LADO_MARCA) / CAJA_MARCA,
  COMPARTIR.alto / 2 + ((y - CAJA_MARCA / 2) * LADO_MARCA) / CAJA_MARCA,
];

/** Los píxeles RGBA de la imagen. */
export const pixelesAlCompartir = (
  datos: DatosAlCompartir,
  colores: ColoresAlCompartir,
): Uint8Array => {
  const anillos = datos.contorno.coordinates.flatMap((poligono) =>
    poligono.map(proyectarLinea).filter((anillo) => anillo.length >= 3),
  );
  const { unidadesPorGrado } = datos.limites;
  const lineas = (cuales: ReadonlyArray<ReadonlyArray<number>>, ancho: number) =>
    lineasEnGrados(cuales, unidadesPorGrado).flatMap((linea) =>
      trazo(proyectarLinea(linea), ancho),
    );
  const centros: Array<number> = [];
  for (let i = 0; i < datos.longitud.length; i += 1) {
    const punto = proyectar(datos.longitud[i] ?? 0, datos.latitud[i] ?? 0);
    if (punto !== undefined && !juntoALaMarca(punto[0], punto[1])) centros.push(punto[0], punto[1]);
  }
  const izquierda = EN_CANARIAS.x - 12;
  const arriba = EN_CANARIAS.y - 12;
  const derecha = EN_CANARIAS.x + (EN_CANARIAS.este - EN_CANARIAS.oeste) * ESCALA + 12;
  const abajo = COMPARTIR.alto - FRANJA_DEL_DOMINIO + 12;
  const recuadro: Array<Punto> = [
    [izquierda, arriba],
    [derecha, arriba],
    [derecha, abajo],
    [izquierda, abajo],
    [izquierda, arriba],
  ];
  const capas: Array<Capa> = [
    {
      contornos: [
        [
          [0, 0],
          [COMPARTIR.ancho, 0],
          [COMPARTIR.ancho, COMPARTIR.alto],
          [0, COMPARTIR.alto],
        ],
      ],
      color: colores.fuera,
    },
    { contornos: anillos, color: colores.tierra },
    {
      contornos: lineas(datos.limites.provincias, 0.8),
      color: colores.provincia,
      regla: "no-cero",
    },
    {
      contornos: lineas(datos.limites.comunidades, 1.1),
      color: colores.comunidad,
      regla: "no-cero",
    },
    {
      contornos: anillos.flatMap((anillo) => trazo([...anillo, ...anillo.slice(0, 1)], 1.2)),
      color: colores.costa,
      regla: "no-cero",
    },
    {
      contornos: trazo(recuadro, 1.2),
      color: colores.costa,
      regla: "no-cero",
    },
    { centros, radio: 1.05, color: colores.punto, opacidad: 0.55 },
    ...MARCA.map((pieza): Capa => ({
      contornos: pieza.contornos.map((contorno) => contorno.map(aLaImagen)),
      color: colores.marca[pieza.tono],
    })),
  ];
  return rasterizar(COMPARTIR.ancho, COMPARTIR.alto, capas);
};

/**
 * Los mismos píxeles con 256 colores o menos: los más frecuentes, agrupados a 5 bits por canal, y
 * cada píxel con el más cercano. Así el PNG va con paleta y pesa unos 100 KB en vez de 290: WhatsApp
 * no enseña imágenes de más de unos 300 KB.
 */
const conPaleta = (pixeles: Uint8Array): Uint8Array => {
  const grupos = new Map<number, { cuantos: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixeles.length; i += 4) {
    const r = pixeles[i] ?? 0;
    const g = pixeles[i + 1] ?? 0;
    const b = pixeles[i + 2] ?? 0;
    const clave = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const grupo = grupos.get(clave) ?? { cuantos: 0, r: 0, g: 0, b: 0 };
    grupo.cuantos += 1;
    grupo.r += r;
    grupo.g += g;
    grupo.b += b;
    grupos.set(clave, grupo);
  }
  const paleta = [...grupos.values()]
    .sort((p, q) => q.cuantos - p.cuantos)
    .slice(0, 256)
    .map((grupo) => [grupo.r, grupo.g, grupo.b].map((suma) => Math.round(suma / grupo.cuantos)));
  const cercanos = new Map<number, ReadonlyArray<number>>();
  const salida = new Uint8Array(pixeles);
  for (let i = 0; i < pixeles.length; i += 4) {
    const color = [pixeles[i] ?? 0, pixeles[i + 1] ?? 0, pixeles[i + 2] ?? 0] as const;
    const clave = (color[0] << 16) | (color[1] << 8) | color[2];
    const cercano = cercanos.get(clave) ?? masCercano(paleta, color);
    cercanos.set(clave, cercano);
    salida.set(cercano, i);
  }
  return salida;
};

/** El color de la paleta más cercano a uno dado, en RGB. */
const masCercano = (
  paleta: ReadonlyArray<ReadonlyArray<number>>,
  [r, g, b]: readonly [number, number, number],
): ReadonlyArray<number> => {
  let cercano: ReadonlyArray<number> = [r, g, b];
  let mejor = Infinity;
  for (const color of paleta) {
    const distancia =
      ((color[0] ?? 0) - r) ** 2 + ((color[1] ?? 0) - g) ** 2 + ((color[2] ?? 0) - b) ** 2;
    if (distancia < mejor) {
      mejor = distancia;
      cercano = color;
    }
  }
  return cercano;
};

/** El PNG de la imagen. */
export const pngAlCompartir = (datos: DatosAlCompartir, colores: ColoresAlCompartir): Uint8Array =>
  codificarPng(COMPARTIR.ancho, COMPARTIR.alto, conPaleta(pixelesAlCompartir(datos, colores)));
