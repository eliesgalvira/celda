import type { PadronDeMunicipios } from "@celda/dominio/municipio";
import { dentroDelPoligono } from "@celda/dominio/poligono";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import {
  centrosDeProvincia,
  ficheroDeCentros,
  ficheroDeCiudades,
  tablaDeCentros,
  tablaDeCiudades,
} from "./centros.ts";
import { unidadesDelGml } from "./gml.ts";
import { limitesDelIgn } from "./municipios.ts";
import {
  FUENTE_DE_PRUEBA,
  GML_PROVINCIAS_DE_PRUEBA,
  gmlDe,
  rectangulo,
  type UnidadDePrueba,
} from "./pruebas.ts";

/** Un municipio de prueba de Barcelona (08) o de Burgos (09), con sus polígonos. */
const municipio = (codigo: string, ...poligonos: UnidadDePrueba["poligonos"]): UnidadDePrueba => ({
  codigoNacional: `340${codigo.startsWith("09") ? "7" : "9"}${codigo.slice(0, 2)}${codigo}`,
  nombre: `Municipio ${codigo}`,
  poligonos,
});

const limitesDe = (municipios: ReadonlyArray<UnidadDePrueba>) =>
  Result.getOrThrow(
    limitesDelIgn(
      Result.getOrThrow(unidadesDelGml(gmlDe(municipios))),
      Result.getOrThrow(unidadesDelGml(GML_PROVINCIAS_DE_PRUEBA)),
      FUENTE_DE_PRUEBA,
    ),
  );

const padronDe = (habitantes: Readonly<Record<string, number>>): PadronDeMunicipios => ({
  fuente: {
    atribucion: "INE",
    licencia: "CC BY 4.0",
    enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
    referencia: "2025-01-01",
    publicada: "2025-12-11",
  },
  municipios: Object.entries(habitantes).map(([codigo, n]) => ({ codigo, habitantes: n })),
});

describe("centros de provincia", () => {
  it("van en el polígono más poblado, aunque otro sea mayor", () => {
    // Barcelona: una isla pequeña con casi todos los habitantes y otra mucho mayor y vacía.
    const limites = limitesDe([
      municipio("08001", [rectangulo(2, 41, 2.04, 41.03)]),
      municipio("08002", [rectangulo(2.2, 41, 2.4, 41.1)]),
    ]);
    const [barcelona] = Result.getOrThrow(
      centrosDeProvincia(limites, padronDe({ "08001": 900_000, "08002": 1000 }), 300, 50),
    );
    assert.strictEqual(barcelona?.codigo, "08");
    assert.strictEqual(barcelona?.habitantes, 901_000);
    assert.lengthOf(barcelona?.poligonos ?? [], 2);
    assert.strictEqual(barcelona?.poligonos[0]?.habitantes, 900_000);
    const [longitud = 0, latitud = 0] = barcelona?.centro.centro ?? [];
    assert.closeTo(longitud, 2.02, 0.002);
    assert.closeTo(latitud, 41.015, 0.002);
  });

  it("a igual población, en el mayor", () => {
    const limites = limitesDe([
      municipio("08001", [rectangulo(2, 41, 2.04, 41.03)]),
      municipio("08002", [rectangulo(2.2, 41, 2.4, 41.1)]),
    ]);
    const [barcelona] = Result.getOrThrow(
      centrosDeProvincia(limites, padronDe({ "08001": 0, "08002": 0 }), 300, 50),
    );
    const [longitud = 0] = barcelona?.centro.centro ?? [];
    assert.closeTo(longitud, 2.3, 0.005);
  });

  it("une los municipios de la provincia y no cae en el enclave de otra", () => {
    // Un municipio de Barcelona con un agujero que llena uno de Burgos, como el condado de
    // Treviño dentro de Álava; y su vecino, para que el borde común quede dentro.
    const limites = limitesDe([
      municipio("08001", [rectangulo(2, 41, 2.12, 41.06), rectangulo(2.05, 41.02, 2.07, 41.04)]),
      municipio("08002", [rectangulo(2.12, 41, 2.14, 41.06)]),
      municipio("09001", [rectangulo(2.05, 41.02, 2.07, 41.04)]),
    ]);
    const provincias = Result.getOrThrow(
      centrosDeProvincia(limites, padronDe({ "08001": 10, "08002": 10, "09001": 10 }), 300, 50),
    );
    const barcelona = provincias.find((p) => p.codigo === "08");
    // Un solo polígono, el de los dos municipios juntos, con el enclave como agujero.
    assert.lengthOf(barcelona?.poligonos ?? [], 1);
    assert.lengthOf(barcelona?.poligonos[0]?.poligono ?? [], 2);
    const [longitud = 0, latitud = 0] = barcelona?.centro.centro ?? [];
    const centro = { longitud, latitud };
    assert.isTrue(dentroDelPoligono(centro, barcelona?.poligonos[0]?.poligono ?? []));
    assert.isFalse(
      longitud > 2.05 && longitud < 2.07 && latitud > 41.02 && latitud < 41.04,
      "en el enclave",
    );
    // El de Burgos va en su enclave.
    const [burgosX = 0, burgosY = 0] =
      provincias.find((p) => p.codigo === "09")?.centro.centro ?? [];
    assert.closeTo(burgosX, 2.06, 0.002);
    assert.closeTo(burgosY, 41.03, 0.002);
  });

  it("la tabla y el fichero llevan las dos fuentes y una provincia por línea", () => {
    const limites = limitesDe([municipio("08001", [rectangulo(2, 41, 2.04, 41.03)])]);
    const padron = padronDe({ "08001": 25_000 });
    const tabla = tablaDeCentros(
      limites,
      padron,
      Result.getOrThrow(centrosDeProvincia(limites, padron, 300, 200)),
    );
    const fichero = ficheroDeCentros(tabla);
    assert.deepStrictEqual(JSON.parse(fichero), JSON.parse(JSON.stringify(tabla)));
    assert.strictEqual(tabla.provincias["08"]?.habitantes, 25_000);
    assert.include(fichero, '\n"08":{"centro":[');
  });

  it("las ciudades son los municipios con 20.000 habitantes o más, con su nombre de lugar", () => {
    const limites = limitesDe([
      municipio("08001", [rectangulo(2, 41, 2.04, 41.03)]),
      municipio("08002", [rectangulo(2.04, 41, 2.08, 41.03)]),
    ]);
    const tabla = tablaDeCiudades(limites, padronDe({ "08001": 20_000, "08002": 19_999 }));
    assert.strictEqual(tabla.minimo, 20_000);
    assert.lengthOf(tabla.ciudades, 1);
    const [nombre, longitud, latitud, habitantes] = tabla.ciudades[0] ?? [];
    assert.strictEqual(nombre, "Municipio 08001");
    assert.strictEqual(habitantes, 20_000);
    // Dos decimales: un kilómetro.
    assert.strictEqual(longitud, Math.round((longitud ?? 0) * 100) / 100);
    assert.strictEqual(latitud, Math.round((latitud ?? 0) * 100) / 100);
    assert.deepStrictEqual(JSON.parse(ficheroDeCiudades(tabla)), JSON.parse(JSON.stringify(tabla)));
  });
});
