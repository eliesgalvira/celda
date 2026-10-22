import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

/** El servicio `Crypto` de Effect con la API Web Crypto del navegador. */
export const criptoDelNavegador: Layer.Layer<Crypto.Crypto> = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (tamano) => globalThis.crypto.getRandomValues(new Uint8Array(tamano)),
    digest: (algoritmo, datos) =>
      Effect.tryPromise({
        try: () => globalThis.crypto.subtle.digest(algoritmo, new Uint8Array(datos)),
        catch: (causa) =>
          PlatformError.systemError({
            _tag: "Unknown",
            module: "Crypto",
            method: "digest",
            cause: causa,
          }),
      }).pipe(Effect.map((resumen) => new Uint8Array(resumen))),
  }),
);

/**
 * Un `Crypto` de prueba con bytes que no se repiten y se pueden prever: el primer UUID que da es
 * `00000001-0000-4000-8000-000000000000` y el segundo empieza por `00000002`.
 */
const criptoContador = (): Crypto.Crypto => {
  let llamadas = 0;
  return Crypto.make({
    randomBytes: (tamano) => {
      llamadas += 1;
      const bytes = new Uint8Array(tamano);
      new DataView(bytes.buffer).setUint32(0, llamadas);
      return bytes;
    },
    digest: (_algoritmo, datos) => Effect.succeed(datos),
  });
};

/** `criptoContador` como capa: cada vez que se construye, empieza a contar desde cero. */
export const criptoDePrueba: Layer.Layer<Crypto.Crypto> = Layer.sync(Crypto.Crypto, criptoContador);
