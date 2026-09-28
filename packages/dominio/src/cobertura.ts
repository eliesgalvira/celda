import * as Schema from "effect/Schema";

import { type Coordenada, distanciaAlRectangulo, type Rectangulo } from "./area.ts";

/**
 * Hasta dónde llegan los datos de Celda (ADR 0014 y 0016). La ingesta lee entero el registro
 * oficial dentro de unas zonas de barrido: dentro de ellas el mapa tiene todos los
 * emplazamientos, y fuera no tiene ninguno. Una provincia está cubierta si alguna zona la barre
 * entera; si una zona solo la toca, sus emplazamientos de dentro de la zona están todos, pero su
 * número no es el de la provincia.
 */

/** Un rectángulo en grados en el orden de `bbox`: oeste, sur, este y norte. */
export const Caja = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]);
export type Caja = typeof Caja.Type;

/** Una zona de barrido tal como se publica, con la fecha de su último barrido completo. */
export const ZonaBarrida = Schema.Struct({
  /** Cómo la llama la configuración de la ingesta, por ejemplo «Caja de Barcelona». */
  nombre: Schema.String,
  /** Lo que se barre, en cajas que no se solapan. */
  cajas: Schema.Array(Caja),
  /** Códigos INE de las provincias que barre enteras. */
  provincias: Schema.Array(Schema.String),
  /** Inicio del último barrido completo, en milisegundos, o `null` si aún no se ha barrido. */
  barrido: Schema.NullOr(Schema.Finite),
});
export type ZonaBarrida = typeof ZonaBarrida.Type;

/** Una caja como rectángulo entre dos esquinas. */
export const rectanguloDeCaja = ([oeste, sur, este, norte]: Caja): Rectangulo => ({
  suroeste: { longitud: oeste, latitud: sur },
  noreste: { longitud: este, latitud: norte },
});

/** Un rectángulo como caja. */
export const cajaDeRectangulo = (rectangulo: Rectangulo): Caja => [
  rectangulo.suroeste.longitud,
  rectangulo.suroeste.latitud,
  rectangulo.noreste.longitud,
  rectangulo.noreste.latitud,
];

/** Si dos rectángulos se tocan, bordes incluidos. */
export const seCortan = (a: Rectangulo, b: Rectangulo): boolean =>
  a.suroeste.longitud <= b.noreste.longitud &&
  b.suroeste.longitud <= a.noreste.longitud &&
  a.suroeste.latitud <= b.noreste.latitud &&
  b.suroeste.latitud <= a.noreste.latitud;

/**
 * A cuántos metros queda un punto de lo barrido: 0 si cae en alguna caja de alguna zona. Sin
 * ninguna zona, `undefined`: no se sabe hasta dónde llegan los datos.
 */
export const distanciaALoBarrido = (
  punto: Coordenada,
  cobertura: ReadonlyArray<ZonaBarrida>,
): number | undefined => {
  let minima: number | undefined;
  for (const zona of cobertura) {
    for (const caja of zona.cajas) {
      const metros = distanciaAlRectangulo(punto, rectanguloDeCaja(caja));
      minima = minima === undefined ? metros : Math.min(minima, metros);
    }
  }
  return minima;
};

/** Si alguna zona barre entera la provincia `codigo`. */
export const provinciaCubierta = (codigo: string, cobertura: ReadonlyArray<ZonaBarrida>): boolean =>
  cobertura.some((zona) => zona.provincias.includes(codigo));

/**
 * El último barrido completo de lo que se sabe de una provincia: el más reciente de las zonas que
 * la barren entera o que tocan la caja de sus emplazamientos. `null` si ninguna lo ha hecho.
 */
export const barridoDeProvincia = (
  codigo: string,
  caja: Rectangulo | undefined,
  cobertura: ReadonlyArray<ZonaBarrida>,
): number | null => {
  let ultimo: number | null = null;
  for (const zona of cobertura) {
    const toca =
      zona.provincias.includes(codigo) ||
      (caja !== undefined && zona.cajas.some((c) => seCortan(rectanguloDeCaja(c), caja)));
    if (toca && zona.barrido !== null) ultimo = Math.max(ultimo ?? zona.barrido, zona.barrido);
  }
  return ultimo;
};
