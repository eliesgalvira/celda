import { LimitesDeBarrios } from "@celda/dominio/barrio";
import * as Schema from "effect/Schema";

import barrios from "../datos/barrios.json" with { type: "json" };

/**
 * Los límites de barrio de Open Data BCN que usa la publicación, guardados en git junto a ella
 * (ADR 0004). `pnpm run barrios`, en `tools/capas`, los vuelve a descargar.
 */
export const limitesDeBarcelona = Schema.decodeUnknownEffect(LimitesDeBarrios)(barrios);
