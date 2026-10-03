import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

import { IdentidadNoValida, Vetada } from "../confect/buzon.spec";
import { DatabaseReader, MutationCtx } from "../confect/_generated/services";
import { hmac, igualesSinFuga } from "./claves";

/**
 * La identidad anónima del dispositivo (ADR 0020) es un token firmado que crea el buzón: el `_id`
 * de su fila en `identidades` y el HMAC de ese `_id` con la clave del buzón, separados por un
 * punto. Sin la clave no se puede inventar uno, y el buzón no guarda el token: lo vuelve a firmar
 * para comprobarlo.
 */

const firma = (clave: Redacted.Redacted<string>, id: string) => hmac(clave, `identidad:${id}`);

/** El token de una identidad recién creada. */
export const tokenDe = Effect.fn("Identidad.tokenDe")(function* (
  clave: Redacted.Redacted<string>,
  id: string,
) {
  return `${id}.${yield* firma(clave, id)}`;
});

/** La identidad de un token, si su firma cuadra y la identidad sigue existiendo. */
export const identidadDelToken = Effect.fn("Identidad.identidadDelToken")(function* (
  clave: Redacted.Redacted<string>,
  token: string,
) {
  const ctx = yield* MutationCtx;
  const reader = yield* DatabaseReader;
  const [texto, firmaRecibida, ...resto] = token.split(".");
  if (texto === undefined || firmaRecibida === undefined || resto.length > 0) {
    return yield* new IdentidadNoValida();
  }
  if (!igualesSinFuga(yield* firma(clave, texto), firmaRecibida)) {
    return yield* new IdentidadNoValida();
  }
  const id = ctx.db.normalizeId("identidades", texto);
  if (id === null) return yield* new IdentidadNoValida();
  return yield* reader
    .table("identidades")
    .get(id)
    .pipe(Effect.catch(() => Effect.fail(new IdentidadNoValida())));
});

/** Falla con `Vetada` si la moderación ha vetado esa identidad o esa huella de IP. */
export const comprobarVetos = Effect.fn("Identidad.comprobarVetos")(function* (vetables: {
  readonly identidad?: string;
  readonly huellaIp: string;
}) {
  const reader = yield* DatabaseReader;
  const vetado = (tipo: "identidad" | "ip", valor: string) =>
    Effect.map(
      reader
        .table("vetos")
        .index("por_valor", (q) => q.eq("tipo", tipo).eq("valor", valor))
        .first(),
      Option.isSome,
    );
  if (vetables.identidad !== undefined && (yield* vetado("identidad", vetables.identidad))) {
    return yield* new Vetada({ que: "identidad" });
  }
  if (yield* vetado("ip", vetables.huellaIp)) return yield* new Vetada({ que: "ip" });
});
