import type { FilterSpecification, LayerSpecification } from "maplibre-gl";

import { capasLimites } from "../limites.ts";
import type { ColorDeToken } from "../tokens.ts";

/**
 * Los límites del mapa base de reserva (ADR 0023): las mismas capas que el principal
 * (`capasLimites`). La frontera de España, las comunidades y las provincias salen del fichero
 * propio de Celda, que la web pone igual con la reserva; los municipios, que el principal toma de
 * OpenMapTiles, salen de `linea_limite_lin` del IGN, con el mismo aspecto.
 */

/**
 * La clase del IGN que da cada capa de límites que el principal saca del mapa base. Las fronteras
 * entre otros países (`limites-paises`) no tienen equivalente: el IGN solo da las de España, que
 * ya salen del fichero propio.
 */
const DEL_IGN: ReadonlyMap<string, string> = new Map([["limites-municipios", "limite_municipal"]]);

export const capasLimitesDeReserva = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<LayerSpecification> =>
  capasLimites(fuente, color).flatMap((capa): ReadonlyArray<LayerSpecification> => {
    if (capa.type !== "line" || capa.source !== fuente) return [capa];
    const clase = DEL_IGN.get(capa.id);
    if (clase === undefined) return [];
    const filtro: FilterSpecification = ["==", ["get", "clase"], clase];
    return [{ ...capa, "source-layer": "linea_limite_lin", filter: filtro }];
  });
