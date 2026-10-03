import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Redacted from "effect/Redacted";

import { BuzonCerrado } from "../confect/buzon.spec";

/**
 * La clave secreta del buzón, de la variable de entorno `CELDA_BUZON_CLAVE` del despliegue. Firma
 * los tokens de identidad y calcula las huellas de IP. Sin ella, o si es corta, el buzón está
 * cerrado: quitarla del despliegue es la forma de cerrarlo sin tocar el código.
 */
export const VARIABLE_CLAVE = "CELDA_BUZON_CLAVE";

/** El largo mínimo de la clave: 32 caracteres, como los 32 bytes en base64url de `openssl rand`. */
export const LARGO_MINIMO_CLAVE = 32;

export const claveDelBuzon = Config.Redacted(VARIABLE_CLAVE).pipe(
  Effect.flatMap((clave) =>
    Redacted.value(clave).length >= LARGO_MINIMO_CLAVE
      ? Effect.succeed(clave)
      : Effect.fail(new BuzonCerrado()),
  ),
  Effect.catchTag("ConfigError", () => Effect.fail(new BuzonCerrado())),
  Effect.withSpan("Claves.claveDelBuzon"),
);

const codificador = new TextEncoder();

/**
 * HMAC-SHA-256 de `mensaje` con la clave del buzón, en base64url. Cada uso lleva su prefijo en el
 * mensaje («identidad:», «ip:»), así que una firma de un uso no vale para el otro.
 */
export const hmac = Effect.fn("Claves.hmac")(function* (
  clave: Redacted.Redacted<string>,
  mensaje: string,
) {
  const firma = yield* Effect.promise(async () => {
    const llave = await crypto.subtle.importKey(
      "raw",
      codificador.encode(Redacted.value(clave)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", llave, codificador.encode(mensaje));
  });
  return Encoding.encodeBase64Url(new Uint8Array(firma));
});

/** Compara dos textos sin que el tiempo diga dónde está la primera diferencia. */
export const igualesSinFuga = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
};
