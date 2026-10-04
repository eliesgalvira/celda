import type { Coordenada } from "@celda/dominio/area";
import { enLaComunitatValenciana } from "@celda/dominio/comunitatValenciana";
import { CIUDADES } from "@celda/dominio/habitantesDeCiudades";
import { nombreDelMapaBase } from "@celda/dominio/nombreDeLugar";
import type { IndiceDeCiudades } from "@celda/dominio/poblacionDeRotulos";
import { CAPAS_DE_CIUDADES, tamanoDeRotulo } from "@celda/ui/mapa/rotulos.ts";
import type { ImportanciaDeRotulo } from "@celda/ui/marcadores/RotuloDeCiudad.tsx";

/**
 * Los rótulos de ciudad que MapLibre ha colocado en sus capas transparentes, para copiarlos encima
 * de los marcadores (ADR 0024). Va con el código del mapa, no con la primera pantalla: lo importa
 * `mapaBase.ts`, con la tabla de habitantes de las ciudades y el contorno de la Comunitat
 * Valenciana.
 */

/** Un rótulo de ciudad colocado, en coordenadas del mapa. */
export interface RotuloLeido {
  /** Su capa y su texto: única entre los de una lectura. */
  readonly clave: string;
  readonly texto: string;
  readonly posicion: Coordenada;
  readonly importancia: ImportanciaDeRotulo;
  /** El tamaño de su letra al zoom en que se leyó, en píxeles. */
  readonly tamano: number;
}

/** Los rótulos colocados en un momento, con el zoom del mapa. */
export interface LecturaDeRotulos {
  readonly zoom: number;
  readonly rotulos: ReadonlyArray<RotuloLeido>;
}

/** Un rasgo colocado de una capa de ciudades: un punto con las propiedades de OpenMapTiles. */
export interface RasgoColocado {
  readonly geometry:
    | { readonly type: "Point"; readonly coordinates: ReadonlyArray<number> }
    | {
        readonly type:
          | "MultiPoint"
          | "LineString"
          | "MultiLineString"
          | "Polygon"
          | "MultiPolygon"
          | "GeometryCollection";
      };
  readonly properties: Readonly<Record<string, string | number | undefined>>;
  readonly layer: { readonly id: string };
}

/** Lo que hace falta del mapa de MapLibre para leer sus rótulos. `Map` lo cumple. */
export interface MapaConRotulosColocados {
  readonly getLayer: (id: string) => object | undefined;
  readonly getZoom: () => number;
  readonly queryRenderedFeatures: (opciones: {
    layers: Array<string>;
  }) => ReadonlyArray<RasgoColocado>;
}

/** Lo que la pantalla del mapa recibe del código del mapa para los rótulos de ciudad. */
export interface LectorDeRotulos {
  readonly leer: (mapa: MapaConRotulosColocados) => LecturaDeRotulos;
  /** Los habitantes de las ciudades que el mapa base rotula de lejos. */
  readonly ciudades: IndiceDeCiudades;
}

/** Una propiedad de un rasgo del mapa base como texto, si la tiene. */
const texto = (valor: string | number | undefined): string | undefined =>
  valor === undefined ? undefined : String(valor);

/**
 * Los rótulos de ciudad colocados ahora, cada uno una vez aunque salga en dos teselas, por orden
 * de clave. Su texto es el que pinta el mapa base, el nombre de lugar (ADR 0025).
 */
export const leerRotulosDeCiudad = (mapa: MapaConRotulosColocados): LecturaDeRotulos => {
  const zoom = mapa.getZoom();
  const capas = CAPAS_DE_CIUDADES.filter((id) => mapa.getLayer(id) !== undefined);
  if (capas.length === 0) return { zoom, rotulos: [] };
  const vistos = new Map<string, RotuloLeido>();
  for (const rasgo of mapa.queryRenderedFeatures({ layers: capas })) {
    if (rasgo.geometry.type !== "Point") continue;
    const [longitud = 0, latitud = 0] = rasgo.geometry.coordinates;
    const posicion = { longitud, latitud };
    const name = texto(rasgo.properties.name);
    if (name === undefined) continue;
    const nombre = nombreDelMapaBase(
      {
        name,
        es: texto(rasgo.properties["name:es"]),
        latin: texto(rasgo.properties["name:latin"]),
      },
      name.includes("/") && enLaComunitatValenciana(posicion),
    );
    const capa = rasgo.layer.id;
    const clave = `${capa}:${nombre}`;
    if (vistos.has(clave)) continue;
    vistos.set(clave, {
      clave,
      texto: nombre,
      posicion,
      importancia: capa === CAPAS_DE_CIUDADES[0] ? "capital" : "ciudad",
      tamano: tamanoDeRotulo(capa, Number(rasgo.properties.capital ?? 99), zoom),
    });
  }
  return {
    zoom,
    rotulos: [...vistos.values()].toSorted((a, b) => (a.clave < b.clave ? -1 : 1)),
  };
};

/** El lector de los rótulos de ciudad del mapa, con la tabla de habitantes. */
export const LECTOR_DE_ROTULOS: LectorDeRotulos = { leer: leerRotulosDeCiudad, ciudades: CIUDADES };
