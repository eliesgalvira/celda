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

/** La v1 cubre Barcelona y los municipios de alrededor. */
export const BARCELONA: Area = {
  nombre: "Barcelona",
  encuadre: {
    suroeste: { longitud: 2.069, latitud: 41.32 },
    noreste: { longitud: 2.228, latitud: 41.469 },
  },
  limites: {
    suroeste: { longitud: 1.85, latitud: 41.2 },
    noreste: { longitud: 2.45, latitud: 41.6 },
  },
  zoomMinimo: 10,
  zoomMaximo: 18.5,
};

/** Si el punto cae dentro del rectángulo, bordes incluidos. */
export const contiene = (rectangulo: Rectangulo, punto: Coordenada): boolean =>
  punto.longitud >= rectangulo.suroeste.longitud &&
  punto.longitud <= rectangulo.noreste.longitud &&
  punto.latitud >= rectangulo.suroeste.latitud &&
  punto.latitud <= rectangulo.noreste.latitud;
