import { assert, describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import muestraEnJson from "../../../docs/investigacion/muestras/ejercicio/cataluna-2026-09-28.json" with { type: "json" };
import { Caja } from "./barrido.ts";
import { Compania } from "./compania.ts";
import {
  type EmplazamientoDelEjercicio,
  PARAMETROS_POR_DEFECTO,
  type ProvinciaConVecinas,
  provinciasParaLasVecinas,
  resolverEjercicio,
  type ResultadoDelEjercicio,
} from "./ejercicio.ts";
import { rectanguloDeCaja } from "./cobertura.ts";
import { FuenteDePoblacion } from "./poblacion.ts";

/**
 * El ejercicio en municipios de verdad, con la primera pasada real de Cataluña (28/09/2026): los
 * emplazamientos de cada municipio y los que pueden ser la vecina de alguno, sacados de la
 * publicación con `docs/investigacion/muestras/ejercicio/extraer.ts`, y los habitantes del padrón
 * del INE que lleva su capa.
 */

const Muestra = Schema.Struct({
  version: Schema.String,
  padron: FuenteDePoblacion,
  provincias: Schema.Array(
    Schema.Struct({
      codigo: Schema.String,
      nombre: Schema.String,
      caja: Schema.NullOr(Caja),
      companias: Schema.Array(Compania),
      cubierta: Schema.Boolean,
      conCapa: Schema.Boolean,
    }),
  ),
  municipios: Schema.Array(
    Schema.Struct({
      codigo: Schema.String,
      nombre: Schema.String,
      habitantes: Schema.NullOr(Schema.Int),
      areaKm2: Schema.Finite,
    }),
  ),
  emplazamientos: Schema.Array(
    Schema.Tuple([
      Schema.String,
      Schema.String,
      Schema.NullOr(Schema.String),
      Schema.Finite,
      Schema.Finite,
      Schema.Array(Compania),
      Schema.Record(Schema.String, Schema.Array(Schema.Int)),
    ]),
  ),
});

const muestra = Schema.decodeUnknownSync(Muestra)(muestraEnJson);

interface DeLaMuestra extends EmplazamientoDelEjercicio {
  readonly provincia: string;
  readonly municipio: string | null;
  readonly bandas: Readonly<Record<string, ReadonlyArray<number>>>;
}

const emplazamientos: ReadonlyArray<DeLaMuestra> = muestra.emplazamientos.map(
  ([clave, provincia, municipio, longitud, latitud, companias, bandas]) => ({
    clave,
    provincia,
    municipio,
    posicion: { longitud, latitud },
    companias,
    bandas,
  }),
);

const provincias: ReadonlyArray<ProvinciaConVecinas> = muestra.provincias.map((p) => ({
  codigo: p.codigo,
  caja: p.caja === null ? undefined : rectanguloDeCaja(p.caja),
  companias: p.companias,
  cubierta: p.cubierta,
  conCapa: p.conCapa,
}));

/**
 * Hace el ejercicio en un municipio como la web: empieza con su provincia cargada y carga las que
 * pida `provinciasParaLasVecinas` hasta que no falte ninguna.
 */
const ejercicioEn = (codigo: string) => {
  const municipio = muestra.municipios.find((m) => m.codigo === codigo);
  if (municipio === undefined) throw new Error(`falta ${codigo} en la muestra`);
  const enZona = emplazamientos.filter((e) => e.municipio === codigo);
  const cargadas = new Set([codigo.slice(0, 2)]);
  const rondas: Array<ReadonlyArray<string>> = [];
  const cargados = () => emplazamientos.filter((e) => cargadas.has(e.provincia));
  const resolver = () =>
    resolverEjercicio({
      habitantes: municipio.habitantes,
      areaKm2: municipio.areaKm2,
      enZona,
      todos: cargados(),
      bandas: new Map(enZona.map((e) => [e.clave, e.bandas])),
      parametros: PARAMETROS_POR_DEFECTO,
    });
  const soloSuProvincia = resolver();
  for (;;) {
    const { faltan, incompletas } = provinciasParaLasVecinas({
      enZona,
      todos: cargados(),
      provincias,
      cargadas,
    });
    if (faltan.length === 0) {
      return { municipio, enZona, rondas, incompletas, soloSuProvincia, resultado: resolver() };
    }
    rondas.push(faltan);
    for (const provincia of faltan) cargadas.add(provincia);
  }
};

const de = (resultado: ResultadoDelEjercicio, compania: Compania) => {
  const encontrado = resultado.companias.find((c) => c.compania === compania);
  if (encontrado === undefined) throw new Error(`falta ${compania}`);
  return encontrado;
};

const provinciaDe = new Map(emplazamientos.map((e) => [e.clave, e.provincia]));

/** Redondea a metros y a centésimas para comparar con el fichero sin ruido de coma flotante. */
const r = (valor: number | undefined) =>
  valor === undefined ? null : Math.round(valor * 100) / 100;

/** Lo que se compara con el fichero de referencia: la tabla del ejercicio, sin las listas. */
const resumido = (hecho: ReturnType<typeof ejercicioEn>) => ({
  municipio: hecho.municipio.codigo,
  nombre: hecho.municipio.nombre,
  habitantes: hecho.resultado.habitantes,
  areaKm2: hecho.resultado.areaKm2,
  densidad: r(hecho.resultado.densidad),
  lineas: r(hecho.resultado.lineas),
  provinciasCargadas: hecho.rondas,
  provinciasIncompletas: hecho.incompletas,
  companias: hecho.resultado.companias.map((c) => ({
    compania: c.compania,
    estaciones: c.estaciones,
    vecinasEnOtraProvincia: c.vecinas.filter(
      (v) => provinciaDe.get(v.hasta) !== hecho.municipio.codigo.slice(0, 2),
    ).length,
    distanciaMedia: r(c.distanciaMedia),
    radio: r(c.radio),
    habitantesPorEstacion: r(c.habitantesPorEstacion),
    usuariosPorEstacion: r(c.usuariosPorEstacion),
    bandas: c.bandas,
    tecnologias: c.tecnologias,
  })),
});

describe("ejercicio de emplazamientos en municipios de Cataluña", () => {
  it("Barcelona entera: 996 emplazamientos y los habitantes del INE, sin salir de su provincia", () => {
    const hecho = ejercicioEn("08019");
    assert.lengthOf(hecho.enZona, 996);
    assert.strictEqual(hecho.resultado.habitantes, 1_731_649);
    assert.deepStrictEqual(hecho.rondas, []);
    assert.deepStrictEqual(hecho.incompletas, []);
    const movistar = de(hecho.resultado, "movistar");
    assert.isAbove(movistar.estaciones, 300);
    // En el centro de una ciudad las estaciones están a unos cientos de metros.
    assert.isBelow(movistar.radio ?? Infinity, 300);
    // La primera pasada aún no había leído las fichas: sin bandas no se afirma ninguna tecnología.
    assert.strictEqual(movistar.conBandas, 0);
    assert.strictEqual(movistar.tecnologias["4G"], "no-consta");
  });

  it("Queralbs, 202 habitantes y 3 emplazamientos: el radio es de kilómetros", () => {
    const hecho = ejercicioEn("17043");
    assert.lengthOf(hecho.enZona, 3);
    assert.strictEqual(hecho.resultado.habitantes, 202);
    const movistar = de(hecho.resultado, "movistar");
    assert.isAbove(movistar.radio ?? 0, 1000);
    assert.strictEqual(de(hecho.resultado, "digi").estaciones, 0);
    assert.isUndefined(de(hecho.resultado, "digi").usuariosPorEstacion);
  });

  it("Bordils no tiene emplazamientos: todo a cero, sin radios y sin pedir más provincias", () => {
    const hecho = ejercicioEn("17025");
    assert.lengthOf(hecho.enZona, 0);
    assert.deepStrictEqual(hecho.rondas, []);
    for (const c of hecho.resultado.companias) {
      assert.strictEqual(c.estaciones, 0);
      assert.isUndefined(c.radio);
      assert.isUndefined(c.habitantesPorEstacion);
    }
    // Los habitantes y las líneas sí se calculan: son de la zona, no de las estaciones.
    assert.strictEqual(hecho.resultado.habitantes, 1841);
    assert.isAbove(hecho.resultado.lineas ?? 0, 0);
  });

  it("Tordera, junto a Girona: carga Girona y encuentra allí vecinas más cercanas", () => {
    const hecho = ejercicioEn("08284");
    assert.deepStrictEqual(hecho.rondas, [["17"]]);
    assert.deepStrictEqual(hecho.incompletas, []);
    const movistar = de(hecho.resultado, "movistar");
    const antes = de(hecho.soloSuProvincia, "movistar");
    assert.isTrue(movistar.vecinas.some((v) => provinciaDe.get(v.hasta) === "17"));
    assert.isBelow(movistar.radio ?? Infinity, antes.radio ?? 0);
  });

  it("Alcanar, junto a Castellón: la carga y dice que de ella solo hay una parte", () => {
    const hecho = ejercicioEn("43004");
    assert.deepStrictEqual(hecho.rondas, [["12"]]);
    assert.deepStrictEqual(hecho.incompletas, ["12"]);
  });

  it("da los resultados de referencia", async () => {
    const json = `${JSON.stringify(
      ["08019", "17043", "17025", "08284", "43004"].map((codigo) => resumido(ejercicioEn(codigo))),
      null,
      2,
    )}\n`;
    await expect(json).toMatchFileSnapshot("./referencia/ejercicio-municipios.json");
  });
});
