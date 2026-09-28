import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import type { LimitesDeBarrios } from "./barrio.ts";
import { type EmplazamientoDeCapa, versionDeCapa } from "./capa.ts";
import { distanciaALoBarrido, type ZonaBarrida } from "./cobertura.ts";
import type { Ficha } from "./ficha.ts";
import {
  indexarMunicipios,
  type LimitesDeMunicipios,
  municipiosConHabitantes,
} from "./municipio.ts";
import {
  cajaDeSituados,
  companiasDeSituados,
  type DatosDeProvincia,
  ficheroDeCapaDeProvincia,
  ficheroDeLoteDeProvincia,
  ficheroDeManifiesto,
  ficheroDeResumen,
  type FuentesDeZonas,
  generarCapaDeProvincia,
  generarLoteDeProvincia,
  generarResumen,
  leerCapaDeProvincia,
  leerLoteDeProvincia,
  leerResumen,
  situarEmplazamientos,
} from "./provincias.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15, 3);
const VERSION = versionDeCapa(NOCHE);
const POR_GRADO = 100_000;

/** Un rectángulo cerrado como un solo arco, codificado como en el fichero. */
const rectangulo = (oeste: number, sur: number, este: number, norte: number) => {
  const vertices = [
    [oeste, sur],
    [este, sur],
    [este, norte],
    [oeste, norte],
    [oeste, sur],
  ].flatMap(([x = 0, y = 0]) => [Math.round(x * POR_GRADO), Math.round(y * POR_GRADO)]);
  return vertices.map((valor, k) => (k < 2 ? valor : valor - (vertices[k - 2] ?? 0)));
};

const FUENTE_IGN = {
  atribucion: "Instituto Geográfico Nacional",
  producto: "Base de Datos de Límites Jurisdiccionales de España",
  licencia: "CC BY 4.0",
  enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
  fecha: "2026-08-10",
  huella: "sha256-prueba",
};

// Dos municipios de Barcelona uno junto a otro, uno de Girona más al norte y un territorio
// compartido de Girona. Tarragona no tiene ningún recinto: solo su etiqueta.
const LIMITES: LimitesDeMunicipios = {
  fuente: FUENTE_IGN,
  toleranciaMetros: 50,
  unidadesPorGrado: POR_GRADO,
  provincias: [
    { codigo: "08", nombre: "Barcelona", etiqueta: { longitud: 2.1, latitud: 41.4 } },
    { codigo: "17", nombre: "Girona", etiqueta: { longitud: 2.8, latitud: 42 } },
    { codigo: "43", nombre: "Tarragona", etiqueta: { longitud: 1, latitud: 41 } },
  ],
  territorios: [
    {
      codigo: "08019",
      tipo: "municipio",
      nombre: "Barcelona",
      provincia: "08",
      etiqueta: { longitud: 2.15, latitud: 41.4 },
      areaKm2: 101.354,
      poligonos: [[[0]]],
    },
    {
      codigo: "08101",
      tipo: "municipio",
      nombre: "L'Hospitalet de Llobregat",
      provincia: "08",
      etiqueta: { longitud: 2.05, latitud: 41.4 },
      areaKm2: 12.4,
      poligonos: [[[1]]],
    },
    {
      codigo: "17079",
      tipo: "municipio",
      nombre: "Girona",
      provincia: "17",
      etiqueta: { longitud: 2.8, latitud: 42 },
      areaKm2: 39.1,
      poligonos: [[[2]]],
    },
    {
      codigo: "53170000001",
      tipo: "compartido",
      nombre: "Comunidad de prueba",
      provincia: "17",
      etiqueta: { longitud: 2.9, latitud: 42 },
      areaKm2: 5,
      poligonos: [[[3]]],
    },
  ],
  arcos: [
    rectangulo(2.1, 41.3, 2.2, 41.5),
    rectangulo(2, 41.3, 2.1, 41.5),
    rectangulo(2.7, 41.9, 2.85, 42.1),
    rectangulo(2.85, 41.9, 3, 42.1),
  ],
};
const INDICE = indexarMunicipios(LIMITES);

const BARRIOS: LimitesDeBarrios = {
  fuente: {
    atribucion: "Ajuntament de Barcelona",
    licencia: "CC BY 4.0",
    enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
    fecha: "2024-11-12",
  },
  barrios: [
    {
      codigo: "21",
      nombre: "Pedralbes",
      etiqueta: { longitud: 2.11, latitud: 41.39 },
      poligonos: [
        [
          [
            [2.1, 41.38],
            [2.12, 41.38],
            [2.12, 41.4],
            [2.1, 41.4],
          ],
        ],
      ],
    },
  ],
};

const FUENTES: FuentesDeZonas = {
  barrios: BARRIOS.fuente,
  municipios: FUENTE_IGN,
  padron: {
    atribucion: "INE",
    licencia: "CC BY 4.0",
    enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
    referencia: "2025-01-01",
    publicada: "2025-12-11",
  },
};

const emplazamiento = (
  clave: string,
  longitud: number,
  latitud: number,
  companias: EmplazamientoDeCapa["companias"],
): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias,
});

const EN_PEDRALBES = emplazamiento("movistar-0802532", 2.11, 41.39, ["movistar", "orange"]);
const EN_BARCELONA = emplazamiento("vodafone-079808", 2.18, 41.45, ["vodafone"]);
const EN_HOSPITALET = emplazamiento("orange-CATR0508Z", 2.05, 41.36, ["orange"]);
const EN_GIRONA = emplazamiento("digi-1700001", 2.8, 42, ["digi"]);
const EN_LA_COMUNIDAD = emplazamiento("movistar-1700002", 2.9, 42, ["movistar"]);
/** En el mar, lejos de cualquier recinto: más cerca de la etiqueta de Tarragona. */
const EN_EL_MAR = emplazamiento("vodafone-4300001", 1.2, 40.6, ["vodafone"]);
const TODOS = [EN_PEDRALBES, EN_BARCELONA, EN_HOSPITALET, EN_GIRONA, EN_LA_COMUNIDAD, EN_EL_MAR];

const ficha = (e: EmplazamientoDeCapa): Ficha => ({
  clave: e.clave,
  posicion: e.posicion,
  direccion: "CL PRUEBA, 1",
  municipio: "PRUEBA",
  estado: e.estado,
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: NOCHE,
  version: NOCHE,
});

const CATALUNA: ZonaBarrida = {
  nombre: "Cataluña",
  cajas: [[0, 40.5, 3.4, 42.9]],
  provincias: ["08", "17", "25", "43"],
  barrido: NOCHE,
};
const CAJA_DE_BARCELONA: ZonaBarrida = {
  nombre: "Caja de Barcelona",
  cajas: [[2.052, 41.317, 2.229, 41.468]],
  provincias: [],
  barrido: NOCHE - 86_400_000,
};

describe("situar los emplazamientos por provincias", () => {
  it("cada uno va a la provincia de su municipio, y las provincias y sus listas van ordenadas", () => {
    const situados = situarEmplazamientos(TODOS.toReversed(), INDICE);
    assert.deepStrictEqual([...situados.keys()], ["08", "17", "43"]);
    assert.deepStrictEqual(
      situados.get("08")?.map((s) => [s.emplazamiento.clave, s.municipio]),
      [
        ["movistar-0802532", "08019"],
        ["orange-CATR0508Z", "08101"],
        ["vodafone-079808", "08019"],
      ],
    );
    const girona = situados.get("17") ?? [];
    assert.deepStrictEqual(
      girona.map((s) => [s.emplazamiento.clave, s.municipio, s.lugar.provincia?.codigo]),
      [
        ["digi-1700001", "17079", "17"],
        // En un territorio compartido: sin municipio, pero con provincia.
        ["movistar-1700002", null, "17"],
      ],
    );
  });

  it("uno sin provincia va a la de etiqueta más cercana, y su ficha no dice ninguna", () => {
    const [enElMar] = situarEmplazamientos([EN_EL_MAR], INDICE).get("43") ?? [];
    assert.strictEqual(enElMar?.provincia, "43");
    assert.deepStrictEqual(enElMar?.lugar, { municipio: null, provincia: null });
  });

  it("todo emplazamiento va en una provincia y solo en una", () => {
    const situados = [...situarEmplazamientos(TODOS, INDICE).values()].flat();
    assert.deepStrictEqual(
      situados.map((s) => s.emplazamiento.clave).toSorted(),
      TODOS.map((e) => e.clave).toSorted(),
    );
  });
});

describe("capa de una provincia", () => {
  const situados = situarEmplazamientos(TODOS, INDICE).get("08") ?? [];
  const lotes = [
    { fichero: ficheroDeLoteDeProvincia("08", "a".repeat(64)), claves: ["movistar-0802532"] },
    {
      fichero: ficheroDeLoteDeProvincia("08", "b".repeat(64)),
      claves: ["orange-CATR0508Z", "vodafone-079808"],
    },
  ];
  const padron = {
    fuente: FUENTES.padron,
    municipios: [{ codigo: "08019", habitantes: 1_702_547 }],
  };
  const municipios = municipiosConHabitantes(LIMITES, padron).filter((m) => m.provincia === "08");
  const contenido = generarCapaDeProvincia({
    provincia: "08",
    situados,
    barrios: BARRIOS,
    municipios,
    lotes,
  });

  it("lleva cada emplazamiento con su barrio, su municipio y el fichero de su lote", () => {
    const leida = leerCapaDeProvincia(contenido, "08");
    if (Result.isFailure(leida)) return assert.fail(leida.failure.message);
    const capa = leida.success;
    assert.deepStrictEqual(
      capa.emplazamientos.map((e) => [
        e.clave,
        e.barrio,
        e.municipio,
        e.provincia,
        capa.lotes[e.lote ?? -1],
      ]),
      [
        ["movistar-0802532", "21", "08019", "08", lotes[0]?.fichero],
        ["orange-CATR0508Z", null, "08101", "08", lotes[1]?.fichero],
        ["vodafone-079808", null, "08019", "08", lotes[1]?.fichero],
      ],
    );
    assert.deepStrictEqual(
      capa.barrios.map((b) => b.nombre),
      ["Pedralbes"],
    );
  });

  it("trae la tabla de municipios con sus habitantes y su número de emplazamientos", () => {
    const leida = leerCapaDeProvincia(contenido, "08");
    if (Result.isFailure(leida)) return assert.fail(leida.failure.message);
    assert.deepStrictEqual(
      leida.success.municipios.map((m) => [
        m.codigo,
        m.habitantes,
        m.areaKm2,
        m.emplazamientos,
        m.companias,
      ]),
      [
        ["08019", 1_702_547, 101.35, 2, ["movistar", "vodafone", "orange"]],
        ["08101", null, 12.4, 1, ["orange"]],
      ],
    );
  });

  it("sin barrios en la provincia no lleva su tabla ni su columna", () => {
    const girona = generarCapaDeProvincia({
      provincia: "17",
      situados: situarEmplazamientos(TODOS, INDICE).get("17") ?? [],
      barrios: BARRIOS,
      municipios: [],
      lotes: [{ fichero: "fichas/17/c.json", claves: ["digi-1700001", "movistar-1700002"] }],
    });
    assert.notInclude(girona, '"barrios"');
    const leida = leerCapaDeProvincia(girona, "17");
    assert.isTrue(Result.isSuccess(leida));
  });

  it("es la misma sea cual sea el orden de llegada, y no lleva la versión", () => {
    const otraVez = generarCapaDeProvincia({
      provincia: "08",
      situados: situarEmplazamientos(TODOS.toReversed(), INDICE).get("08") ?? [],
      barrios: BARRIOS,
      municipios: municipios.toReversed(),
      lotes,
    });
    assert.strictEqual(otraVez, contenido);
    assert.notInclude(contenido, "sitios@");
  });

  it("la capa de otra provincia no se da por buena", () => {
    const leida = leerCapaDeProvincia(contenido, "17");
    assert.isTrue(Result.isFailure(leida));
  });

  it("los nombres llevan la provincia y la huella, recortada", () => {
    assert.strictEqual(
      ficheroDeCapaDeProvincia("08", "0123456789abcdef0123"),
      "provincias/08/0123456789abcdef.json",
    );
    assert.strictEqual(
      ficheroDeLoteDeProvincia("17", "f".repeat(64)),
      `fichas/17/${"f".repeat(16)}.json`,
    );
  });
});

describe("lote de fichas de una provincia", () => {
  const lugares = new Map(
    (situarEmplazamientos(TODOS, INDICE).get("08") ?? []).map((s) => [
      s.emplazamiento.clave,
      s.lugar,
    ]),
  );

  it("lleva sus fichas por clave con su lugar, y la fuente una vez", () => {
    const contenido = generarLoteDeProvincia(
      "08",
      [ficha(EN_HOSPITALET), ficha(EN_PEDRALBES)],
      lugares,
      FUENTE_IGN,
    );
    assert.notInclude(contenido, "sitios@");
    const leidas = leerLoteDeProvincia(contenido, "08");
    if (Result.isFailure(leidas)) return assert.fail(leidas.failure.message);
    assert.deepStrictEqual(
      leidas.success.map((f) => [f.clave, f.lugar?.municipio?.codigo, f.lugar?.fuente?.producto]),
      [
        ["movistar-0802532", "08019", FUENTE_IGN.producto],
        ["orange-CATR0508Z", "08101", FUENTE_IGN.producto],
      ],
    );
  });

  it("un lote de otra provincia no se da por bueno", () => {
    const contenido = generarLoteDeProvincia("08", [ficha(EN_PEDRALBES)], lugares, FUENTE_IGN);
    assert.isTrue(Result.isFailure(leerLoteDeProvincia(contenido, "17")));
  });
});

describe("resumen nacional", () => {
  const situados = situarEmplazamientos(TODOS, INDICE);
  const provincias: ReadonlyArray<DatosDeProvincia> = LIMITES.provincias.map((p) => {
    const suyos = situados.get(p.codigo) ?? [];
    return {
      codigo: p.codigo,
      nombre: p.nombre,
      etiqueta: p.etiqueta,
      caja: cajaDeSituados(suyos),
      emplazamientos: suyos.length,
      companias: companiasDeSituados(suyos),
      fichero: suyos.length === 0 ? undefined : ficheroDeCapaDeProvincia(p.codigo, p.codigo),
    };
  });

  it("empieza por la versión y trae cada provincia con su número, su caja y su capa", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
    });
    assert.isTrue(contenido.startsWith(`{"version":"${VERSION}","formato":5,`));
    const leido = leerResumen(contenido, VERSION);
    if (Result.isFailure(leido)) return assert.fail(leido.failure.message);
    assert.strictEqual(leido.success.fecha, NOCHE);
    assert.deepStrictEqual(
      leido.success.provincias.map((p) => [
        p.codigo,
        p.emplazamientos,
        p.companias,
        p.fichero,
        p.caja?.suroeste,
      ]),
      [
        [
          "08",
          3,
          ["movistar", "vodafone", "orange"],
          "provincias/08/08.json",
          { longitud: 2.05, latitud: 41.36 },
        ],
        ["17", 2, ["movistar", "digi"], "provincias/17/17.json", { longitud: 2.8, latitud: 42 }],
        ["43", 1, ["vodafone"], "provincias/43/43.json", { longitud: 1.2, latitud: 40.6 }],
      ],
    );
  });

  it("una provincia solo está cubierta si una zona la barre entera; el barrido es el de lo que la toca", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
    });
    const leido = Result.getOrUndefined(leerResumen(contenido, VERSION));
    assert.deepStrictEqual(
      leido?.provincias.map((p) => [p.codigo, p.cubierta, p.barrido]),
      [
        // La caja de Barcelona toca sus emplazamientos, pero no la barre entera.
        ["08", false, NOCHE - 86_400_000],
        ["17", false, null],
        ["43", false, null],
      ],
    );

    const conCataluna = Result.getOrUndefined(
      leerResumen(
        generarResumen({
          version: VERSION,
          fuentes: FUENTES,
          cobertura: [CAJA_DE_BARCELONA, CATALUNA],
          provincias,
        }),
        VERSION,
      ),
    );
    assert.deepStrictEqual(
      conCataluna?.provincias.map((p) => [p.codigo, p.cubierta, p.barrido]),
      [
        ["08", true, NOCHE],
        ["17", true, NOCHE],
        ["43", true, NOCHE],
      ],
    );
  });

  it("se puede rehacer desde el leído con otra cobertura sin volver a los datos", () => {
    const antes = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
    });
    const leido = Result.getOrUndefined(leerResumen(antes, VERSION));
    if (leido === undefined) return assert.fail("no se lee");
    const rehecho = generarResumen({
      version: VERSION,
      fuentes: leido.fuentes,
      cobertura: [CATALUNA],
      provincias: leido.provincias,
    });
    assert.strictEqual(
      rehecho,
      generarResumen({ version: VERSION, fuentes: FUENTES, cobertura: [CATALUNA], provincias }),
    );
  });

  it("uno de otra versión no se da por bueno", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [],
      provincias,
    });
    const leido = leerResumen(contenido, versionDeCapa(NOCHE + 1000));
    assert.isTrue(Result.isFailure(leido));
  });

  it("los nombres de la versión llevan su sello", () => {
    assert.strictEqual(
      ficheroDeResumen(VERSION, "0123456789abcdef9999"),
      "resumen@2026-09-26T02:15:03Z.0123456789abcdef.json",
    );
    assert.strictEqual(ficheroDeManifiesto(VERSION), "ficheros@2026-09-26T02:15:03Z.json");
  });
});

describe("hasta dónde llegan los datos", () => {
  it("un punto en una caja barrida está a 0 m; fuera, a la distancia de la más cercana", () => {
    assert.strictEqual(
      distanciaALoBarrido({ longitud: 2.15, latitud: 41.4 }, [CAJA_DE_BARCELONA]),
      0,
    );
    const girona = distanciaALoBarrido({ longitud: 2.82, latitud: 41.98 }, [CAJA_DE_BARCELONA]);
    assert.isAbove(girona ?? 0, 60_000);
    assert.isUndefined(distanciaALoBarrido({ longitud: 2.82, latitud: 41.98 }, []));
  });
});
