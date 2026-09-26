import type { FuenteDeBarrios, LimitesDeBarrios } from "@celda/dominio/barrio";
import type { CapaLeida } from "@celda/dominio/capa";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { CapaEmplazamientos, type FalloCapa } from "./servicio.ts";

/** La fuente de los límites de barrio, como la publica Open Data BCN. */
export const FUENTE_DE_BARRIOS: FuenteDeBarrios = {
  atribucion: "Ajuntament de Barcelona",
  licencia: "CC BY 4.0",
  enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
  fecha: "2024-11-12",
};

/** Un solo barrio, Pedralbes, dibujado como un rectángulo alrededor del Campus Nord. */
export const LIMITES_DE_PRUEBA: LimitesDeBarrios = {
  fuente: FUENTE_DE_BARRIOS,
  barrios: [
    {
      codigo: "21",
      nombre: "Pedralbes",
      etiqueta: { longitud: 2.11, latitud: 41.39 },
      poligonos: [
        [
          [
            [2.1, 41.385],
            [2.12, 41.385],
            [2.12, 41.395],
            [2.1, 41.395],
          ],
        ],
      ],
    },
  ],
};

/**
 * Servicio de capa de prueba: la carga número `n` devuelve `cargas[n]`, y a partir de la última
 * repite esa. Con `Effect.never` la carga no termina nunca.
 */
export const capaDePrueba = (
  cargas: ReadonlyArray<Effect.Effect<CapaLeida, FalloCapa>>,
): Layer.Layer<CapaEmplazamientos> =>
  Layer.effect(
    CapaEmplazamientos,
    Effect.gen(function* () {
      const hechas = yield* Ref.make(0);
      return CapaEmplazamientos.of({
        cargar: Effect.flatMap(
          Ref.getAndUpdate(hechas, (n) => n + 1),
          (n) => cargas[Math.min(n, cargas.length - 1)] ?? Effect.never,
        ),
      });
    }),
  );
