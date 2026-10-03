import type { AportacionCompartible } from "@celda/dominio/aportacion";
import * as Effect from "effect/Effect";

import { enOtraTarea } from "../lib/pruebas.ts";
import type { BuzonRemoto, FalloDelBuzon, IdentidadCaducada } from "./sincronizacion.ts";

export interface BuzonDePrueba {
  readonly remoto: BuzonRemoto;
  /** Las aportaciones que ha recibido, una por identificador, en el orden en que llegaron. */
  readonly recibidas: () => ReadonlyArray<AportacionCompartible>;
  /** Cuántas llamadas le han llegado, contando las rechazadas: cada una gastaría del plan. */
  readonly llamadas: () => number;
  /** Cuántas identidades ha dado. */
  readonly identidades: () => number;
  /** Desde ahora rechaza cada envío con `fallo`, o vuelve a recibir con `undefined`. */
  readonly fallar: (fallo: FalloDelBuzon | IdentidadCaducada | undefined) => void;
}

/**
 * Un buzón en memoria que recibe todo, como el de Convex con sus límites sin gastar. Como la red,
 * contesta en otra tarea, y como el de verdad, una aportación repetida no se guarda dos veces.
 */
export const buzonDePrueba = (): BuzonDePrueba => {
  const recibidas = new Map<string, AportacionCompartible>();
  let llamadas = 0;
  let identidades = 0;
  let fallo: FalloDelBuzon | IdentidadCaducada | undefined;
  const contar = Effect.andThen(
    Effect.sync(() => {
      llamadas += 1;
    }),
    enOtraTarea,
  );
  return {
    remoto: {
      pedirIdentidad: Effect.andThen(
        contar,
        Effect.sync(() => {
          identidades += 1;
          return `identidad-${identidades}.firma`;
        }),
      ),
      enviar: (_identidad, aportacion) =>
        Effect.andThen(
          contar,
          Effect.suspend(() => {
            if (fallo !== undefined) return Effect.fail(fallo);
            const nueva = !recibidas.has(aportacion.id);
            recibidas.set(aportacion.id, aportacion);
            return Effect.succeed({ nueva });
          }),
        ),
    },
    recibidas: () => [...recibidas.values()],
    llamadas: () => llamadas,
    identidades: () => identidades,
    fallar: (nuevo) => {
      fallo = nuevo;
    },
  };
};
