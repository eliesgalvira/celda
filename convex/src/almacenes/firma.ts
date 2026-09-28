import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** La API Web Crypto ha fallado al calcular un resumen o una firma. */
export class FirmaFallida extends Schema.TaggedError<FirmaFallida>()("FirmaFallida", {
  motivo: Schema.String,
}) {}

const codificador = new TextEncoder();
const bytes = (texto: string): Uint8Array<ArrayBuffer> => new Uint8Array(codificador.encode(texto));

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

const cripto = <A>(operacion: string, promesa: () => Promise<A>) =>
  Effect.tryPromise({
    try: promesa,
    catch: (causa) => new FirmaFallida({ motivo: `${operacion}: ${String(causa)}` }),
  });

/** SHA-256 en hexadecimal, como lo piden las cabeceras de S3. */
export const sha256 = (datos: string) =>
  Effect.map(
    cripto("sha256", () => globalThis.crypto.subtle.digest("SHA-256", bytes(datos))),
    hex,
  );

const hmac = (clave: ArrayBuffer | Uint8Array<ArrayBuffer>, datos: string) =>
  cripto("hmac", async () => {
    const importada = await globalThis.crypto.subtle.importKey(
      "raw",
      clave,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return globalThis.crypto.subtle.sign("HMAC", importada, bytes(datos));
  });

/**
 * Codifica una ruta como la espera AWS en la petición canónica: todo menos las letras, los
 * dígitos, `-_.~` y las barras. Así una clave como `sitios@2026-09-26T02:15:03Z.json` va con
 * `%40` y `%3A`, y la URL de la petición tiene que ir igual.
 */
export const codificarRuta = (ruta: string): string =>
  ruta
    .split("/")
    .map((trozo) =>
      encodeURIComponent(trozo).replace(
        /[!'()*]/gu,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");

export interface PeticionAFirmar {
  readonly metodo: string;
  /** Ruta ya codificada con `codificarRuta`. */
  readonly ruta: string;
  /** Cabeceras que entran en la firma, con `host` y `x-amz-date`. */
  readonly cabeceras: Readonly<Record<string, string>>;
  /** SHA-256 del cuerpo en hexadecimal. */
  readonly hashCuerpo: string;
}

export interface Credenciales {
  readonly idClave: string;
  readonly secreto: string;
  readonly region: string;
  readonly servicio: string;
}

/**
 * La cabecera `Authorization` de AWS Signature Version 4 para una petición sin parámetros de
 * consulta, que es lo único que pide el almacén. La fecha sale de la cabecera `x-amz-date`.
 */
export const firmarV4 = Effect.fn("Firma.v4")(function* (
  peticion: PeticionAFirmar,
  credenciales: Credenciales,
) {
  const cabeceras = Object.entries(peticion.cabeceras)
    .map(([nombre, valor]) => [nombre.toLowerCase(), valor.trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const firmadas = cabeceras.map(([nombre]) => nombre).join(";");
  const fechaHora = cabeceras.find(([nombre]) => nombre === "x-amz-date")?.[1] ?? "";
  const dia = fechaHora.slice(0, 8);
  const ambito = `${dia}/${credenciales.region}/${credenciales.servicio}/aws4_request`;
  const canonica = [
    peticion.metodo,
    peticion.ruta,
    "",
    ...cabeceras.map(([nombre, valor]) => `${nombre}:${valor}`),
    "",
    firmadas,
    peticion.hashCuerpo,
  ].join("\n");
  const aFirmar = ["AWS4-HMAC-SHA256", fechaHora, ambito, yield* sha256(canonica)].join("\n");
  let clave = yield* hmac(bytes(`AWS4${credenciales.secreto}`), dia);
  for (const parte of [credenciales.region, credenciales.servicio, "aws4_request"]) {
    clave = yield* hmac(clave, parte);
  }
  const firma = hex(yield* hmac(clave, aFirmar));
  return `AWS4-HMAC-SHA256 Credential=${credenciales.idClave}/${ambito}, SignedHeaders=${firmadas}, Signature=${firma}`;
});
