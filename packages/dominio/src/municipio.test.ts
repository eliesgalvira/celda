import { assert, describe, it } from "@effect/vitest";

import { dentroDelPoligono } from "./barrio.ts";
import {
  indexarMunicipios,
  type LimitesDeMunicipios,
  lugarDelPunto,
  municipioDelPunto,
  municipiosConHabitantes,
  type Territorio,
} from "./municipio.ts";

const POR_GRADO = 100_000;

/** Un arco con sus vértices en grados, codificado como en el fichero. */
const arco = (...vertices: ReadonlyArray<readonly [number, number]>): ReadonlyArray<number> => {
  const enteros = vertices.flatMap(([x, y]) => [
    Math.round(x * POR_GRADO),
    Math.round(y * POR_GRADO),
  ]);
  return enteros.map((valor, k) => (k < 2 ? valor : valor - (enteros[k - 2] ?? 0)));
};

/** Un rectángulo cerrado como un solo arco. */
const rectangulo = (oeste: number, sur: number, este: number, norte: number) =>
  arco([oeste, sur], [este, sur], [este, norte], [oeste, norte], [oeste, sur]);

const ARCOS = [
  // 0: el límite en diagonal entre A y B.
  arco([2.02, 41], [2.03, 41.02]),
  // 1: el resto de A.
  arco([2.03, 41.02], [2, 41.02], [2, 41], [2.02, 41]),
  // 2 a 4: el resto de B; el 3 es su límite con el territorio compartido C.
  arco([2.02, 41], [2.05, 41]),
  arco([2.05, 41], [2.05, 41.02]),
  arco([2.05, 41.02], [2.03, 41.02]),
  // 5: el resto de C.
  arco([2.05, 41], [2.07, 41], [2.07, 41.02], [2.05, 41.02]),
  // 6 y 7: D y el hueco que llena el enclave E.
  rectangulo(2.1, 41, 2.2, 41.1),
  rectangulo(2.14, 41.04, 2.16, 41.06),
  // 8 y 9: F y su hueco sin llenar.
  rectangulo(2.3, 41, 2.4, 41.1),
  rectangulo(2.34, 41.04, 2.36, 41.06),
  // 10: un territorio sin provincia.
  rectangulo(2.5, 41, 2.52, 41.02),
  // 11 y 12: Ceuta y Melilla.
  rectangulo(-5.35, 35.87, -5.28, 35.92),
  rectangulo(-2.97, 35.26, -2.92, 35.31),
  // 13 y 14: un municipio en dos islas.
  rectangulo(-16.5, 28, -16.4, 28.1),
  rectangulo(-16.3, 28, -16.2, 28.1),
];

const territorio = (
  codigo: string,
  tipo: Territorio["tipo"],
  provincia: string | null,
  poligonos: Territorio["poligonos"],
): Territorio => ({
  codigo,
  tipo,
  nombre: `Recinto ${codigo}`,
  provincia,
  etiqueta: { longitud: 0, latitud: 0 },
  areaKm2: 1,
  poligonos,
});

const LIMITES: LimitesDeMunicipios = {
  fuente: {
    atribucion: "Instituto Geográfico Nacional",
    producto: "Base de Datos de Límites Jurisdiccionales de España",
    licencia: "CC BY 4.0",
    enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
    fecha: "2026-08-10",
    huella: "sha256-prueba",
  },
  toleranciaMetros: 50,
  unidadesPorGrado: POR_GRADO,
  provincias: [
    { codigo: "01", nombre: "Araba/Álava", etiqueta: { longitud: 2.15, latitud: 41.02 } },
    { codigo: "08", nombre: "Barcelona", etiqueta: { longitud: 2.03, latitud: 41.01 } },
    { codigo: "09", nombre: "Burgos", etiqueta: { longitud: 2.06, latitud: 41.01 } },
    { codigo: "38", nombre: "Santa Cruz de Tenerife", etiqueta: { longitud: -16.45, latitud: 28 } },
    { codigo: "51", nombre: "Ceuta", etiqueta: { longitud: -5.3, latitud: 35.89 } },
    { codigo: "52", nombre: "Melilla", etiqueta: { longitud: -2.94, latitud: 35.29 } },
  ],
  territorios: [
    territorio("01001", "municipio", "01", [[[6], [~7]]]),
    territorio("08001", "municipio", "08", [[[0, 1]]]),
    territorio("08002", "municipio", "08", [[[~0, 2, 3, 4]]]),
    territorio("08003", "municipio", "08", [[[8], [9]]]),
    territorio("09001", "municipio", "09", [[[7]]]),
    territorio("34070953005", "compartido", "09", [[[~3, 5]]]),
    territorio("34205454001", "sin-provincia", null, [[[10]]]),
    territorio("38001", "municipio", "38", [[[13]], [[14]]]),
    territorio("51001", "municipio", "51", [[[11]]]),
    territorio("52001", "municipio", "52", [[[12]]]),
  ],
  arcos: ARCOS,
};

const INDICE = indexarMunicipios(LIMITES);

const punto = (longitud: number, latitud: number) => ({ longitud, latitud });

/** Los códigos del municipio y de la provincia en que cae un punto. */
const codigos = (longitud: number, latitud: number) => {
  const { municipio, provincia } = municipioDelPunto(punto(longitud, latitud), INDICE);
  return [municipio?.codigo, provincia?.codigo];
};

describe("municipio y provincia de un punto", () => {
  it("un punto dentro de un municipio cae en él y en su provincia", () => {
    assert.deepStrictEqual(codigos(2.005, 41.01), ["08001", "08"]);
    assert.deepStrictEqual(codigos(2.045, 41.01), ["08002", "08"]);
  });

  it("los anillos se rehacen con los arcos compartidos, recorridos en el sentido que toca", () => {
    const [b] = INDICE.poligonosDe(2);
    assert.deepStrictEqual(b?.[0], [
      [2.03, 41.02],
      [2.02, 41],
      [2.05, 41],
      [2.05, 41.02],
      [2.03, 41.02],
    ]);
  });

  it("un punto sobre el límite entre dos municipios cae en uno solo, sea cual sea el orden", () => {
    // El límite es diagonal: el corte del rayo no es exacto, y cada vecino recorre el lado en un
    // sentido distinto.
    const alReves = indexarMunicipios({
      ...LIMITES,
      territorios: LIMITES.territorios.toReversed(),
    });
    for (const [x, y] of [
      [2.025, 41.01],
      [2.0275, 41.015],
      [2.02125, 41.0025],
      [2.02, 41],
    ] as const) {
      const dentro = [1, 2].filter((i) =>
        INDICE.poligonosDe(i).some((poligono) => dentroDelPoligono(punto(x, y), poligono)),
      );
      assert.lengthOf(dentro, 1, `(${x}, ${y})`);
      assert.include(["08001", "08002"], codigos(x, y)[0]);
      assert.strictEqual(
        municipioDelPunto(punto(x, y), alReves).municipio?.codigo,
        codigos(x, y)[0],
      );
    }
  });

  it("un territorio compartido no tiene municipio, pero sí la provincia del territorio", () => {
    assert.deepStrictEqual(codigos(2.06, 41.01), [undefined, "09"]);
  });

  it("un enclave es de su municipio y de su provincia, no del que lo rodea", () => {
    assert.deepStrictEqual(codigos(2.15, 41.05), ["09001", "09"]);
    assert.deepStrictEqual(codigos(2.12, 41.05), ["01001", "01"]);
  });

  it("el hueco de un municipio no es suyo, salvo a 200 m o menos de su borde", () => {
    // A 0,0015° de longitud del borde del hueco: unos 126 m.
    assert.deepStrictEqual(codigos(2.3415, 41.05), ["08003", "08"]);
    // En el centro del hueco, a más de un kilómetro de cualquier borde.
    assert.deepStrictEqual(codigos(2.35, 41.05), [undefined, undefined]);
  });

  it("un punto en el mar a menos de 200 m de la costa va al municipio más cercano", () => {
    // 0,001° de latitud al sur de A son unos 111 m; 0,003°, unos 334 m.
    assert.deepStrictEqual(codigos(2.01, 40.999), ["08001", "08"]);
    assert.deepStrictEqual(codigos(2.01, 40.997), [undefined, undefined]);
    // Frente a B y más lejos de A, va a B.
    assert.deepStrictEqual(codigos(2.04, 40.9985), ["08002", "08"]);
  });

  it("en un territorio sin provincia, o en el mar junto a él, no hay municipio ni provincia", () => {
    assert.deepStrictEqual(codigos(2.51, 41.01), [undefined, undefined]);
    assert.deepStrictEqual(codigos(2.51, 40.999), [undefined, undefined]);
  });

  it("Ceuta y Melilla son municipio y provincia a la vez, al oeste del meridiano cero", () => {
    assert.deepStrictEqual(codigos(-5.31, 35.89), ["51001", "51"]);
    assert.deepStrictEqual(codigos(-2.94, 35.29), ["52001", "52"]);
  });

  it("un municipio en varias islas recoge los puntos de todas", () => {
    assert.deepStrictEqual(codigos(-16.45, 28.05), ["38001", "38"]);
    assert.deepStrictEqual(codigos(-16.25, 28.05), ["38001", "38"]);
    assert.deepStrictEqual(codigos(-16.35, 28.05), [undefined, undefined]);
  });

  it("lejos de todo recinto no hay municipio ni provincia", () => {
    assert.deepStrictEqual(codigos(10, 50), [undefined, undefined]);
  });

  it("el lugar de la ficha lleva el código y el nombre, o null", () => {
    assert.deepStrictEqual(lugarDelPunto(punto(2.005, 41.01), INDICE), {
      municipio: { codigo: "08001", nombre: "Recinto 08001" },
      provincia: { codigo: "08", nombre: "Barcelona" },
    });
    assert.deepStrictEqual(lugarDelPunto(punto(2.06, 41.01), INDICE), {
      municipio: null,
      provincia: { codigo: "09", nombre: "Burgos" },
    });
  });
});

describe("municipios con habitantes", () => {
  it("cruza por código, solo los municipios, y deja null los que no están en el padrón", () => {
    const municipios = municipiosConHabitantes(LIMITES, {
      fuente: {
        atribucion: "INE",
        licencia: "CC BY 4.0",
        enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
        referencia: "2025-01-01",
        publicada: "2025-12-11",
      },
      municipios: [
        { codigo: "08001", habitantes: 1200 },
        { codigo: "51001", habitantes: 83_595 },
      ],
    });
    assert.deepStrictEqual(
      municipios.map((m) => [m.codigo, m.provincia, m.habitantes]),
      [
        ["01001", "01", null],
        ["08001", "08", 1200],
        ["08002", "08", null],
        ["08003", "08", null],
        ["09001", "09", null],
        ["38001", "38", null],
        ["51001", "51", 83_595],
        ["52001", "52", null],
      ],
    );
  });
});
