// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { desmantelar } from "../pruebas/antenasmoviles.ts";
import { leerMuestra } from "../pruebas/grabado.ts";
import { ZONA_BARCELONA } from "../zona.ts";
import {
  companiaDeOperador,
  enlaceDelMapa,
  municipioDeLaFuente,
  observacionesDeDetalle,
  puntosDeListado,
  urlDeDetalle,
} from "./normalizar.ts";

const conMuestras = Effect.provide(NodeServices.layer);

const texto = (nombre: string) =>
  Effect.map(leerMuestra(`antenasmoviles/${nombre}`), (bytes) => new TextDecoder().decode(bytes));

describe("listado de antenasmoviles.es", () => {
  it.effect("lee los puntos de Campus Nord con sus códigos ordenados y una huella por punto", () =>
    Effect.gen(function* () {
      const listado = puntosDeListado(
        yield* texto("v1-showf-er5_extracto-campus-nord.json"),
        ZONA_BARCELONA,
      );
      assert.isTrue(Result.isSuccess(listado));
      if (Result.isSuccess(listado)) {
        const { puntos, avisos, filas } = listado.success;
        assert.strictEqual(filas, 41);
        assert.strictEqual(puntos.length, 41);
        assert.deepStrictEqual(avisos, []);
        const campus = puntos.find((p) => p.codigos.includes("0802532"));
        assert.deepStrictEqual(campus?.codigos, ["0802532", "086040", "86040", "CATR0228A"]);
        assert.strictEqual(campus?.clave, "0802532,086040,86040,CATR0228A");
        assert.deepStrictEqual(campus?.posicion, { longitud: 2.113628, latitud: 41.388342 });
        assert.strictEqual(campus?.prioridad, 1);
        assert.strictEqual(new Set(puntos.map((p) => p.huella)).size, puntos.length);
      }
    }).pipe(conMuestras),
  );

  it.effect("las ER5 de Barcelona van primero y se quedan fuera las de otra zona", () =>
    Effect.gen(function* () {
      const listado = puntosDeListado(
        yield* texto("v1-showf-er5_extracto-er5-barcelona.json"),
        [2.1, 41.35, 2.2, 41.4],
      );
      assert.isTrue(Result.isSuccess(listado));
      if (Result.isSuccess(listado)) {
        assert.strictEqual(listado.success.filas, 42);
        assert.isAbove(listado.success.puntos.length, 10);
        assert.isBelow(listado.success.puntos.length, 42);
        assert.isTrue(listado.success.puntos.every((p) => p.prioridad === 0));
      }
    }).pipe(conMuestras),
  );

  it("lee las coordenadas con exponente y la huella cambia con cualquier cambio de la fila", () => {
    const fila =
      '[39.938817,-2.2e-5,["056566","56566","VALR9474A"],"31",{"VF":["B7"],"OR":["B3"]}]';
    const otra =
      '[39.938817,-2.2e-5,["056566","56566","VALR9474A"],"31",{"VF":["B7"],"OR":["N78"]}]';
    const zona = [-1, 39, 1, 40] as const;
    const uno = puntosDeListado(`[${fila}]`, zona);
    const dos = puntosDeListado(`[${otra}]`, zona);
    assert.isTrue(Result.isSuccess(uno) && Result.isSuccess(dos));
    if (Result.isSuccess(uno) && Result.isSuccess(dos)) {
      assert.deepStrictEqual(uno.success.puntos[0]?.posicion, {
        longitud: -0.000022,
        latitud: 39.938817,
      });
      assert.notStrictEqual(uno.success.puntos[0]?.huella, dos.success.puntos[0]?.huella);
    }
  });

  it("una página HTML no es un listado vacío sino un fallo", () => {
    const listado = puntosDeListado(
      "<!DOCTYPE html><title>Just a moment...</title>",
      [-180, -90, 180, 90],
    );
    assert.isTrue(Result.isFailure(listado));
  });

  it("una fila que no entiende es un aviso y no para el resto", () => {
    const listado = puntosDeListado(
      '[[41.38,2.11,["A1"],"7",{"MS":["B3"]}],[41.39,2.12,["B2"],7,{"MS":["B3"]}]]',
      ZONA_BARCELONA,
    );
    assert.isTrue(Result.isSuccess(listado));
    if (Result.isSuccess(listado)) {
      assert.deepStrictEqual(
        listado.success.puntos.map((p) => p.clave),
        ["A1"],
      );
      assert.strictEqual(listado.success.avisos.length, 1);
    }
  });
});

describe("detalle de antenasmoviles.es", () => {
  it.effect("una estación que copia el registro oficial no da ninguna observación", () =>
    Effect.gen(function* () {
      for (const nombre of ["v1-markers_0802532.json", "v1-markers_000455.json"]) {
        const detalle = observacionesDeDetalle(yield* texto(nombre));
        assert.isTrue(Result.isSuccess(detalle));
        if (Result.isSuccess(detalle)) {
          assert.deepStrictEqual(detalle.success, { observaciones: [], avisos: [] });
        }
      }
    }).pipe(conMuestras),
  );

  it.effect("una ER5 es una estación presente que el registro no tiene", () =>
    Effect.gen(function* () {
      const detalle = observacionesDeDetalle(yield* texto("v1-markers_MV-BCN-82383.json"));
      assert.isTrue(Result.isSuccess(detalle));
      if (Result.isSuccess(detalle)) {
        assert.deepStrictEqual(detalle.success.observaciones, [
          {
            clave: "movistar - MV-BCN-82383",
            compania: "movistar",
            codigo: "MV-BCN-82383",
            posicion: { longitud: 2.14306, latitud: 41.37958 },
            direccion: "Carrer de Tarragona, 177, Sants-Montjuïc, 08014 Barcelona",
            municipio: "BARCELONA",
            url: "https://antenasmoviles.es/#19/41.379580/2.143060",
            afirma: "presente",
          },
        ]);
      }
    }).pipe(conMuestras),
  );

  it.effect("una ER5 con código de aspecto oficial sigue siendo una ER5", () =>
    Effect.gen(function* () {
      const detalle = observacionesDeDetalle(yield* texto("v1-markers_CATR6031A.json"));
      assert.isTrue(Result.isSuccess(detalle));
      if (Result.isSuccess(detalle)) {
        assert.deepStrictEqual(
          detalle.success.observaciones.map((o) => [o.clave, o.afirma]),
          [["orange - CATR6031A", "presente"]],
        );
      }
    }).pipe(conMuestras),
  );

  it.effect(
    "la foto más reciente marcada «desmantelada» da la estación por desmontada, con su código activo",
    () =>
      Effect.gen(function* () {
        // Sintético: en las muestras ninguna foto lleva la bandera puesta.
        const detalle = observacionesDeDetalle(
          desmantelar(yield* texto("v1-markers_000455.json"), 0, "2026-09-20 11:00:00"),
        );
        assert.isTrue(Result.isSuccess(detalle));
        if (Result.isSuccess(detalle)) {
          assert.deepStrictEqual(
            detalle.success.observaciones.map((o) => [o.clave, o.codigo, o.afirma, o.url]),
            [
              [
                "vodafone - 000455",
                "000455",
                "desmontada",
                "https://antenasmoviles.es/#19/41.385011/2.195467",
              ],
            ],
          );
        }
      }).pipe(conMuestras),
  );

  it.effect("una bandera vacía, cero o falsa no cuenta como desmantelada", () =>
    Effect.gen(function* () {
      const grabado = yield* texto("v1-markers_000455.json");
      for (const bandera of ["", "0", 0, false, null]) {
        const detalle = observacionesDeDetalle(
          desmantelar(grabado, 0, "2026-09-20 11:00:00", bandera),
        );
        assert.isTrue(Result.isSuccess(detalle));
        if (Result.isSuccess(detalle)) {
          assert.deepStrictEqual(detalle.success.observaciones, []);
        }
      }
    }).pipe(conMuestras),
  );

  it("una estación de compañía desconocida es un aviso", () => {
    const detalle = observacionesDeDetalle(
      '[[["X1"],["ER5-DESCONOCIDA","er5","1"],["Calle, 08001 Barcelona",41.38,2.17,"0m"],[],[],"1",[]]]',
    );
    assert.isTrue(Result.isSuccess(detalle));
    if (Result.isSuccess(detalle)) {
      assert.deepStrictEqual(detalle.success.observaciones, []);
      assert.deepStrictEqual(detalle.success.avisos, [
        "Compañía desconocida: ER5-DESCONOCIDA (X1)",
      ]);
    }
  });

  it("una página HTML en lugar del detalle es un fallo", () => {
    assert.isTrue(Result.isFailure(observacionesDeDetalle("<html></html>")));
  });
});

describe("enlaces y nombres de antenasmoviles.es", () => {
  it("pide el detalle con todos los códigos y enlaza el mapa centrado en el punto", () => {
    assert.strictEqual(
      urlDeDetalle(["000595", "CATR0020Ñ"]),
      "https://antenasmoviles.es/v1/markers?id=000595,CATR0020%C3%91",
    );
    assert.strictEqual(
      enlaceDelMapa({ longitud: 2.1, latitud: 41.38 }),
      "https://antenasmoviles.es/#19/41.380000/2.100000",
    );
  });

  it("traduce los códigos de red, también los de las ER5", () => {
    assert.strictEqual(companiaDeOperador("7"), "movistar");
    assert.strictEqual(companiaDeOperador("er5_3"), "orange");
    assert.strictEqual(companiaDeOperador("er5"), undefined);
  });

  it("saca el municipio de las direcciones del registro y de Nominatim", () => {
    assert.strictEqual(municipioDeLaFuente("CL TRELAWNY, 2. BARCELONA, BARCELONA"), "BARCELONA");
    assert.strictEqual(
      municipioDeLaFuente("Pl. d'Urquinaona, L'Eixample, 08010 Barcelona"),
      "BARCELONA",
    );
    assert.strictEqual(municipioDeLaFuente("sin municipio"), "");
  });
});
