import { type Area, type Coordenada, ESPANA, type Rectangulo } from "@celda/dominio/area";
import { rectanguloDeCaja } from "@celda/dominio/cobertura";
import type { Asignacion } from "@celda/dominio/municipio";
import type { ProvinciaConCaja } from "@celda/dominio/zonaDelEjercicio";
import { recurso } from "@celda/ui/recurso.ts";
import { createEffect, createMemo, untrack } from "solid-js";

/**
 * Qué se ve al abrir el mapa, sin preguntar nada a nadie:
 *
 * 1. Con un emplazamiento en la dirección, ese emplazamiento (lo hace `PantallaMapa`).
 * 2. Con un punto de referencia guardado en el dispositivo, su provincia entera.
 * 3. Si no, o si el punto no cae en ninguna provincia, la península entera (`ESPANA.encuadre`).
 *
 * La ubicación GPS no cuenta aunque el permiso ya esté dado: encenderla al abrir sería pedir algo
 * que nadie ha pedido.
 */

/** Lo que se sabe al abrir. `undefined` es que aún no se sabe; `null`, que no hay. */
export interface AlAbrir {
  /** El punto de referencia guardado en el dispositivo. */
  readonly punto: Coordenada | null | undefined;
  /** La caja de los límites de la provincia del punto. */
  readonly provinciaDelPunto: Rectangulo | null | undefined;
}

/** Lo que se ve al abrir, o `undefined` mientras falte algo para decidirlo. */
export const encuadreInicial = (alAbrir: AlAbrir): Rectangulo | undefined => {
  if (alAbrir.punto === undefined) return undefined;
  if (alAbrir.punto === null) return ESPANA.encuadre;
  if (alAbrir.provinciaDelPunto === undefined) return undefined;
  return alAbrir.provinciaDelPunto ?? ESPANA.encuadre;
};

/**
 * La caja de la provincia en que cae un punto: `undefined` mientras no se sabe dónde cae y `null`
 * si no cae en ninguna.
 */
export const provinciaDelPunto = (
  asignacion: Asignacion | undefined,
  provincias: ReadonlyArray<ProvinciaConCaja> | undefined,
): Rectangulo | null | undefined => {
  if (asignacion === undefined) return undefined;
  const codigo = asignacion.provincia?.codigo;
  if (codigo === undefined) return null;
  const suya = provincias?.find((p) => p.codigo === codigo);
  return suya === undefined ? null : rectanguloDeCaja(suya.caja);
};

/** Lo que tapan la cabecera, los controles y los créditos, en píxeles. */
export interface Relleno {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** El tamaño de la pantalla en píxeles CSS. */
export interface Pantalla {
  readonly ancho: number;
  readonly alto: number;
}

/**
 * Lo que tapa la interfaz de `DisposicionMapa` al abrir, en píxeles desde el borde de la pantalla
 * y con un margen para que nada quede pegado a ella.
 */
interface LoQueTapa {
  /** Arriba, la cabecera y la marca de agua «Datos del mapa» debajo. */
  readonly arriba: number;
  /** El margen con los bordes que no tapa nada. */
  readonly lado: number;
  /**
   * Abajo a la derecha, las pastillas «Foto aérea», «Ubicación» y «Funciones» y, en escritorio,
   * Acercar y Alejar encima.
   */
  readonly controles: { readonly ancho: number; readonly alto: number };
  /** Abajo a la izquierda, los créditos: en el móvil, el botón «i»; en escritorio, una o dos líneas. */
  readonly creditos: number;
}

const LO_QUE_TAPA_EN_EL_MOVIL: LoQueTapa = {
  arriba: 100,
  lado: 12,
  controles: { ancho: 174, alto: 168 },
  creditos: 60,
};

const LO_QUE_TAPA_EN_ESCRITORIO: LoQueTapa = {
  arriba: 110,
  lado: 40,
  controles: { ancho: 190, alto: 324 },
  creditos: 64,
};

/** Tamaño del mundo en píxeles a zoom 0, con las teselas de 512 de MapLibre. */
const MUNDO = 512;

const yMercator = (latitud: number): number => {
  const seno = Math.sin((latitud * Math.PI) / 180);
  return 0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI);
};

/** El zoom al que `caja` llena lo que deja libre `relleno`, sin topes. */
const zoomQueLlena = (caja: Rectangulo, pantalla: Pantalla, relleno: Relleno): number => {
  const dx = (caja.noreste.longitud - caja.suroeste.longitud) / 360;
  const dy = yMercator(caja.suroeste.latitud) - yMercator(caja.noreste.latitud);
  const ancho = Math.max(1, pantalla.ancho - relleno.left - relleno.right);
  const alto = Math.max(1, pantalla.alto - relleno.top - relleno.bottom);
  return Math.min(
    dx > 0 ? Math.log2(ancho / (dx * MUNDO)) : Number.POSITIVE_INFINITY,
    dy > 0 ? Math.log2(alto / (dy * MUNDO)) : Number.POSITIVE_INFINITY,
  );
};

/**
 * El relleno al encuadrar `caja` al abrir. La cabecera tapa arriba y los controles abajo a la
 * derecha, así que lo libre no es un rectángulo: la caja va encima de los controles o a su
 * izquierda, donde se vea más grande. La península, más ancha que alta, va encima en el móvil y en
 * una tableta vertical, y a su izquierda en una pantalla apaisada.
 */
export const rellenoDeLaVista = (
  caja: Rectangulo,
  pantalla: Pantalla,
  escritorio: boolean,
): Relleno => {
  const tapa = escritorio ? LO_QUE_TAPA_EN_ESCRITORIO : LO_QUE_TAPA_EN_EL_MOVIL;
  const encima: Relleno = {
    top: tapa.arriba,
    bottom: tapa.controles.alto,
    left: tapa.lado,
    right: tapa.lado,
  };
  const alLado: Relleno = {
    top: tapa.arriba,
    bottom: tapa.creditos,
    left: tapa.lado,
    right: tapa.controles.ancho,
  };
  return zoomQueLlena(caja, pantalla, alLado) > zoomQueLlena(caja, pantalla, encima)
    ? alLado
    : encima;
};

/**
 * Lo más cerca que abre el mapa: el nivel de municipios. Una provincia con un solo emplazamiento
 * tiene una caja de un punto, y encuadrarla sin tope abriría a nivel de calle.
 */
export const ZOOM_MAXIMO_AL_ABRIR = 12;

/**
 * El zoom al que MapLibre encuadra `caja` en `pantalla` con `relleno`, dentro de los zooms del
 * área. Sirve para pedir las provincias de la vista inicial antes de que el mapa exista.
 */
export const zoomParaEncuadrar = (
  caja: Rectangulo,
  pantalla: Pantalla,
  relleno: Relleno,
  area: Area = ESPANA,
): number =>
  Math.min(ZOOM_MAXIMO_AL_ABRIR, Math.max(area.zoomMinimo, zoomQueLlena(caja, pantalla, relleno)));

/** Un movimiento del mapa; si lo ha hecho una persona, lleva el evento que lo empezó. */
export interface Movimiento {
  readonly originalEvent?: unknown;
}

/** Lo que hace falta del mapa para ponerlo en la vista inicial. `Map` de MapLibre lo cumple. */
export interface MapaQueSeEncuadra {
  readonly fitBounds: (
    caja: [[number, number], [number, number]],
    opciones: {
      readonly animate: false;
      readonly padding: Relleno;
      readonly maxZoom: number;
    },
  ) => void;
  readonly on: (evento: "movestart", oyente: (movimiento: Movimiento) => void) => void;
  readonly off: (evento: "movestart", oyente: (movimiento: Movimiento) => void) => void;
}

export interface VistaInicial {
  /** Lo que se ve al abrir, cuando se sabe. */
  readonly encuadre: () => Rectangulo | undefined;
  /**
   * Al crear el mapa: el encuadre con que nace, si ya se sabe. Entonces nace ahí y la vista
   * inicial ya está puesta.
   */
  readonly alCrear: () => Rectangulo | undefined;
  /** El mapa ya se ha llevado a otro sitio: la vista inicial ya no lo mueve. */
  readonly yaColocado: () => void;
}

/**
 * Pone el mapa en la vista inicial una sola vez, en cuanto se sabe cuál es y el mapa existe, sin
 * animación. Si antes lo ha movido una persona, o la web lo ha llevado a otro sitio
 * (`yaColocado`), ya no lo mueve.
 */
export const crearVistaInicial = (entrada: {
  /** Sin activar (hay un emplazamiento en la dirección), no hace nada. */
  readonly activa: boolean;
  readonly alAbrir: () => AlAbrir;
  readonly mapa: () => MapaQueSeEncuadra | undefined;
  /** Lo que tapa la interfaz al encuadrar `caja`. */
  readonly relleno: (caja: Rectangulo) => Relleno;
}): VistaInicial => {
  let colocado = !entrada.activa;
  const encuadre = createMemo(() =>
    entrada.activa ? encuadreInicial(entrada.alAbrir()) : undefined,
  );

  // Un gesto de una persona lleva el evento del navegador que lo empezó; los de la web, no.
  recurso(
    "vista-inicial:gestos",
    () => (entrada.activa ? entrada.mapa() : undefined),
    (mapa) => {
      const alEmpezar = (movimiento: Movimiento) => {
        if (movimiento.originalEvent !== undefined) colocado = true;
      };
      mapa.on("movestart", alEmpezar);
      return () => {
        mapa.off("movestart", alEmpezar);
      };
    },
  );

  createEffect(
    () => ({ mapa: entrada.mapa(), caja: encuadre() }),
    ({ mapa, caja }) => {
      if (colocado || mapa === undefined || caja === undefined) return;
      colocado = true;
      mapa.fitBounds(
        [
          [caja.suroeste.longitud, caja.suroeste.latitud],
          [caja.noreste.longitud, caja.noreste.latitud],
        ],
        {
          animate: false,
          padding: untrack(() => entrada.relleno(caja)),
          maxZoom: ZOOM_MAXIMO_AL_ABRIR,
        },
      );
    },
  );

  return {
    encuadre,
    alCrear: () => {
      const caja = untrack(encuadre);
      if (colocado || caja === undefined) return undefined;
      colocado = true;
      return caja;
    },
    yaColocado: () => {
      colocado = true;
    },
  };
};
