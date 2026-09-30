// El certificado se comprueba con la criptografía y las raíces de Node, que Effect no tiene.
// @effect-diagnostics nodeBuiltinImport:off
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as NodeCrypto from "node:crypto";
import * as NodeTls from "node:tls";

import { HUELLA_INTERMEDIO_FNMT, INTERMEDIO_FNMT, RAIZ_FNMT } from "./intermedio.ts";

const intermedio = new NodeCrypto.X509Certificate(INTERMEDIO_FNMT);

/** Días de margen: la prueba falla cuando el intermedio caduca antes de esto. */
const AVISO_DE_CADUCIDAD = 90;

describe("el intermedio de la FNMT", () => {
  it("es el que se descargó, con su huella", () => {
    assert.strictEqual(intermedio.fingerprint256, HUELLA_INTERMEDIO_FNMT);
    assert.strictEqual(intermedio.subject, "C=ES\nO=FNMT-RCM\nOU=AC Componentes Informáticos");
  });

  it("es una autoridad intermedia, no una raíz", () => {
    assert.isTrue(intermedio.ca);
    assert.strictEqual(intermedio.issuer, RAIZ_FNMT);
    assert.notStrictEqual(intermedio.issuer, intermedio.subject);
  });

  it("lo firma «AC RAIZ FNMT-RCM», que está entre las raíces de Node", () => {
    const raiz = NodeTls.rootCertificates
      .map((pem) => new NodeCrypto.X509Certificate(pem))
      .find((certificado) => certificado.subject === RAIZ_FNMT);
    if (raiz === undefined) return assert.fail("AC RAIZ FNMT-RCM no está entre las raíces de Node");
    assert.isTrue(intermedio.checkIssued(raiz));
    assert.isTrue(intermedio.verify(raiz.publicKey));
  });

  it.live(`no caduca en los próximos ${AVISO_DE_CADUCIDAD} días`, () =>
    Effect.gen(function* () {
      const limite = (yield* Clock.currentTimeMillis) + AVISO_DE_CADUCIDAD * 86_400_000;
      assert.isAbove(
        Date.parse(intermedio.validTo),
        limite,
        `El intermedio de la FNMT caduca el ${intermedio.validTo}. Descarga el nuevo y cámbialo (docs/investigacion/registro-oficial.md, «Certificado del geoportal»).`,
      );
    }),
  );
});
