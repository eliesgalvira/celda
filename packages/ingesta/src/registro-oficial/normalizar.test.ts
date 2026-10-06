// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { leerMuestra, muestraCampusNord } from "../pruebas/grabado.ts";
import { decodificarLatin1 } from "../texto.ts";
import {
  bandaDeFila,
  companiaDeTitular,
  esFichaSinEmplazamiento,
  leerFicha,
  listadoDeElementos,
  medidasDeFilas,
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
        // Lo que escribió el registro, sin limpiar (ADR 0027).
        crudo: {
          id: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          gisId: "0802532",
          direccion: "PZ Eusebi Güell, 1. BARCELONA, BARCELONA",
          longitud: 2.113628,
          latitud: 41.388344,
        },
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

/** Lo que lee `leerFicha` de una ficha grabada, que tiene que poder leerse. */
const fichaGrabada = (nombre: string) =>
  Effect.map(leerMuestra(nombre), (bytes) =>
    Result.getOrThrow(leerFicha(decodificarLatin1(bytes))),
  );

/** Una ficha mínima con la cabecera de cada tabla como la escribe el geoportal. */
const fichaCon = (niveles: string | undefined) =>
  `<table class="tablaDetalleEstacion"><tr><td><h2>CARACTERISTICAS T&Eacute;CNICAS</h2></td></tr>
  <tr><td><table><tr><td><h3>Operador</h3></td><td><h3>Referencia</h3></td>
  <td><h3>Banda Asignada (MHz)</h3></td></tr>
  <tr><td><p>ORANGE ESPAGNE, S.A.U.</p></td><td><p>B B -2403167</p></td>
  <td><p>2120.00 - 2140.00</p></td></tr></table></td></tr>` +
  (niveles === undefined
    ? ""
    : `<tr><td><h2>NIVELES MEDIDOS EN EL ENTORNO</h2></td></tr><tr><td><table>
  <tr><td><h3>Distancia (m)</h3></td><td><h3>(*) Acimut (&ordm;)</h3></td>
  <td><h3>Valor Medido (&micro;W/cm<sup>2</sup>)</h3></td></tr>${niveles}</table></td></tr>
  <tr><td><p>Los niveles medidos cumplen la normativa legal vigente.</p></td></tr>`) +
  "</table>";

const fila = (distancia: string, acimut: string, valor: string) =>
  `<tr><td><p>${distancia}</p></td><td><p>${acimut}</p></td><td><p>${valor}</p></td></tr>`;

describe("ficha del registro oficial", () => {
  it("la banda de 26 GHz escrita en GHz se lee en MHz, sin banda nominal aún", () => {
    const banda = bandaDeFila({
      operador: "TELEFONICA MOVILES ESPAÑA, S.A.U.",
      referencia: "B B -2201234",
      bandaMhz: "25.70 - 26.70",
    });
    assert.isTrue(Result.isSuccess(banda));
    if (Result.isSuccess(banda)) {
      assert.deepStrictEqual(banda.success.rangos, [{ desdeMhz: 25700, hastaMhz: 26700 }]);
      assert.isNull(banda.success.mhz);
    }
    // Un rango en MHz de verdad no cambia.
    const otra = bandaDeFila({
      operador: "TELEFONICA MOVILES ESPAÑA, S.A.U.",
      referencia: "B B -2201234",
      bandaMhz: "3410.00 - 3500.00",
    });
    assert.deepStrictEqual(
      Result.isSuccess(otra) ? otra.success.rangos : [],
      [{ desdeMhz: 3410, hastaMhz: 3500 }],
    );
  });

  it.effect("lee las bandas igual que la conversión de la investigación", () =>
    Effect.gen(function* () {
      const { bandas } = yield* fichaGrabada("detalle-orange-CATR0228A.iso-8859-1.html");
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

  it.effect("lee las medidas de exposición en el orden de la ficha", () =>
    Effect.gen(function* () {
      const { medidasDeExposicion } = yield* fichaGrabada(
        "detalle-orange-CATR0228A.iso-8859-1.html",
      );
      assert.deepStrictEqual(
        medidasDeExposicion.map((m) => [m.distanciaMetros, m.acimutGrados, m.microvatiosPorCm2]),
        [
          [80, 175, 0.98806],
          [75, 146, 0.59683],
          [32, 36, 0.19618],
          [89, 125, 0.5889],
          [77, 138, 0.5889],
          [51, 146, 0.42784],
        ],
      );
    }).pipe(conMuestras),
  );

  it.effect("lee las medidas de las demás fichas grabadas igual que la conversión a JSON", () =>
    Effect.gen(function* () {
      const { fichas } = yield* muestraCampusNord;
      const cuantas = (clave: string) => fichas.get(clave)?.medidasDeExposicion.length;
      assert.strictEqual(cuantas("TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942"), 5);
      assert.strictEqual(
        (yield* fichaGrabada("detalle-digi-0800143.iso-8859-1.html")).medidasDeExposicion.length,
        9,
      );
      assert.strictEqual(
        (yield* fichaGrabada("registro-oficial/detalleEstacion_0802314.html")).medidasDeExposicion
          .length,
        6,
      );
      // La conversión de la investigación tiene una fila sin valor, que no es una medida.
      assert.strictEqual(cuantas("ORANGE ESPAGNE, S.A.U. - CATR6190A"), 5);
    }).pipe(conMuestras),
  );

  it("una ficha sin la tabla de niveles, o con ella vacía, no tiene medidas y sí bandas", () => {
    for (const html of [fichaCon(undefined), fichaCon("")]) {
      const leida = Result.getOrThrow(leerFicha(html));
      assert.deepStrictEqual(leida.medidasDeExposicion, []);
      assert.deepStrictEqual(
        leida.bandas.map((b) => b.referencia),
        ["B B -2403167"],
      );
    }
  });

  it("acepta la coma decimal y el exponente, y se salta las filas con celdas vacías", () => {
    const leida = leerFicha(
      fichaCon(
        fila("80.0", "175.0", "0,98806") +
          fila("20", "280", "") +
          fila("10.5", "0", "1.0E-4") +
          fila("", "90.0", "0.1"),
      ),
    );
    assert.deepStrictEqual(
      Result.map(leida, (l) => l.medidasDeExposicion),
      Result.succeed([
        { distanciaMetros: 80, acimutGrados: 175, microvatiosPorCm2: 0.98806 },
        { distanciaMetros: 10.5, acimutGrados: 0, microvatiosPorCm2: 0.0001 },
      ]),
    );
  });

  it("una medida que no es un número hace ilegible la ficha, como una banda ilegible", () => {
    for (const [html, valor] of [
      ["1.234,5", "1.234,5"],
      ["&lt; 0.01", "< 0.01"],
      ["-0.5", "-0.5"],
      ["0.5 &micro;W", "0.5 µW"],
    ] as const) {
      assert.deepStrictEqual(
        leerFicha(fichaCon(fila("80.0", "175.0", html))),
        Result.fail(`Medida ilegible en la ficha: 80.0 m, 175.0°, ${valor} µW/cm²`),
      );
    }
    assert.isTrue(
      Result.isFailure(medidasDeFilas([{ distancia: "1,234.5", acimut: "10", valor: "0.1" }])),
    );
  });

  it.effect("un expediente con dos rangos es una sola banda", () =>
    Effect.gen(function* () {
      const { bandas } = yield* fichaGrabada("detalle-telefonica-0800942.iso-8859-1.html");
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
      const digi = yield* fichaGrabada("detalle-digi-0800143.iso-8859-1.html");
      const crlf = yield* fichaGrabada("registro-oficial/detalleEstacion_0802314.html");
      assert.deepStrictEqual(
        digi.bandas.map((b) => [b.mhz, b.anio]),
        [
          [1800, 2026],
          [2100, 2026],
        ],
      );
      assert.isAbove(crlf.bandas.length, 0);
    }).pipe(conMuestras),
  );

  it.effect("el aviso de código no válido es un error aunque llegue con HTTP 200", () =>
    Effect.gen(function* () {
      const html = decodificarLatin1(
        yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
      );
      assert.deepStrictEqual(
        leerFicha(html),
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
    assert.isTrue(Result.isFailure(leerFicha("<html><body>Mantenimiento</body></html>")));
  });
});
