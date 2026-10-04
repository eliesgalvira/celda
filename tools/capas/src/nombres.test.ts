import { dentroDelPoligono } from "@celda/dominio/barrio";
import { TablaDeNombres } from "@celda/dominio/nombreDeLugar";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { Contorno } from "./espana.ts";
import { unidadesDelGml } from "./gml.ts";
import { limitesDelIgn } from "./municipios.ts";
import { contornoDeLaComunitatValenciana, ficheroDeNombres, tablaDeNombres } from "./nombres.ts";
import { FUENTE_DE_PRUEBA, gmlDe, rectangulo, type UnidadDePrueba } from "./pruebas.ts";

/** Una unidad de prueba: un municipio con su código nacional o una provincia. */
const unidad = (
  codigoNacional: string,
  nombre: string,
  ...poligonos: UnidadDePrueba["poligonos"]
): UnidadDePrueba => ({ codigoNacional, nombre, poligonos });

/**
 * Tres provincias de prueba: València, de la Comunitat, con un municipio aparte como el Rincón de
 * Ademuz; Teruel, entre los dos trozos; y Navarra, más lejos.
 */
const PROVINCIAS = gmlDe([
  unidad("34104600000", "València/Valencia", [rectangulo(-1, 39, -0.9, 39.1)]),
  unidad("34024400000", "Teruel", [rectangulo(-1.3, 39, -1, 39.1)]),
  unidad("34153100000", "Navarra", [rectangulo(-1.7, 42.8, -1.6, 42.9)]),
]);

const MUNICIPIOS: ReadonlyArray<UnidadDePrueba> = [
  unidad("34104646220", "Sagunt/Sagunto", [rectangulo(-1, 39, -0.95, 39.1)]),
  unidad("34104646250", "València", [rectangulo(-0.95, 39, -0.9, 39.1)]),
  unidad("34104646001", "Ademuz", [rectangulo(-1.3, 39.2, -1.2, 39.3)]),
  unidad("34024444001", "Teruel", [rectangulo(-1.3, 39, -1, 39.1)]),
  unidad("34153131201", "Pamplona/Iruña", [rectangulo(-1.7, 42.8, -1.65, 42.9)]),
  unidad("34153131097", "Estella-Lizarra", [rectangulo(-1.65, 42.8, -1.6, 42.9)]),
];

const limitesDe = (municipios: ReadonlyArray<UnidadDePrueba>) =>
  Result.getOrThrow(
    limitesDelIgn(
      Result.getOrThrow(unidadesDelGml(gmlDe(municipios))),
      Result.getOrThrow(unidadesDelGml(PROVINCIAS)),
      FUENTE_DE_PRUEBA,
    ),
  );

const LIMITES = limitesDe(MUNICIPIOS);

const CASTELLANAS: ReadonlyMap<string, string> = new Map([
  ["46", "Valencia"],
  ["46220", "Sagunto"],
  ["31201", "Pamplona"],
]);

const leerTabla = Schema.decodeSync(Schema.fromJsonString(TablaDeNombres));

const dentro = (contorno: Contorno, longitud: number, latitud: number) =>
  contorno.coordinates.some((poligono) => dentroDelPoligono({ longitud, latitud }, poligono));

describe("tabla de nombres de lugar", () => {
  it("en la Comunitat Valenciana va la forma local, y fuera, la castellana", () => {
    const tabla = Result.getOrThrow(tablaDeNombres(LIMITES, CASTELLANAS));
    assert.deepStrictEqual(tabla.provincias, {
      "46": { oficial: "València/Valencia", nombre: "València" },
    });
    assert.deepStrictEqual(tabla.municipios, {
      "31201": { oficial: "Pamplona/Iruña", nombre: "Pamplona" },
      "46220": { oficial: "Sagunt/Sagunto", nombre: "Sagunt" },
    });
    assert.deepStrictEqual(tabla.fuente, FUENTE_DE_PRUEBA);
  });

  it("los de una sola forma y los de guion no van en la tabla", () => {
    const tabla = Result.getOrThrow(tablaDeNombres(LIMITES, CASTELLANAS));
    for (const codigo of ["46250", "46001", "44001", "31097", "44"]) {
      assert.notProperty({ ...tabla.provincias, ...tabla.municipios }, codigo);
    }
  });

  it("falla, con todos los motivos, si falta una forma castellana, no es de las dos o sobra", () => {
    const resultado = tablaDeNombres(
      LIMITES,
      new Map([
        ["46", "Valencia"],
        ["46220", "Sagunto de Arriba"],
        ["31097", "Estella"],
      ]),
    );
    assert.isTrue(Result.isFailure(resultado));
    if (Result.isFailure(resultado)) {
      assert.deepStrictEqual(resultado.failure.motivos, [
        "31201 Pamplona/Iruña no tiene",
        "46220 Sagunt/Sagunto tiene «Sagunto de Arriba», que no es ninguna de las dos",
        "31097 sobra: su oficial ya no es bilingüe",
      ]);
    }
  });

  it("el fichero lleva la fuente y una fila por línea, y se lee como la tabla", () => {
    const tabla = Result.getOrThrow(tablaDeNombres(LIMITES, CASTELLANAS));
    const fichero = ficheroDeNombres(tabla);
    assert.deepStrictEqual(leerTabla(fichero), tabla);
    assert.include(fichero, '\n"31201":{"oficial":"Pamplona/Iruña","nombre":"Pamplona"},\n');
    assert.include(fichero, '\n"46220":{"oficial":"Sagunt/Sagunto","nombre":"Sagunt"}\n');
  });
});

describe("contorno de la Comunitat Valenciana", () => {
  it("une los municipios de sus provincias, con el trozo aparte, y deja fuera los demás", () => {
    const contorno = Result.getOrThrow(contornoDeLaComunitatValenciana(LIMITES, 400, 1));
    assert.strictEqual(contorno.coordinates.length, 2);
    assert.isTrue(dentro(contorno, -0.97, 39.05), "Sagunt");
    assert.isTrue(dentro(contorno, -0.92, 39.05), "València");
    assert.isTrue(dentro(contorno, -1.25, 39.25), "el trozo aparte, como el Rincón de Ademuz");
    assert.isFalse(dentro(contorno, -1.1, 39.05), "Teruel");
    assert.isFalse(dentro(contorno, -1.67, 42.85), "Pamplona");
  });
});
