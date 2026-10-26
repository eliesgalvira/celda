import { assert, describe, it } from "@effect/vitest";

import {
  CODIGO_ANDROID_GENERAL,
  CODIGO_IPHONE,
  CODIGOS_POR_MARCA,
  MarcaAndroid,
} from "./modoInformacion.ts";

describe("códigos del modo de información", () => {
  it("cada marca Android tiene su código", () => {
    for (const marca of MarcaAndroid.literals) {
      assert.strictEqual(CODIGOS_POR_MARCA[marca].sistema, "android", marca);
    }
  });

  it("un código que no sale del código fuente de Android ni se ha probado queda sin verificar", () => {
    // Solo el código general tiene fuente primaria: ni los fabricantes ni Apple los publican.
    assert.strictEqual(CODIGO_ANDROID_GENERAL.comprobacion, "fuente-primaria");
    for (const codigo of [CODIGO_IPHONE, ...Object.values(CODIGOS_POR_MARCA)]) {
      assert.notStrictEqual(codigo.comprobacion, "fuente-primaria", codigo.codigo);
    }
  });

  it("Samsung y el iPhone tienen códigos propios; el resto usa el de Android", () => {
    assert.strictEqual(CODIGOS_POR_MARCA.samsung.codigo, "*#0011#");
    assert.strictEqual(CODIGO_IPHONE.codigo, "*3001#12345#*");
    assert.strictEqual(CODIGO_IPHONE.seAbre, "llamar");
    assert.strictEqual(CODIGOS_POR_MARCA.xiaomi.codigo, "*#*#4636#*#*");
  });
});
