/**
 * Cómo está la ficha respecto al mapa (ADR 0004). La capa se publica de una instantánea y la
 * ficha se lee en vivo, así que la ficha puede ser más reciente. Si lo es, el panel lo dice y el
 * marcador se queda como está hasta la siguiente capa.
 */
export type ComparacionConCapa =
  /** No hay capa cargada con la que comparar. */
  | { readonly tipo: "sin-capa" }
  /** La ficha no ha cambiado desde la instantánea de la capa. */
  | { readonly tipo: "al-dia" }
  /** La ficha ha cambiado después: el mapa aún no lo refleja. */
  | { readonly tipo: "posterior"; readonly ficha: number; readonly capa: number };

/**
 * Compara la marca de agua de la ficha con la de la capa, las dos en milisegundos. La versión de
 * la capa va al segundo, así que la ficha se compara también al segundo: la de la misma ejecución
 * que la capa no es posterior aunque tenga milisegundos.
 */
export const compararConCapa = (capa: number | undefined, ficha: number): ComparacionConCapa => {
  if (capa === undefined) return { tipo: "sin-capa" };
  return Math.floor(ficha / 1000) * 1000 > capa
    ? { tipo: "posterior", ficha, capa }
    : { tipo: "al-dia" };
};
