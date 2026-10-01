import { assert, describe, it } from "@effect/vitest";

import { esperaPedida, motivoDeFallo } from "./cliente.ts";

/** Un fallo de la conexión como lo da Node: un `Error` con su código de OpenSSL o del sistema. */
const falloDeNode = (mensaje: string, code: string) => Object.assign(new Error(mensaje), { code });

describe("motivoDeFallo", () => {
  it("dice que el certificado no se pudo verificar y por qué, sin el consejo de Node", () => {
    // Así llegó la primera noche en el portátil: `fetch` envuelve el fallo de la conexión.
    const fallo = new TypeError("fetch failed", {
      cause: falloDeNode(
        "unable to get local issuer certificate; if the root CA is installed locally, try running Node.js with --use-system-ca",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      ),
    });
    assert.strictEqual(
      motivoDeFallo("TransportError", fallo),
      "TransportError: el certificado del servidor no se pudo verificar, falta el certificado de su emisor (UNABLE_TO_GET_ISSUER_CERT_LOCALLY: unable to get local issuer certificate)",
    );
  });

  it("da el código y el mensaje de otros fallos de la conexión", () => {
    const fallo = new TypeError("fetch failed", {
      cause: falloDeNode("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"),
    });
    assert.strictEqual(
      motivoDeFallo("TransportError", fallo),
      "TransportError: ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:443",
    );
  });

  it("recorta los mensajes largos a una línea", () => {
    const motivo = motivoDeFallo("TransportError", new Error(`primera\n${"x".repeat(1000)}`));
    assert.notInclude(motivo, "\n");
    assert.isBelow(motivo.length, 200);
  });

  it("sin causa, deja el tipo de fallo", () => {
    assert.strictEqual(motivoDeFallo("TransportError", undefined), "TransportError");
  });
});

describe("esperaPedida", () => {
  const AHORA = Date.UTC(2026, 9, 1, 2, 0, 0);

  it("lee los segundos de `Retry-After`", () => {
    assert.strictEqual(esperaPedida("120", AHORA), 120_000);
    assert.strictEqual(esperaPedida(" 0 ", AHORA), 0);
  });

  it("lee una fecha HTTP y cuenta desde ahora, sin bajar de cero", () => {
    assert.strictEqual(esperaPedida("Thu, 01 Oct 2026 02:00:30 GMT", AHORA), 30_000);
    assert.strictEqual(esperaPedida("Thu, 01 Oct 2026 01:00:00 GMT", AHORA), 0);
  });

  it("sin cabecera o con algo que no se entiende, no sabe cuánto", () => {
    assert.isUndefined(esperaPedida(undefined, AHORA));
    assert.isUndefined(esperaPedida("", AHORA));
    assert.isUndefined(esperaPedida("pronto", AHORA));
  });
});
