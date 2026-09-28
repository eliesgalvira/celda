import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { unidadesDelGml } from "./gml.ts";
import { gmlDe, rectangulo } from "./pruebas.ts";

describe("unidades administrativas del GML del IGN", () => {
  it("lee el código, el nombre y los anillos en millonésimas, con la longitud primero", () => {
    const gml = gmlDe([
      {
        codigoNacional: "34090808019",
        nombre: "Barcelona & prueba",
        poligonos: [[rectangulo(2.1, 41.3, 2.2, 41.4), rectangulo(2.12, 41.32, 2.13, 41.33)]],
      },
      {
        codigoNacional: "34053838001",
        nombre: "Adeje",
        poligonos: [[rectangulo(-16.8, 28.1, -16.7, 28.2)], [rectangulo(-16.6, 28.1, -16.5, 28.2)]],
      },
    ]);
    const unidades = Result.getOrThrow(unidadesDelGml(gml));
    assert.deepStrictEqual(
      unidades.map((u) => [u.codigoNacional, u.nombre, u.poligonos.length]),
      [
        ["34090808019", "Barcelona & prueba", 1],
        ["34053838001", "Adeje", 2],
      ],
    );
    const [exterior, agujero] = unidades[0]?.poligonos[0] ?? [];
    assert.deepStrictEqual(exterior?.slice(0, 4), [2_100_000, 41_300_000, 2_200_000, 41_300_000]);
    assert.lengthOf(agujero ?? [], 10);
    assert.strictEqual(unidades[1]?.poligonos[1]?.[0]?.[0], -16_600_000);
  });

  it("no da por buena una unidad en otro sistema de referencia", () => {
    const gml = gmlDe([
      { codigoNacional: "34090808019", nombre: "B", poligonos: [[rectangulo(0, 40, 1, 41)]] },
    ]).replaceAll("EPSG/0/4258", "EPSG/0/25831");
    const leidas = unidadesDelGml(gml);
    assert.isTrue(Result.isFailure(leidas));
    if (Result.isFailure(leidas)) assert.match(leidas.failure.motivo, /34090808019.*25831/u);
  });

  it("no da por bueno un GML que trae menos unidades de las que anuncia", () => {
    const gml = gmlDe([
      { codigoNacional: "34090808019", nombre: "B", poligonos: [[rectangulo(0, 40, 1, 41)]] },
    ]).replace('numberReturned="1"', 'numberReturned="2"');
    const leidas = unidadesDelGml(gml);
    assert.isTrue(Result.isFailure(leidas));
    if (Result.isFailure(leidas))
      assert.match(leidas.failure.motivo, /anuncia 2 unidades y trae 1/u);
  });

  it("no da por bueno un anillo sin cerrar", () => {
    const gml = gmlDe([
      {
        codigoNacional: "34090808019",
        nombre: "B",
        poligonos: [[rectangulo(0, 40, 1, 41).slice(0, 4)]],
      },
    ]);
    assert.isTrue(Result.isFailure(unidadesDelGml(gml)));
  });
});
