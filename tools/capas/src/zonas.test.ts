import {
  indexarMunicipios,
  LimitesDeMunicipios,
  municipioDelPunto,
} from "@celda/dominio/municipio";
import { IndiceDeZonas, ProvinciasDeZonas } from "@celda/dominio/zonaDelEjercicio";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { unidadesDelGml } from "./gml.ts";
import { limitesDelIgn } from "./municipios.ts";
import { FUENTE_DE_PRUEBA, GML_MUNICIPIOS_DE_PRUEBA, GML_PROVINCIAS_DE_PRUEBA } from "./pruebas.ts";
import {
  contornosDeProvincias,
  ficherosDeZonas,
  indiceDeZonas,
  TOLERANCIA_CONTORNOS_METROS,
  UNIDADES_CONTORNOS,
} from "./zonas.ts";

const leerContorno = Schema.decodeSync(Schema.fromJsonString(LimitesDeMunicipios));
const leerIndice = Schema.decodeSync(Schema.fromJsonString(IndiceDeZonas));
const leerProvincias = Schema.decodeSync(Schema.fromJsonString(ProvinciasDeZonas));

const unidades = (gml: string) => Result.getOrThrow(unidadesDelGml(gml));

// Dos municipios de Barcelona que comparten un límite, un territorio compartido de Burgos y uno
// sin provincia.
const LIMITES = Result.getOrThrow(
  limitesDelIgn(
    unidades(GML_MUNICIPIOS_DE_PRUEBA),
    unidades(GML_PROVINCIAS_DE_PRUEBA),
    FUENTE_DE_PRUEBA,
  ),
);

describe("zonas del ejercicio", () => {
  it("cada provincia lleva sus recintos, sin los que no tienen provincia", () => {
    const contornos = contornosDeProvincias(LIMITES);
    assert.deepStrictEqual([...contornos.keys()], ["08", "09"]);
    const barcelona = contornos.get("08");
    assert.deepStrictEqual(
      barcelona?.territorios.map((t) => t.codigo),
      ["08001", "08002"],
    );
    assert.deepStrictEqual(
      contornos.get("09")?.territorios.map((t) => t.tipo),
      ["compartido"],
    );
    assert.strictEqual(barcelona?.toleranciaMetros, TOLERANCIA_CONTORNOS_METROS);
    assert.strictEqual(barcelona?.unidadesPorGrado, UNIDADES_CONTORNOS);
  });

  it("los arcos se renumeran por provincia y los vecinos siguen compartiendo el suyo", () => {
    const barcelona = contornosDeProvincias(LIMITES).get("08");
    const usos = new Map<number, number>();
    for (const territorio of barcelona?.territorios ?? []) {
      for (const referencia of territorio.poligonos.flat(2)) {
        const arco = referencia >= 0 ? referencia : ~referencia;
        usos.set(arco, (usos.get(arco) ?? 0) + 1);
      }
    }
    assert.deepStrictEqual(
      [...usos.keys()].toSorted((a, b) => a - b),
      (barcelona?.arcos ?? []).map((_, i) => i),
    );
    assert.strictEqual([...usos.values()].filter((n) => n === 2).length, 1);
  });

  it("con el contorno, la etiqueta de cada municipio sigue cayendo en él", () => {
    for (const contorno of contornosDeProvincias(LIMITES).values()) {
      const indice = indexarMunicipios(contorno);
      for (const territorio of contorno.territorios) {
        const { municipio, provincia } = municipioDelPunto(territorio.etiqueta, indice);
        assert.strictEqual(
          municipio?.codigo ?? provincia?.codigo,
          territorio.tipo === "municipio" ? territorio.codigo : territorio.provincia,
        );
      }
    }
  });

  it("el índice lleva los municipios, no los territorios, y la caja de cada provincia", () => {
    const indice = indiceDeZonas(LIMITES, contornosDeProvincias(LIMITES));
    assert.deepStrictEqual(
      indice.municipios.map(([codigo]) => codigo),
      ["08001", "08002"],
    );
    assert.deepStrictEqual(
      indice.provincias.map((p) => p.codigo),
      ["08", "09"],
    );
    for (const territorio of LIMITES.territorios.filter((t) => t.provincia !== null)) {
      const [oeste, sur, este, norte] =
        indice.provincias.find((p) => p.codigo === territorio.provincia)?.caja ?? [];
      const { longitud, latitud } = territorio.etiqueta;
      assert.isTrue(
        longitud >= (oeste ?? Infinity) &&
          longitud <= (este ?? -Infinity) &&
          latitud >= (sur ?? Infinity) &&
          latitud <= (norte ?? -Infinity),
      );
    }
  });

  it("escribe el índice, sus provincias y un fichero por provincia que se vuelven a leer igual", () => {
    const ficheros = ficherosDeZonas(LIMITES);
    assert.deepStrictEqual(
      [...ficheros.keys()],
      ["indice.json", "provincias.json", "08.json", "09.json"],
    );
    const contornos = contornosDeProvincias(LIMITES);
    const indice = indiceDeZonas(LIMITES, contornos);
    assert.deepStrictEqual(leerContorno(ficheros.get("08.json") ?? ""), contornos.get("08"));
    assert.deepStrictEqual(leerIndice(ficheros.get("indice.json") ?? ""), indice);
    assert.deepStrictEqual(leerProvincias(ficheros.get("provincias.json") ?? ""), {
      fuente: indice.fuente,
      provincias: indice.provincias,
    });
  });
});
