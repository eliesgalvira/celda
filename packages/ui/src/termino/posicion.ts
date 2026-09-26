/** Un rectángulo en píxeles de la ventana, como el que da `getBoundingClientRect`. */
export interface Caja {
  readonly izquierda: number;
  readonly arriba: number;
  readonly ancho: number;
  readonly alto: number;
}

export interface Ventana {
  readonly ancho: number;
  readonly alto: number;
}

/** Dónde va la explicación de un término y hacia dónde apunta su pico. */
export interface Colocacion {
  readonly izquierda: number;
  readonly arriba: number;
  readonly ancho: number;
  /** Si no cabe entera, el alto que tiene y se desplaza por dentro. */
  readonly altoMaximo: number;
  /** A qué lado del término queda. */
  readonly lado: "abajo" | "arriba";
  /** Dónde va el pico que señala el término, desde el borde izquierdo de la explicación. */
  readonly pico: number;
}

/** Distancia mínima a los bordes de la ventana, en px. */
export const MARGEN = 8;
/** Espacio entre el término y la explicación, donde cabe el pico, en px. */
export const SEPARACION = 10;
/** Ancho de la explicación en escritorio, en px (22rem). */
export const ANCHO_ESCRITORIO = 352;
/** Desde qué ancho de ventana se considera escritorio, en px (48rem, el `md` del tema). */
export const ESCRITORIO_DESDE = 768;
/** El pico no llega a las esquinas cortadas de la explicación. */
const PICO_HASTA_EL_BORDE = 22;

const acotar = (valor: number, minimo: number, maximo: number): number =>
  Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));

/**
 * Coloca la explicación de un término sin taparlo: debajo si cabe, encima si no, y si no cabe
 * en ninguno de los dos lados, en el que tenga más sitio y con desplazamiento por dentro. En el
 * móvil ocupa todo el ancho menos los márgenes; en escritorio, 22rem centrados sobre el término.
 */
export const colocarExplicacion = (ancla: Caja, alto: number, ventana: Ventana): Colocacion => {
  const disponible = ventana.ancho - 2 * MARGEN;
  const ancho =
    ventana.ancho < ESCRITORIO_DESDE ? disponible : Math.min(ANCHO_ESCRITORIO, disponible);
  const centro = ancla.izquierda + ancla.ancho / 2;
  const izquierda = acotar(centro - ancho / 2, MARGEN, ventana.ancho - MARGEN - ancho);

  const bajo = ancla.arriba + ancla.alto + SEPARACION;
  const sitioAbajo = ventana.alto - MARGEN - bajo;
  const sitioArriba = ancla.arriba - SEPARACION - MARGEN;
  const lado =
    alto <= sitioAbajo || (alto > sitioArriba && sitioAbajo >= sitioArriba) ? "abajo" : "arriba";
  const altoMaximo = Math.max(0, lado === "abajo" ? sitioAbajo : sitioArriba);
  const arriba = lado === "abajo" ? bajo : ancla.arriba - SEPARACION - Math.min(alto, altoMaximo);

  return {
    izquierda,
    arriba,
    ancho,
    altoMaximo,
    lado,
    pico: acotar(centro - izquierda, PICO_HASTA_EL_BORDE, ancho - PICO_HASTA_EL_BORDE),
  };
};
