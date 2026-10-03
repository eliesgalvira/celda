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
