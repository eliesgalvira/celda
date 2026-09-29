import type { Coordenada, Rectangulo as CajaGeografica } from "@celda/dominio/area";
import type { Mhz } from "@celda/dominio/banda";
import { COMPANIAS_DE_CAPA, type EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import {
  aPlano,
  cabeEnElPlano,
  desdePlano,
  origenCerca,
  type PuntoLocal,
} from "@celda/dominio/plano";
import { BANDAS_NOMINALES } from "@celda/dominio/tecnologia";
import { type Malla, mallaHexagonal, type Rectangulo } from "@celda/sim/simulacion";
import {
  type EstacionSinr,
  type ParamsSinr,
  RED_TIPICA,
  type ResultadoSinr,
} from "@celda/sim/sinr";

/**
 * Qué se calcula en la vista de interferencia y cómo se dibuja, como funciones puras. La
 * simulación es `sinr@1` (`@celda/sim/sinr`); aquí se eligen sus estaciones, su malla y lo que se
 * supone de lo que ninguna fuente publica.
 */

/** Ninguna fuente publica el azimut: tres sectores supuestos, como en el panel. */
export const AZIMUTS_SUPUESTOS: ReadonlyArray<number> = [0, 120, 240];

/**
 * Por debajo de este zoom no se dibuja la trama: la vista cubriría media ciudad y los hexágonos
 * serían más grandes que muchas celdas. El valor en el punto se sigue calculando.
 */
export const ZOOM_INTERFERENCIA = 14;

/** Radio de cada hexágono en la pantalla, en píxeles. */
export const RADIO_HEXAGONO_PX = 13;

/**
 * Las estaciones que se tienen en cuenta llegan hasta esta distancia más allá de lo que se ve.
 * Una a 1,5 km llega unos 30 dB por debajo de una a 250 m: más lejos apenas cambian nada.
 */
export const MARGEN_ESTACIONES_M = 1500;

/** La trama cubre también esta parte del ancho y del alto por cada lado: al arrastrar no se ve el borde. */
export const MARGEN_TRAMA = 0.15;

/** La ocupación con que se abre la vista, y sus límites en el deslizador. */
export const OCUPACION = { inicial: 0.5, minima: 0.05, maxima: 1, paso: 0.05 } as const;

/** Qué se elige en la vista. */
export interface EleccionVista {
  readonly compania: Compania;
  readonly mhz: Mhz;
  /** De 0 a 1. */
  readonly ocupacion: number;
}

/**
 * Cómo entra la estación base de un emplazamiento en la vista. `confirmada` si el registro dice
 * que emite en la banda; `supuesta` si aún no se ha leído ninguna banda suya y se supone que sí;
 * `otra-banda` si el registro da sus bandas y esta no está.
 */
export type Trato = "confirmada" | "supuesta" | "otra-banda";

/** Cómo entra el emplazamiento, o nada si la compañía no tiene estación base en él. */
export const tratoDe = (
  emplazamiento: EmplazamientoDeCapa,
  compania: Compania,
  mhz: Mhz,
): Trato | undefined => {
  if (!emplazamiento.companias.includes(compania)) return undefined;
  const conocidas = emplazamiento.bandas?.find((b) => b.compania === compania)?.mhz;
  if (conocidas === undefined) return "supuesta";
  return conocidas.includes(mhz) ? "confirmada" : "otra-banda";
};

/** Cuántas estaciones base de la compañía hay de cada trato en una banda. */
export type Recuento = Readonly<Record<Trato, number>>;

export const recuentoDe = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  compania: Compania,
  mhz: Mhz,
): Recuento => {
  const recuento = { confirmada: 0, supuesta: 0, "otra-banda": 0 };
  for (const emplazamiento of emplazamientos) {
    const trato = tratoDe(emplazamiento, compania, mhz);
    if (trato !== undefined) recuento[trato] += 1;
  }
  return recuento;
};

/** Las compañías con algún emplazamiento en la capa, en el orden de la capa. */
export const companiasDeLaCapa = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
): ReadonlyArray<Compania> =>
  COMPANIAS_DE_CAPA.filter((compania) =>
    emplazamientos.some((e) => e.companias.includes(compania)),
  );

/** Las bandas que se ofrecen: todas las que se usan en España, de menor a mayor. */
export const BANDAS_DE_LA_VISTA: ReadonlyArray<Mhz> = BANDAS_NOMINALES;

/** Sin ninguna banda confirmada, la vista empieza en 1800 MHz, la del 4G que llevan todas. */
const BANDA_POR_DEFECTO: Mhz = 1800;

/** La banda con que se abre: la que el registro confirma en más estaciones de la compañía. */
export const bandaInicial = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  compania: Compania,
): Mhz => {
  let mejor: Mhz = BANDA_POR_DEFECTO;
  let cuantas = 0;
  for (const mhz of BANDAS_DE_LA_VISTA) {
    const confirmadas = recuentoDe(emplazamientos, compania, mhz).confirmada;
    if (confirmadas > cuantas) {
      mejor = mhz;
      cuantas = confirmadas;
    }
  }
  return mejor;
};

/**
 * Lo que se ve del mapa: su rectángulo en grados y el zoom. Sale del mapa al pararse, así que la
 * vista no calcula mientras se arrastra.
 */
export interface Encuadre {
  readonly suroeste: Coordenada;
  readonly noreste: Coordenada;
  readonly zoom: number;
}

/**
 * Metros por píxel de MapLibre (teselas de 512 px) a un zoom y una latitud. El zoom se redondea
 * a medios niveles: dentro de uno, los hexágonos miden lo mismo en metros y no bailan.
 */
export const metrosPorPixel = (zoom: number, latitud: number): number =>
  (40_075_016.686 * Math.cos((latitud * Math.PI) / 180)) / (512 * 2 ** (Math.round(zoom * 2) / 2));

/** El centro de lo que se ve. */
const centroDe = (encuadre: Encuadre): Coordenada => ({
  longitud: (encuadre.suroeste.longitud + encuadre.noreste.longitud) / 2,
  latitud: (encuadre.suroeste.latitud + encuadre.noreste.latitud) / 2,
});

/**
 * El origen del plano de la trama: el de la casilla de 0,1° en que cae el centro de lo que se ve
 * (`origenCerca`). Mover el mapa dentro de ella no cambia el origen ni mueve la trama, y lo que se
 * ve y sus estaciones quedan tan cerca que ninguna distancia se equivoca más de un 0,26 %
 * (`LATITUD_DEL_PLANO`). Con un origen fijo en Barcelona, en Canarias se equivocaban un 17 %.
 */
export const origenDeLaTrama = (encuadre: Encuadre): Coordenada => origenCerca(centroDe(encuadre));

const rectanguloDe = (encuadre: Encuadre, margen: number): Rectangulo => {
  const origen = origenDeLaTrama(encuadre);
  const so = aPlano(origen, encuadre.suroeste);
  const ne = aPlano(origen, encuadre.noreste);
  const ancho = (ne.este - so.este) * margen;
  const alto = (ne.norte - so.norte) * margen;
  return {
    oeste: so.este - ancho,
    sur: so.norte - alto,
    este: ne.este + ancho,
    norte: ne.norte + alto,
  };
};

const ampliar = (r: Rectangulo, metros: number): Rectangulo => ({
  oeste: r.oeste - metros,
  sur: r.sur - metros,
  este: r.este + metros,
  norte: r.norte + metros,
});

const dentro = (r: Rectangulo, p: PuntoLocal): boolean =>
  p.este >= r.oeste && p.este <= r.este && p.norte >= r.sur && p.norte <= r.norte;

/**
 * Si la trama calculada para `anterior` sirve para `nuevo`: mismo medio nivel de zoom (los
 * hexágonos miden lo mismo) y lo que se ve cae dentro de lo que cubre, margen incluido. Así un
 * arrastre corto no vuelve a calcular.
 */
export const mismaTrama = (
  anterior: Encuadre | undefined,
  nuevo: Encuadre | undefined,
): boolean => {
  if (anterior === undefined || nuevo === undefined) return anterior === nuevo;
  if (Math.round(anterior.zoom * 2) !== Math.round(nuevo.zoom * 2)) return false;
  const origen = origenDeLaTrama(anterior);
  const otro = origenDeLaTrama(nuevo);
  if (origen.longitud !== otro.longitud || origen.latitud !== otro.latitud) return false;
  const cubierto = rectanguloDe(anterior, MARGEN_TRAMA);
  const visto = rectanguloDe(nuevo, 0);
  return (
    dentro(cubierto, { este: visto.oeste, norte: visto.sur }) &&
    dentro(cubierto, { este: visto.este, norte: visto.norte })
  );
};

/** La simulación que pide la vista, con lo que hace falta para dibujarla y contarla. */
export interface SinrPedida {
  /** El origen del plano en que va todo lo de la simulación. */
  readonly origen: Coordenada;
  readonly params: ParamsSinr;
  /** Los centros de la trama y, si hay punto de referencia, él al final. */
  readonly malla: Malla;
  /** Cuántos puntos de la malla son de la trama. */
  readonly hexagonos: number;
  /** Radio de los hexágonos, en metros. */
  readonly radio: number;
  /** Si el último punto de la malla es el punto de referencia. */
  readonly conPunto: boolean;
}

export interface EntradaSinr {
  readonly emplazamientos: ReadonlyArray<EmplazamientoDeCapa>;
  readonly eleccion: EleccionVista;
  /** Lo que se ve, o nada si el mapa aún no se ha parado. */
  readonly encuadre: Encuadre | undefined;
  readonly referencia: Coordenada | undefined;
}

/**
 * Un plano en que se calcula la vista: su origen y lo que se mide en él, la trama de lo que se ve
 * (con `encuadre`), el punto de referencia o los dos.
 */
interface PlanoDeSinr {
  readonly origen: Coordenada;
  /** Lo que se ve, si se dibuja la trama en este plano. */
  readonly encuadre: Encuadre | undefined;
  readonly referencia: Coordenada | undefined;
}

/**
 * Los planos de la vista. La trama va en el de `origenDeLaTrama`. El punto de referencia va en el
 * mismo si cabe (`cabeEnElPlano`); si queda más lejos, por ejemplo con el GPS en casa y el mapa en
 * otra ciudad, va en otro, con el origen junto a él. Sin trama, solo el del punto.
 */
const planosDeSinr = (
  encuadre: Encuadre | undefined,
  referencia: Coordenada | undefined,
): ReadonlyArray<PlanoDeSinr> => {
  const conTrama = encuadre !== undefined && encuadre.zoom >= ZOOM_INTERFERENCIA;
  if (!conTrama) {
    return referencia === undefined
      ? []
      : [{ origen: origenCerca(referencia), encuadre: undefined, referencia }];
  }
  const origen = origenDeLaTrama(encuadre);
  if (referencia === undefined || cabeEnElPlano(origen, referencia)) {
    return [{ origen, encuadre, referencia }];
  }
  return [
    { origen, encuadre, referencia: undefined },
    { origen: origenCerca(referencia), encuadre: undefined, referencia },
  ];
};

/**
 * Hasta dónde se miran estaciones en un plano: lo que se ve al zoom de la trama y el punto de
 * referencia, con `MARGEN_ESTACIONES_M` alrededor.
 */
const zonasDeEstaciones = (plano: PlanoDeSinr): ReadonlyArray<Rectangulo> => {
  const punto = plano.referencia === undefined ? undefined : aPlano(plano.origen, plano.referencia);
  return [
    ...(plano.encuadre === undefined
      ? []
      : [ampliar(rectanguloDe(plano.encuadre, 0), MARGEN_ESTACIONES_M)]),
    ...(punto === undefined
      ? []
      : [
          ampliar(
            { oeste: punto.este, sur: punto.norte, este: punto.este, norte: punto.norte },
            MARGEN_ESTACIONES_M,
          ),
        ]),
  ];
};

const seCortanEnElPlano = (a: Rectangulo, b: Rectangulo): boolean =>
  a.oeste <= b.este && b.oeste <= a.este && a.sur <= b.norte && b.sur <= a.norte;

/**
 * Las provincias que necesita la vista: las que tienen emplazamientos donde `pedidasDeSinr` mira
 * estaciones. Se mira en los mismos planos y con las mismas cajas, así que con ellas cargadas la
 * vista da lo mismo que con todas las provincias en una sola capa.
 */
export const provinciasParaSinr = (
  provincias: ReadonlyArray<{
    readonly codigo: string;
    readonly caja: CajaGeografica | undefined;
    readonly fichero: string | undefined;
  }>,
  encuadre: Encuadre | undefined,
  referencia: Coordenada | undefined,
): ReadonlyArray<string> => {
  const planos = planosDeSinr(encuadre, referencia);
  if (planos.length === 0) return [];
  return provincias.flatMap(({ codigo, caja, fichero }) => {
    if (caja === undefined || fichero === undefined) return [];
    const corta = planos.some((plano) => {
      const so = aPlano(plano.origen, caja.suroeste);
      const ne = aPlano(plano.origen, caja.noreste);
      const enPlano = { oeste: so.este, sur: so.norte, este: ne.este, norte: ne.norte };
      return zonasDeEstaciones(plano).some((zona) => seCortanEnElPlano(zona, enPlano));
    });
    return corta ? [codigo] : [];
  });
};

/**
 * Las simulaciones que pide la vista, una por plano (`planosDeSinr`): casi siempre una, y dos si
 * el punto de referencia queda lejos de lo que se ve. Entran las estaciones base de la compañía
 * que emiten en la banda y las que aún no tienen bandas leídas, que se suponen en ella; las que
 * emiten en otras bandas no estorban y no entran. Solo cuentan las que quedan cerca de lo que se
 * ve o del punto de referencia (`MARGEN_ESTACIONES_M`). Todas tienen tres sectores supuestos y la
 * potencia típica. Sin encuadre al zoom de la vista ni punto, no hay nada que calcular.
 */
export const pedidasDeSinr = (entrada: EntradaSinr): ReadonlyArray<SinrPedida> =>
  planosDeSinr(entrada.encuadre, entrada.referencia).map((plano) => pedirEnPlano(entrada, plano));

/**
 * La simulación del plano de lo que se ve, o del punto si no hay trama. Si el punto queda lejos de
 * lo que se ve, no va en ella: lo calcula la segunda de `pedidasDeSinr`.
 */
export const pedirSinr = (entrada: EntradaSinr): SinrPedida | undefined =>
  pedidasDeSinr(entrada)[0];

const pedirEnPlano = (entrada: EntradaSinr, plano: PlanoDeSinr): SinrPedida => {
  const { eleccion } = entrada;
  const { origen, encuadre, referencia } = plano;
  const punto = referencia === undefined ? undefined : aPlano(origen, referencia);
  // El tamaño de un píxel a la latitud del origen, que no cambia al mover el mapa en la casilla.
  const radio =
    encuadre === undefined ? 0 : RADIO_HEXAGONO_PX * metrosPorPixel(encuadre.zoom, origen.latitud);
  const trama =
    encuadre === undefined
      ? { este: new Float64Array(0), norte: new Float64Array(0) }
      : mallaHexagonal(rectanguloDe(encuadre, MARGEN_TRAMA), radio);

  const cercanas = zonasDeEstaciones(plano);
  const estaciones: Array<EstacionSinr> = [];
  for (const emplazamiento of entrada.emplazamientos) {
    const trato = tratoDe(emplazamiento, eleccion.compania, eleccion.mhz);
    if (trato === undefined || trato === "otra-banda") continue;
    const enPlano = aPlano(origen, emplazamiento.posicion);
    if (!cercanas.some((r) => dentro(r, enPlano))) continue;
    estaciones.push({
      este: enPlano.este,
      norte: enPlano.norte,
      azimuts: AZIMUTS_SUPUESTOS,
      potenciaDbm: RED_TIPICA.potenciaDbm,
    });
  }

  const hexagonos = trama.este.length;
  const malla =
    punto === undefined
      ? trama
      : {
          este: Float64Array.from([...trama.este, punto.este]),
          norte: Float64Array.from([...trama.norte, punto.norte]),
        };
  return {
    origen,
    params: {
      estaciones,
      frecuenciaMhz: eleccion.mhz,
      ocupacion: eleccion.ocupacion,
      ruidoDbm: RED_TIPICA.ruidoDbm,
    },
    malla,
    hexagonos,
    radio,
    conPunto: punto !== undefined,
  };
};

/** Un hexágono de la trama en GeoJSON, con la señal frente a interferencia de su centro. */
export interface HexagonoEnMapa {
  readonly type: "Feature";
  readonly properties: { readonly sinr: number };
  readonly geometry: {
    readonly type: "Polygon";
    readonly coordinates: Array<Array<[number, number]>>;
  };
}

export interface TramaEnMapa {
  readonly type: "FeatureCollection";
  readonly features: Array<HexagonoEnMapa>;
}

export const SIN_TRAMA: TramaEnMapa = { type: "FeatureCollection", features: [] };

/** Los hexágonos se dibujan un poco más pequeños que la trama: queda una línea entre ellos. */
const ESCALA_DIBUJO = 0.92;

const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

/** La trama calculada en GeoJSON. Un punto sin estaciones cerca no se dibuja. */
export const tramaEnMapa = (pedida: SinrPedida, resultado: ResultadoSinr): TramaEnMapa => {
  const features: Array<HexagonoEnMapa> = [];
  const r = pedida.radio * ESCALA_DIBUJO;
  // Vértices de un hexágono con un vértice arriba, en sentido antihorario desde el de arriba.
  const esquinas = Array.from({ length: 6 }, (_, k) => {
    const angulo = ((90 + 60 * k) * Math.PI) / 180;
    return { este: r * Math.cos(angulo), norte: r * Math.sin(angulo) };
  });
  for (let i = 0; i < pedida.hexagonos; i++) {
    const sinr = resultado.sinrDb[i] ?? Number.NaN;
    if (Number.isNaN(sinr)) continue;
    const este = pedida.malla.este[i] ?? 0;
    const norte = pedida.malla.norte[i] ?? 0;
    const anillo = esquinas.map((esquina): [number, number] => {
      const punto = desdePlano(pedida.origen, {
        este: este + esquina.este,
        norte: norte + esquina.norte,
      });
      return [redondear(punto.longitud), redondear(punto.latitud)];
    });
    anillo.push(anillo[0] ?? [0, 0]);
    features.push({
      type: "Feature",
      properties: { sinr: Math.round(sinr * 10) / 10 },
      geometry: { type: "Polygon", coordinates: [anillo] },
    });
  }
  return { type: "FeatureCollection", features };
};

/** La señal frente a interferencia en el punto de referencia, si se pidió y hay estaciones. */
export const valorEnPunto = (pedida: SinrPedida, resultado: ResultadoSinr): number | undefined => {
  if (!pedida.conPunto) return undefined;
  const valor = resultado.sinrDb[pedida.malla.este.length - 1];
  return valor === undefined || Number.isNaN(valor) ? undefined : valor;
};

/**
 * La palabra que interpreta un valor, como en el prototipo v8: por debajo de 0 dB manda la
 * interferencia (la escala lo dice) y a partir de 20 dB la señal es limpia.
 */
export const palabraDeSinr = (db: number): string => {
  if (db < 0) return "mala";
  if (db < 5) return "regular";
  if (db < 10) return "aceptable";
  if (db < 20) return "buena";
  return "excelente";
};

/** «3 dB», redondeado a la unidad, con el signo menos tipográfico. */
export const textoDb = (db: number): string => {
  const entero = Math.round(db);
  return `${entero < 0 ? "−" : ""}${Math.abs(entero)} dB`;
};
