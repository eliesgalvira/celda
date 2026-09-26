import type { CapaLeida } from "@celda/dominio/capa";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { CapaEmplazamientos, type FalloCapa } from "./servicio.ts";

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
