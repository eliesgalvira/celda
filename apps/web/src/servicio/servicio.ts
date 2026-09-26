import type { Coordenada } from "@celda/dominio/area";
import { aPlano, desdePlano } from "@celda/dominio/plano";
import { poligonoDe } from "@celda/sim/celdas";
import { SECTOR_TIPICO } from "@celda/sim/diagramaSector";
import {
  type ParamsSectorServicio,
  type ResultadoSectorServicio,
  trozo,
} from "@celda/sim/sectorServicio";
import type { Malla } from "@celda/sim/simulacion";
import { opacidadesDelDegradado, type PropiedadesServicio } from "@celda/ui/mapa/servicio.ts";

import type { CeldasCalculadas } from "../celdas/enMapa.ts";
import type { Orientacion } from "../ficha/diagrama.ts";

/** Lo que hace falta para calcular el sector que da servicio en un emplazamiento. */
export interface PedidoServicio {
  readonly clave: string;
  readonly emplazamiento: Coordenada;
  /** El punto de referencia, si hay. */
  readonly punto: Coordenada | undefined;
  /** La celda del emplazamiento, si ya se ha calculado. */
  readonly celda: ReadonlyArray<Coordenada> | undefined;
  readonly orientacion: Orientacion;
}

/**
 * La celda del emplazamiento `clave`, en longitud y latitud, si las celdas ya están calculadas y
 * tiene una.
 */
export const celdaDe = (
  calculadas: CeldasCalculadas | undefined,
  clave: string,
): ReadonlyArray<Coordenada> | undefined => {
  if (calculadas === undefined) return undefined;
  const k = calculadas.emplazamientos.findIndex((e) => e.clave === clave);
  if (k < 0) return undefined;
  const poligono = poligonoDe(calculadas.resultado, k);
  if (poligono.length < 6) return undefined;
  return Array.from({ length: poligono.length / 2 }, (_, i) =>
    desdePlano(calculadas.origen, {
      este: poligono[2 * i] ?? 0,
      norte: poligono[2 * i + 1] ?? 0,
    }),
  );
};

/** Lo que se pide al simulador. */
export interface ParamsYMalla {
  readonly params: ParamsSectorServicio;
  readonly malla: Malla;
}

/**
 * Los parámetros y la malla de la simulación: todo en un plano con el emplazamiento en el
 * origen. La malla lleva el punto de referencia, o nada si no hay.
 */
export const pedirServicio = (pedido: PedidoServicio): ParamsYMalla => {
  const alPlano = (punto: Coordenada) => aPlano(pedido.emplazamiento, punto);
  const punto = pedido.punto === undefined ? [] : [alPlano(pedido.punto)];
  return {
    params: {
      azimuts: pedido.orientacion.azimuts,
      ...SECTOR_TIPICO,
      celda: (pedido.celda ?? []).flatMap((vertice) => {
        const { este, norte } = alPlano(vertice);
        return [este, norte];
      }),
    },
    malla: {
      este: Float64Array.from(punto, (p) => p.este),
      norte: Float64Array.from(punto, (p) => p.norte),
    },
  };
};

/** Lo que dice la simulación del punto de referencia. */
export interface LecturaServicio {
  /** El sector que da servicio, o `undefined` al pie del emplazamiento. */
  readonly sector: number | undefined;
  /** Lo que da ese sector hacia el punto respecto a su eje, en dB (0 o negativo). */
  readonly gananciaDb: number;
  /** Cuánto se aparta el punto del eje de ese sector, en grados, con signo. */
  readonly desviacion: number;
  readonly distancia: number;
  /** Rumbo del emplazamiento al punto, en grados desde el norte. */
  readonly rumbo: number;
  /** Si el punto cae en la celda del emplazamiento, o `undefined` si no se sabe. */
  readonly enCelda: boolean | undefined;
}

/** La lectura del punto de referencia, que es el primero (y único) de la malla. */
export const lecturaDe = (resultado: ResultadoSectorServicio): LecturaServicio | undefined => {
  if (resultado.sector.length === 0) return undefined;
  const sector = resultado.sector[0] ?? -1;
  const enCelda = resultado.enCelda[0] ?? -1;
  return {
    sector: sector < 0 ? undefined : sector,
    gananciaDb: resultado.gananciaDb[0] ?? 0,
    desviacion: resultado.desviacion[0] ?? 0,
    distancia: resultado.distancia[0] ?? 0,
    rumbo: resultado.rumbo[0] ?? 0,
    enCelda: enCelda < 0 ? undefined : enCelda === 1,
  };
};

/** Un rasgo del sector que da servicio en GeoJSON, como los acepta MapLibre. */
export interface RasgoServicio {
  readonly type: "Feature";
  readonly properties: PropiedadesServicio;
  readonly geometry:
    | { readonly type: "Polygon"; readonly coordinates: Array<Array<[number, number]>> }
    | { readonly type: "LineString"; readonly coordinates: Array<[number, number]> };
}

export interface RasgosServicio {
  readonly type: "FeatureCollection";
  readonly features: Array<RasgoServicio>;
}

export const SIN_RASGOS: RasgosServicio = { type: "FeatureCollection", features: [] };

/** Seis decimales: unos 10 cm, como la capa. */
const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

const aMapa = (emplazamiento: Coordenada, este: number, norte: number): [number, number] => {
  const punto = desdePlano(emplazamiento, { este, norte });
  return [redondear(punto.longitud), redondear(punto.latitud)];
};

/** Un polígono del plano del emplazamiento como anillo GeoJSON cerrado. */
const anillo = (emplazamiento: Coordenada, poligono: Float64Array): Array<[number, number]> => {
  const puntos: Array<[number, number]> = [];
  for (let i = 0; i <= poligono.length / 2; i++) {
    const v = i % (poligono.length / 2);
    puntos.push(aMapa(emplazamiento, poligono[2 * v] ?? 0, poligono[2 * v + 1] ?? 0));
  }
  return puntos;
};

/**
 * Lo que pinta el mapa: las bandas del degradado con su opacidad, los sectores que no dan
 * servicio (solo si hay un sector que da servicio) y los límites entre sectores.
 */
export const rasgosDe = (
  resultado: ResultadoSectorServicio,
  emplazamiento: Coordenada,
): RasgosServicio => {
  const features: Array<RasgoServicio> = [];
  const servido = resultado.sector.length > 0 ? (resultado.sector[0] ?? -1) : -1;
  if (servido >= 0) {
    for (let k = 0; k < resultado.inicioSectores.length - 1; k++) {
      const poligono = trozo(resultado.sectores, resultado.inicioSectores, k);
      if (k === servido || poligono.length < 6) continue;
      features.push({
        type: "Feature",
        properties: { tipo: "sector" },
        geometry: { type: "Polygon", coordinates: [anillo(emplazamiento, poligono)] },
      });
    }
  }
  const opacidades = opacidadesDelDegradado([...resultado.perdidaBandas]);
  for (const [k, opacidad] of opacidades.entries()) {
    const poligono = trozo(resultado.bandas, resultado.inicioBandas, k);
    if (poligono.length < 6) continue;
    features.push({
      type: "Feature",
      properties: { tipo: "banda", opacidad: Math.round(opacidad * 1000) / 1000 },
      geometry: { type: "Polygon", coordinates: [anillo(emplazamiento, poligono)] },
    });
  }
  for (let i = 0; i < resultado.cortes.length; i += 2) {
    features.push({
      type: "Feature",
      properties: { tipo: "corte" },
      geometry: {
        type: "LineString",
        coordinates: [
          aMapa(emplazamiento, 0, 0),
          aMapa(emplazamiento, resultado.cortes[i] ?? 0, resultado.cortes[i + 1] ?? 0),
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
};

/** La línea del emplazamiento al punto de referencia, o nada. */
export const lineaDe = (
  emplazamiento: Coordenada | undefined,
  punto: Coordenada | undefined,
): RasgosServicio =>
  emplazamiento === undefined || punto === undefined
    ? SIN_RASGOS
    : {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { tipo: "corte" },
            geometry: {
              type: "LineString",
              coordinates: [
                [emplazamiento.longitud, emplazamiento.latitud],
                [punto.longitud, punto.latitud],
              ],
            },
          },
        ],
      };
