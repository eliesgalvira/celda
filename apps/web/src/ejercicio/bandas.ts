import type { BandasPorCompania } from "@celda/dominio/ejercicio";
import type { Ficha } from "@celda/dominio/ficha";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { FichasEnVivo } from "../ficha/servicio.ts";

/** Cuántas fichas se leen a la vez: pocas, para no cargar el backend. */
const A_LA_VEZ = 3;

/** Lo que tarda como mucho una ficha; si no llega, cuenta como no leída. */
const ESPERA = "10 seconds";

/** Las bandas de cada compañía en una ficha, como las necesita el ejercicio. */
export const bandasDeFicha = (ficha: Ficha): BandasPorCompania =>
  Object.fromEntries(
    ficha.estaciones.map((estacion) => [estacion.compania, estacion.bandas.map((b) => b.mhz)]),
  );

export interface BandasLeidas {
  readonly bandas: ReadonlyMap<string, BandasPorCompania>;
  /** Claves cuya ficha no ha llegado o ya no existe. */
  readonly fallidas: ReadonlyArray<string>;
}

/**
 * Lee una vez la ficha de cada emplazamiento, de pocas en pocas, y se queda con sus bandas. Una
 * ficha que falla, tarda demasiado o ya no existe no para las demás: se cuenta como no leída.
 */
export const leerBandas = (
  claves: ReadonlyArray<string>,
): Effect.Effect<BandasLeidas, never, FichasEnVivo> =>
  Effect.gen(function* () {
    const fichas = yield* FichasEnVivo;
    const leidas = yield* Effect.forEach(
      claves,
      (clave) =>
        Stream.runHead(fichas.seguir(clave)).pipe(
          Effect.timeoutOption(ESPERA),
          Effect.map((salida) => ({ clave, ficha: Option.flatten(Option.flatten(salida)) })),
          Effect.catchTag("FichaNoLeida", () =>
            Effect.succeed({ clave, ficha: Option.none<Ficha>() }),
          ),
        ),
      { concurrency: A_LA_VEZ },
    );
    return {
      bandas: new Map(
        leidas.flatMap(({ clave, ficha }) =>
          Option.isSome(ficha) ? [[clave, bandasDeFicha(ficha.value)] as const] : [],
        ),
      ),
      fallidas: leidas.flatMap(({ clave, ficha }) => (Option.isNone(ficha) ? [clave] : [])),
    };
  });
