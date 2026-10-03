import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { igualesSinFuga, LARGO_MINIMO_CLAVE } from "./claves";

/**
 * La clave de la publicación nocturna, de la variable de entorno `CELDA_PUBLICACION_CLAVE` del
 * despliegue (ADR 0020, #57). Solo abre la acción HTTP que da lo aceptado para publicar: no
 * despliega nada, no llama a ninguna otra función y no ve identidades, huellas ni pendientes. Sin
 * ella, o si es corta, esa acción no contesta a nadie.
 */
export const VARIABLE_CLAVE_DE_PUBLICACION = "CELDA_PUBLICACION_CLAVE";

const codificador = new TextEncoder();

/** SHA-256 de un texto, en base64url: siempre del mismo largo, sea cual sea el texto. */
const resumen = (texto: string) =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", codificador.encode(texto))),
    (bytes) => Encoding.encodeBase64Url(new Uint8Array(bytes)),
  );

/**
 * Si la cabecera `Authorization` lleva la clave de publicación del despliegue como `Bearer`. Se
 * comparan sus SHA-256, sin que el tiempo diga cuánto se parecen ni cuánto miden. Sin la variable,
 * o si es corta, nada pasa.
 */
export const autorizadaParaPublicar = Effect.fn("Publicacion.autorizada")(function* (
  cabecera: string | undefined,
) {
  const clave = yield* Config.option(Config.Redacted(VARIABLE_CLAVE_DE_PUBLICACION)).pipe(
    Effect.orElseSucceed(() => Option.none<Redacted.Redacted<string>>()),
  );
  const presentada =
    cabecera?.startsWith("Bearer ") === true ? cabecera.slice("Bearer ".length) : "";
  const esperada = Option.match(clave, { onNone: () => "", onSome: Redacted.value });
  const [a, b] = yield* Effect.all([resumen(presentada), resumen(esperada)]);
  return esperada.length >= LARGO_MINIMO_CLAVE && igualesSinFuga(a, b);
});
