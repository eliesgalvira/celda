import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import type { BandasPorCompania } from "@celda/dominio/ejercicio";
import type { Ficha } from "@celda/dominio/ficha";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { type FichaPedida, FichasPublicadas } from "../ficha/servicio.ts";

/** Cuántas fichas se leen a la vez. Las vecinas van en el mismo lote, que se pide una vez. */
const A_LA_VEZ = 3;

/** Lo que tarda como mucho una ficha; si no llega, cuenta como no leída. */
const ESPERA = "10 seconds";

/** Las bandas de cada compañía en una ficha, como las necesita el ejercicio. */
export const bandasDeFicha = (ficha: Ficha): BandasPorCompania =>
  Object.fromEntries(
    ficha.estaciones.map((estacion) => [estacion.compania, estacion.bandas.map((b) => b.mhz)]),
  );

/** Las compañías de una ficha cuya estación base no tiene ficha en el registro. */
export const sinFichaEnRegistroDe = (ficha: Ficha): ReadonlyArray<Compania> =>
  ficha.estaciones
    .filter((estacion) => estacion.sinFichaEnRegistro !== undefined && estacion.bandas.length === 0)
    .map((estacion) => estacion.compania);

/** Las bandas que trae la capa del mapa para un emplazamiento: solo las conocidas. */
export const bandasDeEmplazamiento = (emplazamiento: EmplazamientoDeCapa): BandasPorCompania =>
  Object.fromEntries((emplazamiento.bandas ?? []).map((b) => [b.compania, b.mhz]));

export interface BandasLeidas {
  readonly bandas: ReadonlyMap<string, BandasPorCompania>;
  /** Por clave, las compañías cuya estación base no tiene ficha en el registro. */
  readonly sinFichaEnRegistro: ReadonlyMap<string, ReadonlyArray<Compania>>;
  /** Claves cuya ficha no ha llegado o ya no existe. */
  readonly fallidas: ReadonlyArray<string>;
}

/**
 * Lee una vez la ficha de cada emplazamiento, de pocas en pocas, y se queda con sus bandas. Una
 * ficha que falla, tarda demasiado o ya no existe no para las demás: se cuenta como no leída.
 */
export const leerBandas = (
  pedidas: ReadonlyArray<FichaPedida>,
): Effect.Effect<BandasLeidas, never, FichasPublicadas> =>
  Effect.gen(function* () {
    const fichas = yield* FichasPublicadas;
    const leidas = yield* Effect.forEach(
      pedidas,
      ({ clave, provincia }) =>
        fichas.leer({ clave, provincia }).pipe(
          Effect.timeoutOption(ESPERA),
          Effect.map((salida) => ({ clave, ficha: Option.flatten(salida) })),
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
      sinFichaEnRegistro: new Map(
        leidas.flatMap(({ clave, ficha }) => {
          const companias = Option.isSome(ficha) ? sinFichaEnRegistroDe(ficha.value) : [];
          return companias.length === 0 ? [] : [[clave, companias] as const];
        }),
      ),
      fallidas: leidas.flatMap(({ clave, ficha }) => (Option.isNone(ficha) ? [clave] : [])),
    };
  });
