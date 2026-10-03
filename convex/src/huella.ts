import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

import { DatabaseReader, DatabaseWriter, MutationCtx } from "../confect/_generated/services";
import { hmac } from "./claves";

/**
 * La huella de la IP: el HMAC de la IP con la clave del buzón y la sal del día (ADR 0020). La IP
 * no se guarda nunca; la huella, como mucho 24 horas, y con la sal de otro día la misma IP da
 * otra huella. Así los límites y los vetos por IP funcionan durante el día sin poder seguir a
 * nadie de un día a otro.
 */

/** Lo que dura una huella desde que se ve por primera vez. */
export const VIDA_DE_UNA_HUELLA_MS = 24 * 60 * 60 * 1000;

/** El día UTC de una hora, como «2026-10-03»: el de la sal que le toca. */
export const diaUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** La sal de hoy, o una nueva si es la primera petición del día. */
const salDelDia = Effect.fn("Huella.salDelDia")(function* (ahora: number) {
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const dia = diaUtc(ahora);
  const guardada = yield* reader
    .table("salesDeIp")
    .index("por_dia", (q) => q.eq("dia", dia))
    .first();
  if (Option.isSome(guardada)) return guardada.value.sal;
  const sal = Encoding.encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  yield* writer.table("salesDeIp").insert({ dia, sal });
  return sal;
});

/**
 * La huella de la IP de la petición, que Convex da con `ctx.meta.getRequestMetadata()`. Sin IP
 * (una llamada sin red de por medio, como las de las pruebas sin IP), todas comparten la huella
 * de «desconocida».
 */
export const huellaDeLaPeticion = Effect.fn("Huella.huellaDeLaPeticion")(function* (
  clave: Redacted.Redacted<string>,
) {
  const ctx = yield* MutationCtx;
  const ahora = yield* Clock.currentTimeMillis;
  const { ip } = yield* Effect.promise(() => ctx.meta.getRequestMetadata());
  const sal = yield* salDelDia(ahora);
  return yield* hmac(clave, `ip:${sal}:${ip ?? "desconocida"}`);
});

/** Apunta la huella con la hora en que se vio por primera vez, para borrarla a las 24 horas. */
export const apuntarHuella = Effect.fn("Huella.apuntarHuella")(function* (huella: string) {
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const vista = yield* reader
    .table("huellasDeIp")
    .index("por_huella", (q) => q.eq("huella", huella))
    .first();
  if (Option.isNone(vista)) {
    yield* writer.table("huellasDeIp").insert({ huella, vistaEl: yield* Clock.currentTimeMillis });
  }
});
