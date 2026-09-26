import { dentroDelPoligono, LimitesDeBarrios } from "@celda/dominio/barrio";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ficheroDeLimites, leerWkt, limitesDeOpenData, puntoDeEtiqueta } from "./barrios.ts";

const FUENTE = {
  atribucion: "Ajuntament de Barcelona",
  licencia: "CC BY 4.0",
  enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
  fecha: "2024-11-12",
};

const decodificar = Schema.decodeSync(Schema.fromJsonString(LimitesDeBarrios));

const CUADRADO = "POLYGON ((2.1 41.3, 2.2 41.3, 2.2 41.4, 2.1 41.4, 2.1 41.3))";

describe("límites de barrio de Open Data BCN", () => {
  it("lee un POLYGON con agujero y redondea a seis decimales", () => {
    const [poligono, ...resto] = leerWkt(
      "POLYGON ((0 0, 3 0, 3 3, 0 3, 0 0), (1 1, 2 1, 2 2, 1 2, 1 1))".replace(
        "3 0",
        "3.00000012 0",
      ),
    );
    assert.lengthOf(resto, 0);
    assert.lengthOf(poligono ?? [], 2);
    assert.deepStrictEqual(poligono?.[0]?.[1], [3, 0]);
    assert.isFalse(dentroDelPoligono({ longitud: 1.5, latitud: 1.5 }, poligono ?? []));
    assert.isTrue(dentroDelPoligono({ longitud: 0.5, latitud: 1.5 }, poligono ?? []));
  });

  it("lee un MULTIPOLYGON como varios polígonos", () => {
    const poligonos = leerWkt(
      "MULTIPOLYGON (((0 0, 1 0, 1 1, 0 1, 0 0)), ((5 5, 6 5, 6 6, 5 6, 5 5)))",
    );
    assert.lengthOf(poligonos, 2);
    assert.deepStrictEqual(poligonos[1]?.[0]?.[0], [5, 5]);
  });

  it("la etiqueta cae dentro del barrio aunque su centroide caiga fuera", () => {
    // Una C abierta hacia el este: su centroide cae en el hueco.
    const [ce] = leerWkt("POLYGON ((0 0, 10 0, 10 2, 2 2, 2 8, 10 8, 10 10, 0 10, 0 0))");
    const etiqueta = puntoDeEtiqueta([ce ?? []]);
    assert.isTrue(dentroDelPoligono(etiqueta, ce ?? []), JSON.stringify(etiqueta));

    // En un cuadrado es el centro.
    assert.deepStrictEqual(puntoDeEtiqueta(leerWkt(CUADRADO)), {
      longitud: 2.15,
      latitud: 41.35,
    });
  });

  it("la etiqueta de un barrio en dos trozos va en el trozo más grande", () => {
    const etiqueta = puntoDeEtiqueta(
      leerWkt("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 1, 0 0)), ((5 5, 9 5, 9 9, 5 9, 5 5)))"),
    );
    assert.deepStrictEqual(etiqueta, { longitud: 7, latitud: 7 });
  });

  it("ordena los barrios por código y el fichero se vuelve a leer igual", () => {
    const limites = limitesDeOpenData(
      [
        { codi_barri: "02", nom_barri: "el Barri Gòtic", geometria_wgs84: CUADRADO },
        { codi_barri: "01", nom_barri: "el Raval", geometria_wgs84: CUADRADO },
      ],
      FUENTE,
    );
    assert.isTrue(Result.isSuccess(limites));
    if (Result.isFailure(limites)) return;
    assert.deepStrictEqual(
      limites.success.barrios.map((b) => b.codigo),
      ["01", "02"],
    );

    const fichero = ficheroDeLimites(limites.success);
    assert.lengthOf(fichero.trim().split("\n"), 4, "un barrio por línea");
    const leidos = decodificar(fichero);
    assert.deepStrictEqual(leidos, limites.success);
  });

  it("una geometría que no se puede leer hace fallar todo, con el barrio que falla", () => {
    const limites = limitesDeOpenData(
      [
        { codi_barri: "01", nom_barri: "el Raval", geometria_wgs84: CUADRADO },
        { codi_barri: "02", nom_barri: "el Barri Gòtic", geometria_wgs84: "POINT (2.1 41.3)" },
      ],
      FUENTE,
    );
    assert.isTrue(Result.isFailure(limites));
    if (Result.isSuccess(limites)) return;
    assert.strictEqual(limites.failure.barrio, "02 el Barri Gòtic");
  });
});
