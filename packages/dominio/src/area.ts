import * as Schema from "effect/Schema";

/** Un punto en grados WGS84, en el orden de GeoJSON y MapLibre: longitud y latitud. */
export const Coordenada = Schema.Struct({
  longitud: Schema.Finite.pipe(Schema.check(Schema.isBetween({ minimum: -180, maximum: 180 }))),
  latitud: Schema.Finite.pipe(Schema.check(Schema.isBetween({ minimum: -90, maximum: 90 }))),
});
export type Coordenada = typeof Coordenada.Type;

/** Rectángulo entre dos esquinas. */
export interface Rectangulo {
  readonly suroeste: Coordenada;
  readonly noreste: Coordenada;
}

/** La zona que cubre Celda y cómo se enseña al abrir el mapa. */
export interface Area {
  readonly nombre: string;
  /** Lo que se ve al abrir el mapa, en cualquier tamaño de pantalla. */
  readonly encuadre: Rectangulo;
  /** Hasta dónde se puede mover el mapa. */
  readonly limites: Rectangulo;
  readonly zoomMinimo: number;
  readonly zoomMaximo: number;
}

/**
 * El mapa de Celda desde la capa por provincias (ADR 0016): se mueve por toda España, con
 * Canarias. Su encuadre es la península con Baleares, lo que se ve si no se sabe nada mejor: la
 * vista inicial de la web encuadra lo que Celda ya tiene o la provincia del punto de referencia.
 */
export const ESPANA: Area = {
  nombre: "España",
  encuadre: {
    suroeste: { longitud: -9.4, latitud: 35.9 },
    noreste: { longitud: 4.4, latitud: 43.8 },
  },
  limites: {
    suroeste: { longitud: -19.5, latitud: 26.5 },
    noreste: { longitud: 5.5, latitud: 44.5 },
  },
  zoomMinimo: 4,
  zoomMaximo: 18.5,
};

/** Si el punto cae dentro del rectángulo, bordes incluidos. */
export const contiene = (rectangulo: Rectangulo, punto: Coordenada): boolean =>
  punto.longitud >= rectangulo.suroeste.longitud &&
  punto.longitud <= rectangulo.noreste.longitud &&
  punto.latitud >= rectangulo.suroeste.latitud &&
  punto.latitud <= rectangulo.noreste.latitud;

/**
 * Si dos coordenadas son el mismo punto, o las dos faltan. Cada lectura del GPS trae un objeto
 * nuevo aunque no se haya movido: esto dice si de verdad ha cambiado.
 */
export const mismaCoordenada = (a: Coordenada | undefined, b: Coordenada | undefined): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && a.longitud === b.longitud && a.latitud === b.latitud);

/** Radio medio de la Tierra en metros (IUGG). */
export const RADIO_TIERRA_METROS = 6_371_008.8;

/**
 * Distancia en metros entre dos puntos cercanos, con la aproximación equirectangular. A las
 * distancias que usa la fusión (decenas de metros) el error es de milímetros.
 */
export const distanciaMetros = (a: Coordenada, b: Coordenada): number => {
  const radianes = Math.PI / 180;
  const latitudMedia = ((a.latitud + b.latitud) / 2) * radianes;
  const x = (b.longitud - a.longitud) * radianes * Math.cos(latitudMedia);
  const y = (b.latitud - a.latitud) * radianes;
  return Math.hypot(x, y) * RADIO_TIERRA_METROS;
};

/**
 * Rumbo inicial en grados para ir de `desde` a `hasta`: de 0 a 360, desde el norte y en el
 * sentido de las agujas del reloj. Si los dos puntos coinciden, da 0.
 */
export const rumboGrados = (desde: Coordenada, hasta: Coordenada): number => {
  const radianes = Math.PI / 180;
  const latitud1 = desde.latitud * radianes;
  const latitud2 = hasta.latitud * radianes;
  const diferencia = (hasta.longitud - desde.longitud) * radianes;
  const y = Math.sin(diferencia) * Math.cos(latitud2);
  const x =
    Math.cos(latitud1) * Math.sin(latitud2) -
    Math.sin(latitud1) * Math.cos(latitud2) * Math.cos(diferencia);
  return (Math.atan2(y, x) / radianes + 360) % 360;
};

/** El rectángulo más pequeño que contiene todos los puntos, o `undefined` si no hay ninguno. */
export const cajaDe = (puntos: ReadonlyArray<Coordenada>): Rectangulo | undefined => {
  const [primero] = puntos;
  if (primero === undefined) return undefined;
  let oeste = primero.longitud;
  let este = primero.longitud;
  let sur = primero.latitud;
  let norte = primero.latitud;
  for (const { longitud, latitud } of puntos) {
    oeste = Math.min(oeste, longitud);
    este = Math.max(este, longitud);
    sur = Math.min(sur, latitud);
    norte = Math.max(norte, latitud);
  }
  return {
    suroeste: { longitud: oeste, latitud: sur },
    noreste: { longitud: este, latitud: norte },
  };
};

/**
 * Distancia en metros de un punto al borde más cercano de un rectángulo, 0 si cae dentro. Mide
 * sobre la esfera (haversine) porque puede ser de cientos de kilómetros: de Tenerife a Barcelona.
 */
export const distanciaAlRectangulo = (punto: Coordenada, rectangulo: Rectangulo): number => {
  const cercano = {
    longitud: Math.min(
      Math.max(punto.longitud, rectangulo.suroeste.longitud),
      rectangulo.noreste.longitud,
    ),
    latitud: Math.min(
      Math.max(punto.latitud, rectangulo.suroeste.latitud),
      rectangulo.noreste.latitud,
    ),
  };
  if (mismaCoordenada(punto, cercano)) return 0;
  const radianes = Math.PI / 180;
  const dLatitud = (cercano.latitud - punto.latitud) * radianes;
  const dLongitud = (cercano.longitud - punto.longitud) * radianes;
  const h =
    Math.sin(dLatitud / 2) ** 2 +
    Math.cos(punto.latitud * radianes) *
      Math.cos(cercano.latitud * radianes) *
      Math.sin(dLongitud / 2) ** 2;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
};
