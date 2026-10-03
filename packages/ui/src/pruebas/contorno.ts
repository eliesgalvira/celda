import type { Contorno } from "@celda/dominio/comunitatValenciana";

import type { ContornoDeEspana } from "../mapa/rotulos.ts";

/** Un contorno de España de prueba: un rectángulo alrededor de la península. */
export const CONTORNO_DE_PRUEBA: ContornoDeEspana = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-9.5, 36],
        [3.4, 36],
        [3.4, 43.8],
        [-9.5, 43.8],
        [-9.5, 36],
      ],
    ],
  ],
};

/** Un contorno de la Comunitat Valenciana de prueba: un rectángulo alrededor de València. */
export const COMUNITAT_DE_PRUEBA: Contorno = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-1.5, 37.8],
        [0.6, 37.8],
        [0.6, 40.8],
        [-1.5, 40.8],
        [-1.5, 37.8],
      ],
    ],
  ],
};
