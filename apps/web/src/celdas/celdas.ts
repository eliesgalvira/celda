import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { aPlano, desdePlano } from "@celda/dominio/plano";
import { celdas, type ParamsCeldas, type ResultadoCeldas } from "@celda/sim/celdas";

/**
 * Hasta dónde llegan las celdas más allá del último emplazamiento de la capa, en metros. La capa
 * cubre la zona que recorre la ingesta; fuera de ella puede haber emplazamientos que Celda no
 * conoce, así que una celda no se alarga por donde no hay datos.
 */
export const MARGEN_CELDAS_M = 100;

/** Las celdas de una capa preparadas para la simulación, con el origen de su plano. */
export interface CeldasPedidas {
  readonly origen: Coordenada;
  readonly params: ParamsCeldas;
}

/**
 * Los parámetros de las celdas de todos los emplazamientos de la capa: sus posiciones en un plano
 * centrado en la capa y la caja que los rodea con `MARGEN_CELDAS_M` de margen.
 */
export const pedirCeldas = (emplazamientos: ReadonlyArray<EmplazamientoDeCapa>): CeldasPedidas => {
  const longitudes = emplazamientos.map((e) => e.posicion.longitud);
  const latitudes = emplazamientos.map((e) => e.posicion.latitud);
  const origen = {
    longitud: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    latitud: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
  };
  const puntos = emplazamientos.map((e) => aPlano(origen, e.posicion));
  const estes = puntos.map((p) => p.este);
  const nortes = puntos.map((p) => p.norte);
  return {
    origen,
    params: {
      emplazamientos: puntos,
      caja: {
        oeste: Math.min(...estes) - MARGEN_CELDAS_M,
        sur: Math.min(...nortes) - MARGEN_CELDAS_M,
        este: Math.max(...estes) + MARGEN_CELDAS_M,
        norte: Math.max(...nortes) + MARGEN_CELDAS_M,
      },
    },
  };
};

/** Una celda en GeoJSON, con la clave de su emplazamiento. */
export interface CeldaEnMapa {
  readonly type: "Feature";
  readonly properties: { readonly clave: string };
  // Arrays modificables, como los tipos GeoJSON que acepta MapLibre.
  readonly geometry: {
    readonly type: "Polygon";
    readonly coordinates: Array<Array<[number, number]>>;
  };
}

/** Las celdas que dibuja el mapa, como una colección GeoJSON. */
export interface CeldasEnMapa {
  readonly type: "FeatureCollection";
  readonly features: Array<CeldaEnMapa>;
}

export const SIN_CELDAS: CeldasEnMapa = { type: "FeatureCollection", features: [] };

/** Seis decimales: unos 10 cm, como la capa. */
const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

/**
 * Las celdas calculadas, de vuelta en longitud y latitud. El anillo de cada polígono se cierra
 * repitiendo su primer vértice, como pide GeoJSON, y va en sentido antihorario. Una celda vacía
 * (un emplazamiento repetido) no se dibuja.
 */
export const celdasEnMapa = (
  resultado: ResultadoCeldas,
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  origen: Coordenada,
): CeldasEnMapa => ({
  type: "FeatureCollection",
  features: emplazamientos.flatMap((emplazamiento, k): Array<CeldaEnMapa> => {
    const desde = resultado.inicio[k] ?? 0;
    const hasta = resultado.inicio[k + 1] ?? 0;
    if (hasta - desde < 3) return [];
    const anillo: Array<[number, number]> = [];
    for (let i = desde; i <= hasta; i++) {
      const v = i === hasta ? desde : i;
      const punto = desdePlano(origen, {
        este: resultado.vertices[2 * v] ?? 0,
        norte: resultado.vertices[2 * v + 1] ?? 0,
      });
      anillo.push([redondear(punto.longitud), redondear(punto.latitud)]);
    }
    return [
      {
        type: "Feature",
        properties: { clave: emplazamiento.clave },
        geometry: { type: "Polygon", coordinates: [anillo] },
      },
    ];
  }),
});

/** Cómo va el cálculo de las celdas de la capa. */
export type CalculoCeldas =
  /** Todavía no se ha acercado el mapa lo bastante: no se han pedido. */
  "sin-pedir" | "calculando" | "listas" | "fallo";

/** Lo que dice la pista del mapa sobre las celdas. */
export interface PistaCeldas {
  readonly texto: string;
  /** La simulación, `id@version`, cuando lo que se ve es su resultado. */
  readonly modelo?: string;
  /** Si se ofrece reintentar el cálculo. */
  readonly reintentar: boolean;
}

/**
 * La pista que acompaña a las celdas mientras se ven, es decir, con el mapa a su zoom o más
 * cerca. Cuando se dibujan, dice que son un modelo y su versión.
 */
export const pistaDeCeldas = (cerca: boolean, calculo: CalculoCeldas): PistaCeldas | undefined => {
  if (!cerca) return undefined;
  switch (calculo) {
    case "sin-pedir":
    case "calculando":
      return { texto: "Calculando las celdas…", reintentar: false };
    case "listas":
      return {
        texto: "Zona más cercana a cada emplazamiento",
        modelo: `${celdas.id}@${celdas.version}`,
        reintentar: false,
      };
    case "fallo":
      return { texto: "No se han podido calcular las celdas", reintentar: true };
  }
};
