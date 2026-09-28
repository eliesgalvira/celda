import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import {
  type IndiceDeMunicipios,
  indexarMunicipios,
  LimitesDeMunicipios,
} from "@celda/dominio/municipio";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import municipios from "../datos/municipios.json" with { type: "json" };
import { limitesDeBarcelona } from "./barrios.ts";

/**
 * Las zonas en que la publicación sitúa cada emplazamiento: el barrio de Barcelona, que va en la
 * capa, y el municipio y la provincia del IGN, que van en su ficha (ADR 0004 y 0017).
 */
export interface ZonasDePublicacion {
  readonly barrios: LimitesDeBarrios;
  readonly municipios: IndiceDeMunicipios;
}

const decodificarMunicipios = Schema.decodeUnknownEffect(LimitesDeMunicipios);

/**
 * Los límites de municipios y provincias del IGN guardados en git junto a la publicación,
 * indexados. `pnpm run municipios`, en `tools/capas`, los vuelve a descargar.
 */
export const municipiosDeEspana = Effect.map(decodificarMunicipios(municipios), indexarMunicipios);

/** Las zonas de verdad: los barrios de Open Data BCN y los municipios del IGN. */
export const zonasDePublicacion = Effect.all({
  barrios: limitesDeBarcelona,
  municipios: municipiosDeEspana,
});
