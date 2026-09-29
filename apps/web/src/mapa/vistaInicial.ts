import { type Area, cajaDe, type Coordenada, ESPANA, type Rectangulo } from "@celda/dominio/area";
import { rectanguloDeCaja } from "@celda/dominio/cobertura";
import type { Asignacion } from "@celda/dominio/municipio";
import type { ResumenLeido } from "@celda/dominio/provincias";
import type { ProvinciaConCaja } from "@celda/dominio/zonaDelEjercicio";
import { recurso } from "@celda/ui/recurso.ts";
import { createEffect, createMemo, untrack } from "solid-js";

/**
 * Qué se ve al abrir el mapa, sin preguntar nada a nadie:
 *
 * 1. Con un emplazamiento en la dirección, ese emplazamiento (lo hace `PantallaMapa`).
 * 2. Con un punto de referencia guardado en el dispositivo, su provincia entera.
 * 3. Si no, lo que Celda ya tiene: las provincias cubiertas del resumen nacional o, si no hay
 *    ninguna, las que tienen algún emplazamiento.
 * 4. Sin resumen, España: la península con Baleares.
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
  /** El resumen nacional; `null` si no ha llegado. */
  readonly resumen: ResumenLeido | null | undefined;
}

/**
 * Lo que Celda ya tiene: la caja de los emplazamientos de las provincias cubiertas o, si no hay
 * ninguna, de todas las que tienen alguno. `undefined` si no tiene ninguno.
 */
export const encuadreDeLoQueHay = (resumen: ResumenLeido): Rectangulo | undefined => {
  const conEmplazamientos = resumen.provincias.filter((p) => p.caja !== undefined);
  const cubiertas = conEmplazamientos.filter((p) => p.cubierta);
  return cajaDe(
    (cubiertas.length > 0 ? cubiertas : conEmplazamientos).flatMap((p) =>
      p.caja === undefined ? [] : [p.caja.suroeste, p.caja.noreste],
    ),
  );
};

/** Lo que se ve al abrir, o `undefined` mientras falte algo para decidirlo. */
export const encuadreInicial = (alAbrir: AlAbrir): Rectangulo | undefined => {
  if (alAbrir.punto === undefined) return undefined;
  if (alAbrir.punto !== null) {
    if (alAbrir.provinciaDelPunto === undefined) return undefined;
    if (alAbrir.provinciaDelPunto !== null) return alAbrir.provinciaDelPunto;
  }
  if (alAbrir.resumen === undefined) return undefined;
  return (
    (alAbrir.resumen === null ? undefined : encuadreDeLoQueHay(alAbrir.resumen)) ?? ESPANA.encuadre
  );
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

/** El relleno al encuadrar: arriba la cabecera y la fecha; a la derecha, en escritorio, los controles. */
export const rellenoDeLaVista = (escritorio: boolean): Relleno =>
  escritorio
    ? { top: 110, bottom: 50, left: 40, right: 110 }
    : { top: 100, bottom: 80, left: 16, right: 16 };

/**
 * Lo más cerca que abre el mapa: el nivel de municipios. Una provincia con un solo emplazamiento
 * tiene una caja de un punto, y encuadrarla sin tope abriría a nivel de calle.
 */
export const ZOOM_MAXIMO_AL_ABRIR = 12;

/** Tamaño del mundo en píxeles a zoom 0, con las teselas de 512 de MapLibre. */
const MUNDO = 512;

const yMercator = (latitud: number): number => {
  const seno = Math.sin((latitud * Math.PI) / 180);
  return 0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI);
};

/**
 * El zoom al que MapLibre encuadra `caja` en una pantalla de `ancho` × `alto` con `relleno`, dentro
 * de los zooms del área. Sirve para pedir las provincias de la vista inicial antes de que el mapa
 * exista.
 */
export const zoomParaEncuadrar = (
  caja: Rectangulo,
  pantalla: { readonly ancho: number; readonly alto: number },
  relleno: Relleno,
  area: Area = ESPANA,
): number => {
  const dx = (caja.noreste.longitud - caja.suroeste.longitud) / 360;
  const dy = yMercator(caja.suroeste.latitud) - yMercator(caja.noreste.latitud);
  const ancho = Math.max(1, pantalla.ancho - relleno.left - relleno.right);
  const alto = Math.max(1, pantalla.alto - relleno.top - relleno.bottom);
  const zoom = Math.min(
    dx > 0 ? Math.log2(ancho / (dx * MUNDO)) : area.zoomMaximo,
    dy > 0 ? Math.log2(alto / (dy * MUNDO)) : area.zoomMaximo,
  );
  return Math.min(ZOOM_MAXIMO_AL_ABRIR, Math.max(area.zoomMinimo, zoom));
};

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
  readonly relleno: () => Relleno;
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
        { animate: false, padding: untrack(entrada.relleno), maxZoom: ZOOM_MAXIMO_AL_ABRIR },
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
