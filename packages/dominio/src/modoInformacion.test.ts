import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CODIGO_ANDROID_GENERAL,
  CODIGO_IPHONE,
  CodigoModoInformacion,
  CODIGOS_POR_MARCA,
  MarcaAndroid,
} from "./modoInformacion.ts";

const leerCodigo = Schema.decodeUnknownEffect(CodigoModoInformacion);

const TODOS = [CODIGO_ANDROID_GENERAL, CODIGO_IPHONE, ...Object.values(CODIGOS_POR_MARCA)];

describe("códigos del modo de información", () => {
  it("cada marca Android tiene su código", () => {
    for (const marca of MarcaAndroid.literals) {
      assert.strictEqual(CODIGOS_POR_MARCA[marca].sistema, "android", marca);
    }
  });

  it.effect("cada código es válido y cita al menos una fuente pública con su fecha", () =>
    Effect.gen(function* () {
      for (const codigo of TODOS) {
        yield* leerCodigo(codigo);
        assert.isNotEmpty(codigo.fuentes, codigo.codigo);
        for (const fuente of codigo.fuentes) {
          assert.match(fuente.url, /^https:\/\//u);
          assert.match(fuente.consultada, /^\d{4}-\d{2}-\d{2}$/u);
        }
      }
    }),
  );

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
