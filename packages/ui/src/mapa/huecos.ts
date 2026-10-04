import type { GeoJSONSourceSpecification, SymbolLayerSpecification } from "maplibre-gl";

/**
 * Los huecos de los marcadores de Celda en el mapa base (ADR 0024). Los marcadores van en el DOM,
 * fuera de MapLibre, así que sus rótulos no los ven. Cada marcador deja en una fuente GeoJSON un
 * icono transparente de su tamaño, y los rótulos de debajo de los huecos (pueblos, calles, agua…)
 * lo esquivan. Los de ciudad van por encima: no los esquivan, y Celda los copia sobre sus datos.
 * La web cambia los huecos al decidir qué se dibuja, nunca en cada fotograma.
 */

/** La fuente de los huecos, vacía hasta que la web la llena. */
export const FUENTE_HUECOS = "huecos";

/** La capa de los huecos. */
export const CAPA_HUECOS = "huecos";

/** El prefijo del nombre de la imagen de un hueco: `hueco:<ancho>x<alto>`. */
const PREFIJO = "hueco:";

/** Los huecos se redondean hacia arriba a múltiplos de esto, para no crear una imagen por marcador. */
const PASO = 4;

/**
 * Lo que mide la mitad de arriba de un hexágono a su tamaño. Los huecos se anclan por arriba y se
 * desplazan esto hacia arriba, multiplicado por su escala: arrancan en lo alto del hexágono.
 */
const MEDIO_HEXAGONO = 28;

export const fuenteHuecos = (): GeoJSONSourceSpecification => ({
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
});

/**
 * La capa de los huecos: iconos transparentes que no se apartan por nada (`icon-allow-overlap`)
 * pero que sí ocupan su sitio (`icon-ignore-placement: false`).
 */
export const capaHuecos = (): SymbolLayerSpecification => ({
  id: CAPA_HUECOS,
  type: "symbol",
  source: FUENTE_HUECOS,
  layout: {
    "icon-image": ["get", "imagen"],
    "icon-size": ["get", "escala"],
    "icon-anchor": "top",
    "icon-offset": [0, -MEDIO_HEXAGONO],
    "icon-allow-overlap": true,
    "icon-ignore-placement": false,
  },
  paint: { "icon-opacity": 0 },
});

/**
 * Lo que ocupa un marcador, en píxeles respecto a su punto, con la escala de su hexágono. La caja
 * empieza en lo alto del hexágono (`-28 × escala`); un logo, que no encoge, va con escala 1.
 */
export interface Hueco {
  readonly longitud: number;
  readonly latitud: number;
  /** Lo que mide de ancho, centrado en el punto, y de alto desde lo alto del hexágono. */
  readonly ancho: number;
  readonly alto: number;
  readonly escala: number;
}

const redondear = (pixeles: number): number => Math.max(PASO, Math.ceil(pixeles / PASO) * PASO);

/** El nombre de la imagen de un hueco, en las unidades de su escala. */
export const imagenDeHueco = (hueco: Hueco): string =>
  `${PREFIJO}${redondear(hueco.ancho / hueco.escala)}x${redondear(hueco.alto / hueco.escala)}`;

/** Un hueco como punto de GeoJSON, con la imagen y la escala de su icono. */
interface PuntoDeHueco {
  readonly type: "Feature";
  readonly properties: { readonly imagen: string; readonly escala: number };
  readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
}

/** Los huecos que se mandan a la fuente. */
interface Huecos {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<PuntoDeHueco>;
}

/** Lo que hace falta del mapa de MapLibre para poner los huecos. */
export interface MapaConHuecos {
  readonly getSource: (id: string) => { readonly setData?: (datos: Huecos) => void } | undefined;
}

const puestos = new WeakMap<object, string>();

/**
 * Pone los huecos de los marcadores. Si son los mismos que los últimos, no toca el mapa: cada
 * `setData` vuelve a colocar los rótulos y pinta otra vez.
 */
export const ponerHuecos = (mapa: MapaConHuecos, huecos: ReadonlyArray<Hueco>): void => {
  const features = huecos.map((hueco): PuntoDeHueco => ({
    type: "Feature",
    properties: { imagen: imagenDeHueco(hueco), escala: hueco.escala },
    geometry: {
      type: "Point",
      coordinates: [Number(hueco.longitud.toFixed(6)), Number(hueco.latitud.toFixed(6))],
    },
  }));
  const clave = JSON.stringify(features);
  if (puestos.get(mapa) === clave) return;
  const fuente = mapa.getSource(FUENTE_HUECOS);
  if (fuente?.setData === undefined) return;
  puestos.set(mapa, clave);
  fuente.setData({ type: "FeatureCollection", features });
};

/** Lo que hace falta del mapa de MapLibre para crear las imágenes de los huecos. */
export interface MapaConImagenes {
  readonly on: (evento: "styleimagemissing", oyente: (e: { id: string }) => void) => void;
  readonly hasImage: (id: string) => boolean;
  readonly addImage: (
    id: string,
    imagen: { width: number; height: number; data: Uint8Array },
  ) => void;
}

/**
 * Crea la imagen de cada hueco cuando un icono la pide: un rectángulo transparente del tamaño de
 * su nombre. Se llama una vez por mapa, al crearlo. Los demás iconos que falten no son de Celda.
 */
export const crearImagenesDeHuecos = (mapa: MapaConImagenes): void => {
  mapa.on("styleimagemissing", ({ id }) => {
    const medidas = /^hueco:(\d+)x(\d+)$/u.exec(id);
    if (medidas === null || mapa.hasImage(id)) return;
    const width = Number(medidas[1]);
    const height = Number(medidas[2]);
    mapa.addImage(id, { width, height, data: new Uint8Array(width * height * 4) });
  });
};
