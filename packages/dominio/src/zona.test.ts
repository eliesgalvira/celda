import { assert, describe, it } from "@effect/vitest";

import type { MunicipioDeCapa } from "./provincias.ts";
import { type EmplazamientoConMunicipio, resumirMunicipios } from "./zona.ts";

const municipio = (codigo: string, nombre: string): MunicipioDeCapa => ({
  codigo,
  nombre,
  etiqueta: { longitud: 2, latitud: 41 },
  habitantes: 1000,
  areaKm2: 10,
  emplazamientos: 0,
  companias: [],
});

const TERRASSA = municipio("08279", "Terrassa");
const AIGUAFREDA = municipio("08014", "Aiguafreda");
const CASTELLCIR = municipio("08056", "Castellcir");

/** `n` emplazamientos en `codigo`, en fila hacia el este desde (2, 41). */
const en = (codigo: string | null, n: number): ReadonlyArray<EmplazamientoConMunicipio> =>
  Array.from({ length: n }, (_, i) => ({
    municipio: codigo,
    posicion: { longitud: 2 + i * 0.01, latitud: 41 },
  }));

describe("resumen de los municipios", () => {
  it("cuenta cada emplazamiento en su municipio y deja fuera los de un territorio compartido", () => {
    const resumen = resumirMunicipios(
      [TERRASSA, AIGUAFREDA],
      [...en("08279", 11), ...en("08014", 2), ...en(null, 5)],
    );
    assert.deepStrictEqual(
      resumen.map((r) => [r.municipio.codigo, r.emplazamientos]),
      [
        ["08279", 11],
        ["08014", 2],
      ],
    );
  });

  it("un municipio sin emplazamientos sale con 0 y sin caja", () => {
    const [castellcir] = resumirMunicipios([CASTELLCIR], en("08279", 12));
    assert.deepStrictEqual(castellcir, {
      municipio: CASTELLCIR,
      emplazamientos: 0,
      caja: undefined,
    });
  });

  it("los números salen de los emplazamientos, no de la tabla de municipios", () => {
    const [terrassa] = resumirMunicipios(
      [{ ...TERRASSA, emplazamientos: 99, companias: ["movistar"] }],
      en("08279", 3),
    );
    assert.strictEqual(terrassa?.emplazamientos, 3);
  });

  it("la caja de un municipio envuelve sus emplazamientos", () => {
    const [terrassa] = resumirMunicipios([TERRASSA], en("08279", 4));
    assert.deepStrictEqual(terrassa?.caja, {
      suroeste: { longitud: 2, latitud: 41 },
      noreste: { longitud: 2.03, latitud: 41 },
    });
  });
});
