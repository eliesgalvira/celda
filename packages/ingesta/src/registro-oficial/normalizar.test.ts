// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { leerMuestra, muestraCampusNord } from "../pruebas/grabado.ts";
import { decodificarLatin1 } from "../texto.ts";
import {
  bandasDeFicha,
  companiaDeTitular,
  esFichaSinEmplazamiento,
  listadoDeElementos,
  municipioDeDireccion,
} from "./normalizar.ts";

const conMuestras = Effect.provide(NodeServices.layer);

describe("listado del registro oficial", () => {
  it.effect("lee los 40 registros de Campus Nord con su compañía", () =>
    Effect.gen(function* () {
      const { listado } = yield* muestraCampusNord;
      assert.strictEqual(listado.registros.length, 40);
      assert.deepStrictEqual(listado.avisos, []);
      const cuantos = (compania: string) =>
        listado.registros.filter((r) => r.compania === compania).length;
      assert.strictEqual(cuantos("orange"), 10);
      assert.strictEqual(cuantos("movistar"), 14);
      // Vodafone aparece como S.A.U. y como S.A.: las dos son la misma compañía.
      assert.strictEqual(cuantos("vodafone"), 16);
    }).pipe(conMuestras),
  );

  it.effect("conserva la clave de la fuente y enlaza la ficha codificada en UTF-8", () =>
    Effect.gen(function* () {
      const { listado } = yield* muestraCampusNord;
      const registro = listado.registros.find((r) => r.codigo === "0802532");
      assert.deepStrictEqual(registro, {
        clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
        compania: "movistar",
        codigo: "0802532",
        posicion: { longitud: 2.113628, latitud: 41.388344 },
        direccion: "PZ Eusebi Güell, 1. BARCELONA, BARCELONA",
        municipio: "BARCELONA",
        url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802532&codEmplazamiento=TELEFONICA%20MOVILES%20ESPA%C3%91A%2C%20S.A.U.%20-%200802532",
      });
    }).pipe(conMuestras),
  );

  it.effect("repara la codificación rota de origen", () =>
    Effect.gen(function* () {
      const { listado } = yield* muestraCampusNord;
      const registro = listado.registros.find((r) => r.codigo === "0800942");
      assert.strictEqual(registro?.direccion, "VP Eusebi Güell, 6. BARCELONA, BARCELONA");
    }).pipe(conMuestras),
  );

  it("un titular desconocido es un aviso, no un registro", () => {
    const listado = listadoDeElementos([
      {
        id: "OPERADOR NUEVO, S.L. - 123",
        geometry: { coordinates: [2.1, 41.4] },
        properties: { Gis_ID: "123", Dirección: "CL X, 1. BARCELONA, BARCELONA" },
      },
      { id: "sin geometría" },
    ]);
    assert.deepStrictEqual(listado.registros, []);
    assert.deepStrictEqual(listado.avisos, [
      "Titular desconocido: OPERADOR NUEVO, S.L. - 123",
      "Elemento del listado con un formato desconocido",
    ]);
  });

  it("normaliza las razones sociales a compañías", () => {
    assert.deepStrictEqual(
      [
        "TELEFONICA MOVILES ESPAÑA, S.A.U.",
        "VODAFONE ESPAÑA, S.A.",
        "VODAFONE ESPAÑA, S.A.U.",
        "ORANGE ESPAGNE, S.A.U.",
        "DS MOBILE NETWORKS, S.L.",
        "XFERA MÓVILES, S.A.U.",
        "OTRA, S.A.",
      ].map(companiaDeTitular),
      ["movistar", "vodafone", "vodafone", "orange", "digi", "yoigo", undefined],
    );
  });

  it("saca el municipio de la dirección", () => {
    assert.strictEqual(
      municipioDeDireccion("AV DIAGONAL, 712. HOSPITALET DE LLOBREGAT (L), BARCELONA"),
      "HOSPITALET DE LLOBREGAT (L)",
    );
    assert.strictEqual(
      municipioDeDireccion("AV DIAGIONAL. N2-716, 712. HOSPITALET DE LLOBREGAT (L), BARCELONA"),
      "HOSPITALET DE LLOBREGAT (L)",
    );
    assert.strictEqual(municipioDeDireccion("sin municipio"), "");
  });
});

describe("ficha del registro oficial", () => {
  it.effect("lee las bandas igual que la conversión de la investigación", () =>
    Effect.gen(function* () {
      const html = decodificarLatin1(
        yield* leerMuestra("detalle-orange-CATR0228A.iso-8859-1.html"),
      );
      const bandas = Result.getOrThrow(bandasDeFicha(html));
      assert.deepStrictEqual(
        bandas.map((b) => [b.referencia, b.mhz, b.anio]),
        [
          ["B B -2403167", 2100, 2024],
          ["B B -2403159", 900, 2024],
          ["B B -2403161", 900, 2024],
          ["B B -2403163", 800, 2024],
          ["B B -2403165", 1800, 2024],
          ["B B -2403166", 700, 2024],
        ],
      );
      assert.isTrue(bandas.every((b) => b.compania === "orange"));
    }).pipe(conMuestras),
  );

  it.effect("un expediente con dos rangos es una sola banda", () =>
    Effect.gen(function* () {
      const html = decodificarLatin1(
        yield* leerMuestra("detalle-telefonica-0800942.iso-8859-1.html"),
      );
      const bandas = Result.getOrThrow(bandasDeFicha(html));
      assert.deepStrictEqual(bandas[0]?.rangos, [
        { desdeMhz: 1910, hastaMhz: 1915 },
        { desdeMhz: 2155, hastaMhz: 2170 },
      ]);
      assert.strictEqual(bandas[0]?.mhz, 2100);
      assert.strictEqual(bandas.length, 2);
    }).pipe(conMuestras),
  );

  it.effect("lee la ficha de Digi y la de CRLF de otra investigación", () =>
    Effect.gen(function* () {
      const digi = bandasDeFicha(
        decodificarLatin1(yield* leerMuestra("detalle-digi-0800143.iso-8859-1.html")),
      );
      const crlf = bandasDeFicha(
        decodificarLatin1(yield* leerMuestra("registro-oficial/detalleEstacion_0802314.html")),
      );
      assert.isTrue(Result.isSuccess(digi));
      assert.isTrue(Result.isSuccess(crlf));
      assert.deepStrictEqual(
        Result.getOrThrow(digi).map((b) => [b.mhz, b.anio]),
        [
          [1800, 2026],
          [2100, 2026],
        ],
      );
      assert.isAbove(Result.getOrThrow(crlf).length, 0);
    }).pipe(conMuestras),
  );

  it.effect("el aviso de código no válido es un error aunque llegue con HTTP 200", () =>
    Effect.gen(function* () {
      const html = decodificarLatin1(
        yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
      );
      assert.deepStrictEqual(
        bandasDeFicha(html),
        Result.fail("La ficha dice «Código de emplazamiento no válido»"),
      );
      // Es su propio caso: el registro no tiene ficha de esa estación base.
      assert.isTrue(esFichaSinEmplazamiento(html));
      assert.isFalse(
        esFichaSinEmplazamiento(
          decodificarLatin1(yield* leerMuestra("detalle-digi-0800143.iso-8859-1.html")),
        ),
      );
    }).pipe(conMuestras),
  );

  it("una página sin la tabla de características es un error", () => {
    assert.isTrue(Result.isFailure(bandasDeFicha("<html><body>Mantenimiento</body></html>")));
  });
});
