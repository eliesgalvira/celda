import { DAY, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter";
import type { GenericMutationCtx, GenericDataModel } from "convex/server";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import { components } from "../confect/_generated/components";
import { type AmbitoDeLimite, LimiteAlcanzado } from "../confect/buzon.spec";

/**
 * Los límites del buzón, en cubos de fichas (ADR 0020). Un cubo empieza lleno con `capacity`
 * fichas, cada envío gasta una y se rellena a `rate` por `period`. Sin `capacity`, la ráfaga es la
 * tasa entera.
 *
 * Los de IP son flojos a propósito: con CGNAT en las redes móviles, o en eduroam, muchas personas
 * salen por la misma IP. Su clave es la huella de la IP, que cambia cada día, así que también
 * empiezan llenos cada día. Ninguno va repartido en fragmentos: con el tráfico que se espera no
 * hay conflictos en el documento de un cubo, y así cada límite corta en su número exacto.
 */
export const LIMITES = {
  correccionesPorDispositivo: { kind: "token bucket", rate: 10, period: DAY, capacity: 3 },
  correccionesPorIp: { kind: "token bucket", rate: 50, period: DAY },
  correccionesEnTotal: { kind: "token bucket", rate: 300, period: DAY },
  corroboracionesPorDispositivo: { kind: "token bucket", rate: 50, period: DAY },
  corroboracionesPorIp: { kind: "token bucket", rate: 200, period: DAY },
  identidadesPorIp: { kind: "token bucket", rate: 100, period: DAY },
} as const satisfies Record<string, RateLimitConfig>;

export type NombreDeLimite = keyof typeof LIMITES;

/** Los límites cuya clave es la huella de una IP: la limpieza los borra con ella. */
export const LIMITES_POR_IP: ReadonlyArray<NombreDeLimite> = [
  "correccionesPorIp",
  "corroboracionesPorIp",
  "identidadesPorIp",
];

export const limitador = new RateLimiter(components.rateLimiter, LIMITES);

/** Lo más que se suma a la espera de un límite del buzón entero, para repartir los reintentos. */
export const DISPERSION_MAXIMA_MS = 30_000;

type ContextoDeMutacion = GenericMutationCtx<GenericDataModel>;

/**
 * Gasta una ficha del límite, o falla con `LimiteAlcanzado` y cuánto esperar. Si la mutación
 * falla después, Convex deshace también lo gastado: un envío rechazado no gasta ninguna ficha.
 */
export const gastar = Effect.fn("Limites.gastar")(function* (
  ctx: ContextoDeMutacion,
  limite: NombreDeLimite,
  ambito: AmbitoDeLimite,
  clave?: string,
) {
  const estado = yield* Effect.promise(() =>
    limitador.limit(ctx, limite, clave === undefined ? {} : { key: clave }),
  );
  if (estado.ok) return;
  const dispersion = ambito === "total" ? yield* Random.nextIntBetween(0, DISPERSION_MAXIMA_MS) : 0;
  return yield* new LimiteAlcanzado({
    limite,
    ambito,
    reintentarEn: Math.ceil(estado.retryAfter) + dispersion,
  });
});

/** Vacía los cubos por IP de una huella: la limpieza lo hace al borrarla. */
export const olvidarHuella = Effect.fn("Limites.olvidarHuella")(function* (
  ctx: ContextoDeMutacion,
  huella: string,
) {
  yield* Effect.forEach(
    LIMITES_POR_IP,
    (limite) => Effect.promise(() => limitador.reset(ctx, limite, { key: huella })),
    { discard: true },
  );
});
