/** El tamaño del mundo en píxeles a zoom 0, con las teselas de 512 de MapLibre y supercluster. */
export const MUNDO = 512;

/** La x de una longitud en la proyección de Mercator de MapLibre, de 0 a 1. */
export const mercatorX = (longitud: number): number => (longitud + 180) / 360;

/** La y de una latitud en la proyección de Mercator de MapLibre, de 0 arriba a 1 abajo. */
export const mercatorY = (latitud: number): number => {
  const seno = Math.sin((latitud * Math.PI) / 180);
  return 0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI);
};
