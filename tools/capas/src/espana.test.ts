import { dentroDelPoligono } from "@celda/dominio/barrio";
import { areaKm2 } from "@celda/dominio/poblacion";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { contornoDeLaUnion, type Contorno, ficheroDeContorno } from "./espana.ts";
import { unidadesDelGml } from "./gml.ts";
import { limitesDelIgn } from "./municipios.ts";
import {
  FUENTE_DE_PRUEBA,
  GML_PROVINCIAS_DE_PRUEBA,
  gmlDe,
  rectangulo,
  type UnidadDePrueba,
} from "./pruebas.ts";

/** Un municipio de Barcelona de prueba, con su código nacional y sus polígonos. */
const municipio = (codigo: string, ...poligonos: UnidadDePrueba["poligonos"]): UnidadDePrueba => ({
  codigoNacional: `34090808${codigo}`,
  nombre: `Municipio ${codigo}`,
  poligonos,
});

/** Los límites de unos municipios de prueba, como los guarda `pnpm run municipios`. */
const limitesDe = (municipios: ReadonlyArray<UnidadDePrueba>) =>
  Result.getOrThrow(
    limitesDelIgn(
      Result.getOrThrow(unidadesDelGml(gmlDe(municipios))),
      Result.getOrThrow(unidadesDelGml(GML_PROVINCIAS_DE_PRUEBA)),
      FUENTE_DE_PRUEBA,
    ),
  );

const dentro = (contorno: Contorno, longitud: number, latitud: number) =>
  contorno.coordinates.some((poligono) => dentroDelPoligono({ longitud, latitud }, poligono));

/** Dos vecinos de unos 9 km² entre los dos, un islote de 0,2 km² y una isla de casi 4 km². */
const LIMITES = limitesDe([
  municipio("001", [rectangulo(2, 41, 2.02, 41.02)]),
  municipio("002", [rectangulo(2.02, 41, 2.05, 41.02)], [rectangulo(2.1, 41, 2.105, 41.005)]),
  municipio("003", [rectangulo(2.2, 41, 2.22, 41.02)]),
]);

describe("contorno de España", () => {
  it("une los vecinos en un solo polígono, sin el límite que comparten", () => {
    const contorno = Result.getOrThrow(contornoDeLaUnion(LIMITES, 400, 1));
    assert.strictEqual(contorno.type, "MultiPolygon");
    assert.strictEqual(contorno.coordinates.length, 2);
    const vecinos = contorno.coordinates.find((poligono) =>
      dentroDelPoligono({ longitud: 2.01, latitud: 41.01 }, poligono),
    );
    // El rectángulo de los dos juntos, con lo que mide la suma: sin el límite común por medio.
    assert.closeTo(areaKm2(vecinos === undefined ? [] : [vecinos]), 9.33, 0.01);
    assert.isAtMost(vecinos?.[0]?.length ?? 0, 7);
    assert.isTrue(dentro(contorno, 2.04, 41.01), "el segundo vecino");
    assert.isTrue(dentro(contorno, 2.21, 41.01), "la isla de casi 4 km²");
    assert.isFalse(dentro(contorno, 2.102, 41.002), "el islote no llega a 1 km²");
    assert.isFalse(dentro(contorno, 2.07, 41.01), "el mar entre las dos");
  });

  it("cada anillo es un polígono cerrado y en el sentido contrario a las agujas del reloj", () => {
    const contorno = Result.getOrThrow(contornoDeLaUnion(LIMITES, 400, 1));
    for (const [anillo = [], ...agujeros] of contorno.coordinates) {
      assert.deepStrictEqual(agujeros, []);
      assert.deepStrictEqual(anillo[0], anillo.at(-1));
      let doble = 0;
      for (let k = 0; k + 1 < anillo.length; k++) {
        const [x1 = 0, y1 = 0] = anillo[k] ?? [];
        const [x2 = 0, y2 = 0] = anillo[k + 1] ?? [];
        doble += x1 * y2 - x2 * y1;
      }
      assert.isAbove(doble, 0);
    }
  });

  it("un enclave lleno por otro municipio no deja agujero", () => {
    const limites = limitesDe([
      municipio("001", [rectangulo(2, 41, 2.06, 41.04), rectangulo(2.02, 41.01, 2.03, 41.02)]),
      municipio("002", [rectangulo(2.02, 41.01, 2.03, 41.02)]),
    ]);
    const contorno = Result.getOrThrow(contornoDeLaUnion(limites, 400, 1));
    assert.strictEqual(contorno.coordinates.length, 1);
    assert.isTrue(dentro(contorno, 2.025, 41.015), "el enclave");
  });

  it("falla con un agujero que no llena nadie", () => {
    const limites = limitesDe([
      municipio("001", [rectangulo(2, 41, 2.06, 41.04), rectangulo(2.02, 41.01, 2.03, 41.02)]),
    ]);
    const resultado = contornoDeLaUnion(limites, 400, 0.01);
    assert.isTrue(Result.isFailure(resultado));
    if (Result.isFailure(resultado)) assert.include(resultado.failure.message, "agujero");
  });

  it("el fichero lleva la fuente, cómo se hizo y un polígono por línea", () => {
    const contorno = Result.getOrThrow(contornoDeLaUnion(LIMITES, 400, 1));
    const fichero = ficheroDeContorno(LIMITES, contorno, 400, 1);
    assert.deepStrictEqual(JSON.parse(fichero), {
      fuente: FUENTE_DE_PRUEBA,
      toleranciaMetros: 400,
      areaMinimaKm2: 1,
      contorno: JSON.parse(JSON.stringify(contorno)),
    });
    assert.strictEqual(fichero.split("\n").length, contorno.coordinates.length + 3);
  });
});
