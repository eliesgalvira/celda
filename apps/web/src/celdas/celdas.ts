import { cajaDe, type Coordenada, type Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { aPlano, desdePlano } from "@celda/dominio/plano";
import { celdas, type ParamsCeldas, type ResultadoCeldas } from "@celda/sim/celdas";

import { enumerar, type EstadoDeLasVecinas, VECINAS_LISTAS } from "../capa/vecinas.ts";

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
 * Los parámetros de las celdas de unos emplazamientos: sus posiciones en un plano con origen en
 * `origen` y la caja `caja` con `MARGEN_CELDAS_M` de margen. Sin caja, la que los rodea; sin
 * origen, el centro de la caja. Con la caja de todas las provincias del cálculo, también de las
 * que aún no han llegado, una celda sale igual mientras llegan que cuando están todas.
 *
 * El plano mide el este con la escala del paralelo del origen (`errorDelPlano`). Un borde entre
 * dos celdas se mueve como mucho ese error por la mitad de la distancia entre sus
 * emplazamientos: con el origen junto a lo que se ve (`origenCerca`), menos de un 0,26 %, 1,3 m
 * entre dos emplazamientos a 1 km.
 */
export const pedirCeldas = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  caja: Rectangulo | undefined = cajaDe(emplazamientos.map((e) => e.posicion)),
  origenPedido?: Coordenada,
): CeldasPedidas => {
  const suroeste = caja?.suroeste ?? { longitud: 0, latitud: 0 };
  const noreste = caja?.noreste ?? suroeste;
  const origen = origenPedido ?? {
    longitud: (suroeste.longitud + noreste.longitud) / 2,
    latitud: (suroeste.latitud + noreste.latitud) / 2,
  };
  const so = aPlano(origen, suroeste);
  const ne = aPlano(origen, noreste);
  return {
    origen,
    params: {
      emplazamientos: emplazamientos.map((e) => aPlano(origen, e.posicion)),
      caja: {
        oeste: so.este - MARGEN_CELDAS_M,
        sur: so.norte - MARGEN_CELDAS_M,
        este: ne.este + MARGEN_CELDAS_M,
        norte: ne.norte + MARGEN_CELDAS_M,
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

/** Una provincia con emplazamientos que no entra en el cálculo, por su código y su caja. */
export interface ProvinciaFuera {
  readonly codigo: string;
  readonly caja: Rectangulo;
}

/**
 * Una celda que los emplazamientos de alguna provincia de fuera del cálculo podrían recortar. No
 * se dibuja: sin esas provincias no se sabe cómo es.
 */
export interface CeldaDudosa {
  /** Las provincias de fuera que podrían recortarla. */
  readonly provincias: ReadonlyArray<string>;
  /** La caja de la celda tal como ha salido, para saber si se ve. */
  readonly caja: Rectangulo;
}

/** Cuadrado de la distancia de un punto a un rectángulo del plano. */
const distancia2 = (
  este: number,
  norte: number,
  caja: {
    readonly oeste: number;
    readonly sur: number;
    readonly este: number;
    readonly norte: number;
  },
): number => {
  const dx = Math.max(caja.oeste - este, 0, este - caja.este);
  const dy = Math.max(caja.sur - norte, 0, norte - caja.norte);
  return dx * dx + dy * dy;
};

/**
 * Las celdas que podría recortar algún emplazamiento de las provincias de `fuera`. Un punto de la
 * caja de una provincia recorta la celda de `e` si queda más cerca que `e` de algún punto de la
 * celda, y como la celda es convexa basta con mirar sus vértices: la celda corta el semiplano de
 * los puntos más cerca de ese emplazamiento si y solo si alguno de sus vértices cae en él. Con los
 * vértices de la celda tal como sale, recortada a la caja del cálculo, mira justo lo que se
 * dibuja. Es una función pura.
 */
export const celdasDudosas = (
  resultado: ResultadoCeldas,
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  origen: Coordenada,
  fuera: ReadonlyArray<ProvinciaFuera>,
): ReadonlyMap<string, CeldaDudosa> => {
  const dudosas = new Map<string, CeldaDudosa>();
  if (fuera.length === 0) return dudosas;
  const cajas = fuera.map(({ codigo, caja }) => {
    const so = aPlano(origen, caja.suroeste);
    const ne = aPlano(origen, caja.noreste);
    return { codigo, oeste: so.este, sur: so.norte, este: ne.este, norte: ne.norte };
  });
  emplazamientos.forEach((emplazamiento, k) => {
    const desde = resultado.inicio[k] ?? 0;
    const hasta = resultado.inicio[k + 1] ?? 0;
    if (hasta - desde < 3) return;
    const sitio = aPlano(origen, emplazamiento.posicion);
    const radios2: Array<number> = [];
    for (let v = desde; v < hasta; v++) {
      const dx = (resultado.vertices[2 * v] ?? 0) - sitio.este;
      const dy = (resultado.vertices[2 * v + 1] ?? 0) - sitio.norte;
      radios2.push(dx * dx + dy * dy);
    }
    const mayor2 = Math.max(...radios2);
    const suyas = cajas.flatMap((caja) => {
      // Una caja a más del doble del radio de la celda no llega a ninguno de sus vértices.
      if (distancia2(sitio.este, sitio.norte, caja) > 4 * mayor2) return [];
      for (let v = desde; v < hasta; v++) {
        const d2 = distancia2(
          resultado.vertices[2 * v] ?? 0,
          resultado.vertices[2 * v + 1] ?? 0,
          caja,
        );
        if (d2 < (radios2[v - desde] ?? 0)) return [caja.codigo];
      }
      return [];
    });
    if (suyas.length === 0) return;
    const vertices = Array.from({ length: hasta - desde }, (_, i) =>
      desdePlano(origen, {
        este: resultado.vertices[2 * (desde + i)] ?? 0,
        norte: resultado.vertices[2 * (desde + i) + 1] ?? 0,
      }),
    );
    const longitudes = vertices.map((p) => p.longitud);
    const latitudes = vertices.map((p) => p.latitud);
    dudosas.set(emplazamiento.clave, {
      provincias: suyas,
      caja: {
        suroeste: { longitud: Math.min(...longitudes), latitud: Math.min(...latitudes) },
        noreste: { longitud: Math.max(...longitudes), latitud: Math.max(...latitudes) },
      },
    });
  });
  return dudosas;
};

/**
 * Las provincias de fuera que hacen falta para dibujar las celdas que se ven: las que podrían
 * recortar alguna celda dudosa que corta `zona`, sin repetir y por código.
 */
export const provinciasQueFaltan = (
  dudosas: ReadonlyMap<string, CeldaDudosa>,
  zona: Rectangulo,
): ReadonlyArray<string> => {
  const faltan = new Set<string>();
  for (const { provincias, caja } of dudosas.values()) {
    const seVe =
      caja.suroeste.longitud <= zona.noreste.longitud &&
      zona.suroeste.longitud <= caja.noreste.longitud &&
      caja.suroeste.latitud <= zona.noreste.latitud &&
      zona.suroeste.latitud <= caja.noreste.latitud;
    if (seVe) for (const codigo of provincias) faltan.add(codigo);
  }
  return [...faltan].sort();
};

/**
 * Las celdas calculadas, de vuelta en longitud y latitud. El anillo de cada polígono se cierra
 * repitiendo su primer vértice, como pide GeoJSON, y va en sentido antihorario. Una celda vacía
 * (un emplazamiento repetido) no se dibuja, ni una de `sin`, las dudosas.
 */
export const celdasEnMapa = (
  resultado: ResultadoCeldas,
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  origen: Coordenada,
  sin: ReadonlyMap<string, unknown> = new Map(),
): CeldasEnMapa => ({
  type: "FeatureCollection",
  features: emplazamientos.flatMap((emplazamiento, k): Array<CeldaEnMapa> => {
    const desde = resultado.inicio[k] ?? 0;
    const hasta = resultado.inicio[k + 1] ?? 0;
    if (hasta - desde < 3 || sin.has(emplazamiento.clave)) return [];
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
  /**
   * Qué se ofrece reintentar: el cálculo, o pedir otra vez las provincias vecinas que no han
   * llegado, por código.
   */
  readonly reintentar: false | "calculo" | ReadonlyArray<string>;
}

/**
 * La pista que acompaña a las celdas mientras se ven, es decir, con el mapa a su zoom o más
 * cerca. Cuando se dibujan, dice que son un modelo y su versión. Si falta alguna provincia vecina,
 * lo dice antes que nada: las celdas junto a su borde no se dibujan hasta que llega.
 */
export const pistaDeCeldas = (
  cerca: boolean,
  calculo: CalculoCeldas,
  vecinas: EstadoDeLasVecinas = VECINAS_LISTAS,
): PistaCeldas | undefined => {
  if (!cerca) return undefined;
  const nombres =
    vecinas.tipo === "listas" ? "" : enumerar(vecinas.provincias.map((p) => p.nombre));
  if (vecinas.tipo === "fallo") {
    return {
      texto: `No han llegado los emplazamientos de ${nombres}: las celdas junto a su borde no se dibujan`,
      reintentar: vecinas.provincias.map((p) => p.codigo),
    };
  }
  if (vecinas.tipo === "cargando") {
    return { texto: `Cargando ${nombres} para las celdas de junto al borde…`, reintentar: false };
  }
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
      return { texto: "No se han podido calcular las celdas", reintentar: "calculo" };
  }
};
