import type { Cuadro } from "@celda/dominio/barrido";
import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import { cuadrosDeProvincias } from "@celda/dominio/cobertura";
import {
  type IndiceDeMunicipios,
  indexarMunicipios,
  LimitesDeMunicipios,
  PadronDeMunicipios,
} from "@celda/dominio/municipio";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import municipios from "../datos/municipios.json" with { type: "json" };
import padron from "../datos/padron.json" with { type: "json" };
import { limitesDeBarcelona } from "./barrios.ts";

/**
 * Las zonas en que la publicación sitúa cada emplazamiento: el barrio de Barcelona, el municipio y
 * la provincia del IGN, y los habitantes de cada municipio en el padrón del INE (ADR 0004, 0016 y
 * 0017). La provincia decide en qué capa va; el municipio y el barrio van en esa capa y en la
 * ficha.
 */
export interface ZonasDePublicacion {
  readonly barrios: LimitesDeBarrios;
  readonly municipios: IndiceDeMunicipios;
  readonly padron: PadronDeMunicipios;
  /**
   * Los cuadros con datos que toca cada provincia (`cuadrosDeProvincias`), para saber si una
   * provincia está cubierta. Se calculan una vez con los límites.
   */
  readonly cuadros: ReadonlyMap<string, ReadonlySet<Cuadro>>;
}

/** Las zonas con los cuadros de cada provincia calculados. */
export const conCuadros = (zonas: Omit<ZonasDePublicacion, "cuadros">): ZonasDePublicacion => ({
  ...zonas,
  cuadros: cuadrosDeProvincias(zonas.municipios),
});

const decodificarMunicipios = Schema.decodeUnknownEffect(LimitesDeMunicipios);
const decodificarPadron = Schema.decodeUnknownEffect(PadronDeMunicipios);

/**
 * Los límites de municipios y provincias del IGN guardados en git junto a la publicación,
 * indexados. `pnpm run municipios`, en `tools/capas`, los vuelve a descargar.
 */
export const municipiosDeEspana = Effect.map(decodificarMunicipios(municipios), indexarMunicipios);

/** Los habitantes de cada municipio en el padrón del INE, también de `pnpm run municipios`. */
export const padronDeEspana = decodificarPadron(padron);

/** Las zonas de verdad: los barrios de Open Data BCN, los municipios del IGN y el padrón. */
export const zonasDePublicacion = Effect.map(
  Effect.all({
    barrios: limitesDeBarcelona,
    municipios: municipiosDeEspana,
    padron: padronDeEspana,
  }),
  conCuadros,
);
