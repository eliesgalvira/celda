import type { Coordenada } from "@celda/dominio/area";
import { assert, describe, it } from "@effect/vitest";

import {
  esNivelDeMunicipios,
  esNivelDeMunicipiosGrandes,
  HABITANTES_DE_ZONA,
  LADO_MAXIMO_DE_ZONA,
  MINIMO_DE_ZONA,
  NIVEL_DE_BARRIOS,
  NIVEL_DE_MUNICIPIOS,
  NIVELES_DE_MUNICIPIOS,
  zonasDeMunicipios,
} from "./zonas.ts";

/** Grados de longitud que mide `px` píxeles a zoom `nivel`, con teselas de 512. */
const grados = (px: number, nivel: number): number => (px / (512 * 2 ** nivel)) * 360;

/** `n` emplazamientos de `municipio` en fila hacia el este desde `desde`, a lo largo de `ancho`°. */
const fila = (municipio: string, n: number, desde: Coordenada, ancho: number) =>
  Array.from({ length: n }, (_, i) => ({
    municipio,
    posicion: {
      longitud: desde.longitud + (n === 1 ? 0 : (ancho * i) / (n - 1)),
      latitud: desde.latitud,
    },
  }));

const UTEBO: Coordenada = { longitud: -1, latitud: 41.71 };

describe("zonas de municipio", () => {
  it("los niveles de municipios van del 9 al 12, justo antes del de barrios; el 9 y el 10, de los grandes", () => {
    assert.strictEqual(NIVEL_DE_MUNICIPIOS, 11);
    assert.strictEqual(NIVEL_DE_BARRIOS, 13);
    assert.deepStrictEqual(NIVELES_DE_MUNICIPIOS, [9, 10, 11, 12]);
    const niveles = Array.from({ length: 19 }, (_, n) => n);
    assert.deepStrictEqual(niveles.filter(esNivelDeMunicipios), [9, 10, 11, 12]);
    assert.deepStrictEqual(niveles.filter(esNivelDeMunicipiosGrandes), [9, 10]);
    assert.deepStrictEqual(
      [...HABITANTES_DE_ZONA],
      [
        [9, 50_000],
        [10, 20_000],
      ],
    );
  });

  it("en el 9 y el 10 son zona los de 50.000 y 20.000 habitantes, midan lo que midan", () => {
    const enorme = grados(LADO_MAXIMO_DE_ZONA * 4, 9);
    const zonas = zonasDeMunicipios(
      [
        ...fila("ciudad", 300, UTEBO, enorme),
        ...fila("mediana", 8, UTEBO, 0.001),
        ...fila("pueblo", 8, UTEBO, 0.001),
        ...fila("pocos", 3, UTEBO, 0.001),
      ],
      [
        { codigo: "ciudad", etiqueta: UTEBO, habitantes: 680_000 },
        { codigo: "mediana", etiqueta: UTEBO, habitantes: 20_000 },
        { codigo: "pueblo", etiqueta: UTEBO, habitantes: 19_999 },
        { codigo: "pocos", etiqueta: UTEBO, habitantes: 90_000 },
      ],
    );
    assert.deepStrictEqual(
      zonas.map((s) => [...s].toSorted()),
      [["ciudad"], ["ciudad", "mediana"], ["mediana", "pueblo"], ["mediana", "pueblo"]],
    );
  });

  it("con menos de 4 emplazamientos un municipio no es zona: siguen sueltos o en hexágonos", () => {
    assert.strictEqual(MINIMO_DE_ZONA, 4);
    const etiquetas = [
      { codigo: "a", etiqueta: UTEBO },
      { codigo: "b", etiqueta: UTEBO },
      { codigo: "c", etiqueta: UTEBO },
    ];
    const zonas = zonasDeMunicipios(
      [...fila("a", 3, UTEBO, 0.001), ...fila("b", 4, UTEBO, 0.001), ...fila("c", 1, UTEBO, 0)],
      etiquetas,
    );
    assert.deepStrictEqual(
      zonas.map((s) => [...s]),
      [[], [], ["b"], ["b"]],
    );
  });

  it("es zona en un nivel si, con su etiqueta, no mide más de 240 px; al acercar mide el doble", () => {
    assert.strictEqual(LADO_MAXIMO_DE_ZONA, 240);
    const casi = grados(LADO_MAXIMO_DE_ZONA - 1, NIVEL_DE_MUNICIPIOS);
    const pasado = grados(LADO_MAXIMO_DE_ZONA + 1, NIVEL_DE_MUNICIPIOS);
    const pequeno = grados(LADO_MAXIMO_DE_ZONA / 2 - 1, NIVEL_DE_MUNICIPIOS);
    const zonas = zonasDeMunicipios(
      [
        ...fila("mediano", 8, UTEBO, casi),
        ...fila("grande", 300, UTEBO, pasado),
        ...fila("compacto", 8, UTEBO, pequeno),
      ],
      [
        { codigo: "mediano", etiqueta: UTEBO },
        { codigo: "grande", etiqueta: UTEBO },
        { codigo: "compacto", etiqueta: UTEBO },
      ],
    );
    assert.deepStrictEqual([...(zonas[2] ?? [])].toSorted(), ["compacto", "mediano"]);
    assert.deepStrictEqual([...(zonas[3] ?? [])], ["compacto"]);
  });

  it("la etiqueta cuenta: si queda lejos de sus emplazamientos, la zona mide más", () => {
    const lejos = { longitud: UTEBO.longitud + grados(300, NIVEL_DE_MUNICIPIOS), latitud: 41.71 };
    const zonas = zonasDeMunicipios(fila("a", 6, UTEBO, 0.001), [{ codigo: "a", etiqueta: lejos }]);
    assert.deepStrictEqual(
      zonas.map((s) => s.size),
      [0, 0, 0, 0],
    );
  });

  it("no cuenta lo que no tiene municipio ni los municipios que no están en la tabla", () => {
    const zonas = zonasDeMunicipios(
      [
        ...fila("a", 5, UTEBO, 0.001),
        ...Array.from({ length: 5 }, () => ({ municipio: null, posicion: UTEBO })),
        ...fila("fuera", 5, UTEBO, 0.001),
      ],
      [{ codigo: "a", etiqueta: UTEBO }],
    );
    assert.deepStrictEqual(
      zonas.map((s) => [...s]),
      [[], [], ["a"], ["a"]],
    );
  });
});
