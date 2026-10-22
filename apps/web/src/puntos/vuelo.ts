import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { type MascarasDeFiltro, papelDeMascara } from "@celda/dominio/filtro";
import { ESCALA_DE_PUNTOS, type PuntosLeidos } from "@celda/dominio/puntos";

import type { Elemento, Escena } from "../capa/agrupacion.ts";
import { mercatorX, mercatorY } from "../lib/mercator.ts";

/**
 * Hacia dónde vuela cada punto al cambiar de vista (ADR 0028): el sitio del marcador de la vista
 * agrupada que lo recoge. De lejos es el hexágono de su provincia; más cerca, el de su municipio,
 * su barrio o su agrupación, o su propio logo. Un punto cuyo marcador no está en la escena se
 * queda en su sitio y solo se apaga o se enciende.
 */

/** Las posiciones del vuelo en coordenadas de Mercator de 0 a 1, de dos en dos. */
export interface PosicionesDelVuelo {
  readonly desde: Float32Array<ArrayBuffer>;
  readonly hasta: Float32Array<ArrayBuffer>;
}

/** Una posición al metro, como van los puntos: así se encuentra el marcador de cada uno. */
const claveDeSitio = (posicion: Coordenada): string =>
  `${Math.round(posicion.longitud * ESCALA_DE_PUNTOS)},${Math.round(posicion.latitud * ESCALA_DE_PUNTOS)}`;

/**
 * Lo que vuela: los puntos de `caja` que salen con el filtro, cada uno de su sitio al marcador de
 * `escena` que lo recoge (`emplazamientosDe`) o, sin él, al hexágono de su provincia si la escena
 * lo tiene. Al separarse se usa al revés.
 */
export const posicionesDelVuelo = (
  puntos: PuntosLeidos,
  escena: Escena,
  emplazamientosDe: (elemento: Elemento) => ReadonlyArray<EmplazamientoLeido>,
  caja: Rectangulo,
  filtro: MascarasDeFiltro,
): PosicionesDelVuelo => {
  const porSitio = new Map<string, Coordenada>();
  const porProvincia = new Map<string, Coordenada>();
  for (const elemento of escena.elementos.values()) {
    if (elemento.tipo === "provincia") {
      porProvincia.set(elemento.provincia.codigo, elemento.posicion);
      continue;
    }
    const suyos =
      elemento.tipo === "emplazamiento" ? [elemento.emplazamiento] : emplazamientosDe(elemento);
    for (const emplazamiento of suyos) {
      porSitio.set(claveDeSitio(emplazamiento.posicion), elemento.posicion);
    }
  }
  // Se escribe directamente en los búferes: con 40.000 puntos y la CPU de un móvil, crear un objeto
  // o una cadena por punto se notaba en el fotograma del cambio.
  const desde = new Float32Array(2 * puntos.cuantos);
  const hasta = new Float32Array(2 * puntos.cuantos);
  const { suroeste, noreste } = caja;
  let n = 0;
  for (let i = 0; i < puntos.cuantos; i++) {
    const longitud = puntos.longitud[i] ?? 0;
    const latitud = puntos.latitud[i] ?? 0;
    if (
      longitud < suroeste.longitud ||
      longitud > noreste.longitud ||
      latitud < suroeste.latitud ||
      latitud > noreste.latitud
    ) {
      continue;
    }
    if (papelDeMascara(puntos.companias[i] ?? 0, filtro) === undefined) continue;
    const marcador =
      (porSitio.size === 0 ? undefined : porSitio.get(claveDeSitio({ longitud, latitud }))) ??
      porProvincia.get(puntos.provincias[puntos.provincia[i] ?? -1] ?? "");
    desde[2 * n] = mercatorX(longitud);
    desde[2 * n + 1] = mercatorY(latitud);
    hasta[2 * n] = marcador === undefined ? mercatorX(longitud) : mercatorX(marcador.longitud);
    hasta[2 * n + 1] = marcador === undefined ? mercatorY(latitud) : mercatorY(marcador.latitud);
    n += 1;
  }
  return { desde: desde.slice(0, 2 * n), hasta: hasta.slice(0, 2 * n) };
};
