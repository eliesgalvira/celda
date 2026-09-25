import { assert, describe, it } from "@effect/vitest";

import { decodificarLatin1, repararTexto, textoDeHtml } from "./texto.ts";

describe("texto de la fuente", () => {
  it("decodifica Latin-1 byte a byte", () => {
    assert.strictEqual(
      decodificarLatin1(Uint8Array.of(0x45, 0x53, 0x50, 0x41, 0xd1, 0x41)),
      "ESPAÑA",
    );
  });

  it("repara las direcciones sucias de la descarga real", () => {
    assert.deepStrictEqual(
      [
        "VP Eusebi G³ell, 6. BARCELONA, BARCELONA",
        "CL COMTE D`URGELL, 143. BARCELONA, BARCELONA",
        "CL VALL D´ARAN, 17. PRAT DE LLOBREGAT (EL), BARCELONA",
        "CL GRAN_VIA, 115.  HOSPITALET DE LLOBREGAT (L), BARCELONA ",
        "AV DEL PARAL·LEL, 141. BARCELONA, BARCELONA",
      ].map(repararTexto),
      [
        "VP Eusebi Güell, 6. BARCELONA, BARCELONA",
        "CL COMTE D'URGELL, 143. BARCELONA, BARCELONA",
        "CL VALL D'ARAN, 17. PRAT DE LLOBREGAT (EL), BARCELONA",
        "CL GRAN VIA, 115. HOSPITALET DE LLOBREGAT (L), BARCELONA",
        "AV DEL PARAL·LEL, 141. BARCELONA, BARCELONA",
      ],
    );
  });

  it("saca el texto visible del HTML de la ficha", () => {
    assert.strictEqual(
      textoDeHtml("<p>C&oacute;digo &#8211; <b>Espa&ntilde;a</b> &desconocida;</p>"),
      "Código – España &desconocida;",
    );
  });
});
