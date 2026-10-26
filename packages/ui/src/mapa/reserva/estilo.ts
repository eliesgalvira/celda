import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import {
  capasDeCelda,
  capasDeCeldaEncima,
  estadoDelEstilo,
  FUENTE_MAPA_BASE,
  fuentesDeCelda,
} from "../estilo.ts";
import { capaFoto, capaNumeroDelEdificio } from "../foto.ts";
import type { ContornoDeEspana } from "../rotulos.ts";
import { capasSilueta, fuentesSilueta } from "../silueta.ts";
import type { ColorDeToken } from "../tokens.ts";
import { capasLimitesDeReserva } from "./limites.ts";
import { capasRotulosDeReserva } from "./rotulos.ts";
import { capasSueloDeReserva } from "./suelo.ts";
import { capasViasDeReserva } from "./vias.ts";

/**
 * El mapa base de reserva: el vectorial del IGN (`vt-mapabase.idee.es`), que sirve Amazon
 * CloudFront y no Cloudflare (ADR 0018). La web pasa a él cuando el de OpenFreeMap no llega al
 * abrir, durante los bloqueos de LaLiga. Sus glifos son Noto Sans, con los mismos nombres, y
 * también salen del IGN: con la reserva puesta no se pide nada a Cloudflare.
 */

/** El nombre de la fuente del callejero de reserva dentro del estilo. */
export const FUENTE_RESERVA = "ign";

const IGN = "https://vt-mapabase.idee.es";

/** Las teselas del mapa base del IGN, del zoom 0 al 17. */
export const TESELAS_RESERVA = `${IGN}/1.0.0/mapabase/{z}/{x}/{y}.pbf`;

/** Los glifos del IGN. */
export const GLIFOS_RESERVA = `${IGN}/files/styles/fonts/pbf/{fontstack}/{range}.pbf`;

/**
 * El estilo del mapa base de reserva sobre las teselas del IGN, con la paleta A, los mismos tokens,
 * los mismos límites, la misma silueta mientras carga y las mismas capas de Celda que el principal
 * (`estiloMapa`). Fuera de la caja de España, con
 * Canarias, no se pide nada: el IGN contesta 403 a lo que no tiene, el mar y el extranjero de
 * cerca, y desde lejos esa caja ya cubre Portugal, el sur de Francia y el norte de Marruecos.
 */
export const estiloDeReserva = (
  color: ColorDeToken,
  espana: ContornoDeEspana,
): StyleSpecification => ({
  version: 8,
  glyphs: GLIFOS_RESERVA,
  state: estadoDelEstilo(),
  sources: {
    [FUENTE_RESERVA]: {
      type: "vector",
      tiles: [TESELAS_RESERVA],
      minzoom: 0,
      maxzoom: 17,
      bounds: [-18.4, 27.5, 4.5, 44],
    },
    ...fuentesDeCelda(),
    ...fuentesSilueta(espana),
  },
  layers: [
    ...capasSueloDeReserva(FUENTE_RESERVA, color, [capaFoto()]),
    ...capasSilueta(color),
    ...capasLimitesDeReserva(FUENTE_RESERVA, color),
    ...capasViasDeReserva(FUENTE_RESERVA, color),
    ...capasDeCelda(color),
    ...capasRotulosDeReserva(FUENTE_RESERVA, color, [capaNumeroDelEdificio(color)]),
    ...capasDeCeldaEncima(color),
  ],
});

/** Si una capa es del callejero principal: su fondo o una que lee sus teselas. */
const esDelPrincipal = (capa: LayerSpecification): boolean =>
  capa.type === "background" || ("source" in capa && capa.source === FUENTE_MAPA_BASE);

/**
 * El estilo de reserva con todo lo que el mapa ya tiene de Celda, para pasar a él con `setStyle`
 * sin perder nada: el mapa compara los dos y solo cambia el callejero.
 *
 * - Las fuentes de Celda se quedan como están, con lo que la web les ha puesto (la línea hasta el
 *   punto, el edificio resaltado…). Con las vacías del estilo, el mapa las vaciaría.
 * - Sus capas también, con los cambios que la web les haya hecho.
 * - El estado del estilo es el de antes: con otro, el mapa volvería a los valores por defecto y
 *   apagaría la foto aérea.
 */
export const conLoDeCelda = (
  anterior: StyleSpecification,
  reserva: StyleSpecification,
): StyleSpecification => {
  const deCelda = new Map(
    anterior.layers.filter((capa) => !esDelPrincipal(capa)).map((capa) => [capa.id, capa]),
  );
  const fuentes = Object.fromEntries(
    Object.entries(anterior.sources).filter(([id]) => id !== FUENTE_MAPA_BASE),
  );
  return {
    ...reserva,
    state: anterior.state ?? estadoDelEstilo(),
    sources: { ...reserva.sources, ...fuentes },
    layers: reserva.layers.map((capa) => deCelda.get(capa.id) ?? capa),
  };
};
