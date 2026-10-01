import type { Coordenada } from "@celda/dominio/area";
import { assert, describe, it } from "@effect/vitest";

import {
  esNivelDeMunicipios,
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
  it("los niveles de municipios son el 11 y el 12, justo antes del de barrios", () => {
    assert.strictEqual(NIVEL_DE_MUNICIPIOS, 11);
    assert.strictEqual(NIVEL_DE_BARRIOS, 13);
    assert.deepStrictEqual(NIVELES_DE_MUNICIPIOS, [11, 12]);
    assert.deepStrictEqual(
      Array.from({ length: 19 }, (_, n) => n).filter(esNivelDeMunicipios),
      [11, 12],
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
      [["b"], ["b"]],
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
    assert.deepStrictEqual([...(zonas[0] ?? [])].toSorted(), ["compacto", "mediano"]);
    assert.deepStrictEqual([...(zonas[1] ?? [])], ["compacto"]);
  });

  it("la etiqueta cuenta: si queda lejos de sus emplazamientos, la zona mide más", () => {
    const lejos = { longitud: UTEBO.longitud + grados(300, NIVEL_DE_MUNICIPIOS), latitud: 41.71 };
    const zonas = zonasDeMunicipios(fila("a", 6, UTEBO, 0.001), [{ codigo: "a", etiqueta: lejos }]);
    assert.deepStrictEqual(
      zonas.map((s) => s.size),
      [0, 0],
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
      [["a"], ["a"]],
    );
  });
});
