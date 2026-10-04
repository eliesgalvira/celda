import * as Schema from "effect/Schema";

import datos from "../datos/centros-de-provincia.json" with { type: "json" };
import type { Coordenada } from "./area.ts";
import { FuenteDeMunicipios } from "./municipio.ts";
import { FuenteDePoblacion } from "./poblacion.ts";

/**
 * El centro visual de cada provincia, donde el mapa pone su hexágono de lejos (ADR 0024), y sus
 * habitantes, con los que compite con los rótulos de ciudad. El centro es el polo de
 * inaccesibilidad de su polígono más poblado, calculado en Mercator, que es como se ve el mapa:
 * el punto más alejado de sus bordes. En Illes Balears cae en Mallorca, en Las Palmas en Gran
 * Canaria y en Santa Cruz de Tenerife en Tenerife; en A Coruña, Pontevedra y Cádiz, en la
 * península.
 *
 * No sustituye la etiqueta del resumen nacional: la publicación la usa para dar provincia a los
 * emplazamientos que no tienen ninguna (ADR 0016). La tabla la escribe `pnpm run centros` en
 * `tools/capas` desde los límites y el padrón del repositorio, y una prueba de allí comprueba que
 * está al día.
 */

/** Lo que se sabe de una provincia para dibujarla de lejos. */
export const CentroDeProvincia = Schema.Struct({
  /** El centro visual, `[longitud, latitud]`. */
  centro: Schema.Tuple([Schema.Finite, Schema.Finite]),
  /** La suma de los habitantes de sus municipios en el padrón. */
  habitantes: Schema.Int,
});
export type CentroDeProvincia = typeof CentroDeProvincia.Type;

/** La tabla de los centros, con sus fuentes y cómo se calcularon. */
export const CentrosDeProvincia = Schema.Struct({
  fuente: FuenteDeMunicipios,
  padron: FuenteDePoblacion,
  /** A cuánto se simplifican los anillos antes de buscar el centro. */
  toleranciaMetros: Schema.Finite,
  /** La precisión del polo de inaccesibilidad. */
  precisionMetros: Schema.Finite,
  /** Por código INE de dos cifras. */
  provincias: Schema.Record(Schema.String, CentroDeProvincia),
});
export type CentrosDeProvincia = typeof CentrosDeProvincia.Type;

/** La tabla guardada en el repositorio, por código. */
const POR_CODIGO: ReadonlyMap<string, CentroDeProvincia> = new Map(
  Object.entries(datos.provincias).map(([codigo, { centro, habitantes }]) => [
    codigo,
    { centro: [centro[0] ?? 0, centro[1] ?? 0], habitantes },
  ]),
);

/** El centro visual de una provincia, o `undefined` si la tabla no la tiene. */
export const centroVisual = (codigo: string): Coordenada | undefined => {
  const fila = POR_CODIGO.get(codigo);
  return fila === undefined ? undefined : { longitud: fila.centro[0], latitud: fila.centro[1] };
};

/** Los habitantes de una provincia en el padrón; 0 si la tabla no la tiene. */
export const habitantesDeProvincia = (codigo: string): number =>
  POR_CODIGO.get(codigo)?.habitantes ?? 0;
