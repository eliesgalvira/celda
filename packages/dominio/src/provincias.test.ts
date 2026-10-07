import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import type { LimitesDeBarrios } from "./barrio.ts";
import { type EmplazamientoDeCapa, versionDeCapa } from "./capa.ts";
import { cajaDeCuadro, zonaDeBarrido } from "./barrido.ts";
import {
  cuadrosDeProvincias,
  distanciaALoBarrido,
  distanciaALosDatos,
  type ZonaBarrida,
} from "./cobertura.ts";
import { EstacionDeFicha, Ficha } from "./ficha.ts";
import { contarConFiltro } from "./filtro.ts";
import {
  indexarMunicipios,
  type LimitesDeMunicipios,
  municipiosConHabitantes,
} from "./municipio.ts";
import {
  type CapaDeProvincia,
  capaConNombresDeLugar,
  cajaDeSituados,
  combinacionesDeSituados,
  companiasDeSituados,
  type DatosDeProvincia,
  ficheroDeCapaDeProvincia,
  ficheroDeLoteDeProvincia,
  ficheroDeManifiesto,
  ficheroDeResumen,
  FORMATO_PROVINCIAS,
  type FuentesDeZonas,
  ficheroDeIndiceDeClaves,
  generarCapaDeProvincia,
  generarIndiceDeClaves,
  generarLoteDeProvincia,
  generarResumen,
  leerCapaDeProvincia,
  leerLoteDeProvincia,
  leerParteDelIndice,
  leerResumen,
  type MunicipioDeCapa,
  parteDeClave,
  PARTES_DEL_INDICE,
  situarEnLaParte,
  resumenConNombresDeLugar,
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
    rectangulo(2.85, 41.9, 2.98, 42.1),
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
  capitales: {
    atribucion: "Instituto Geográfico Nacional",
    producto: "Nomenclátor Geográfico Básico de España",
    licencia: "CC BY 4.0",
    enlace: "https://www.ign.es/wfs-inspire/ngbe?service=WFS&request=GetCapabilities",
    fecha: "2026-05-28",
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
  nombre: "cataluna",
  titulo: "Cataluña",
  cajas: (zonaDeBarrido("cataluna")?.cuadros ?? []).map(cajaDeCuadro),
  barrido: NOCHE,
};
const CAJA_DE_BARCELONA: ZonaBarrida = {
  nombre: "registro-oficial",
  titulo: "Caja de Barcelona",
  cajas: [[2.052, 41.317, 2.229, 41.468]],
  barrido: NOCHE - 86_400_000,
};
/** Los cuadros con datos que toca cada provincia de los límites de prueba. */
const CUADROS = cuadrosDeProvincias(INDICE);

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
  // La capital de Barcelona queda a 1,4 km de un emplazamiento y a 7,5 km del de Pedralbes;
  // L'Hospitalet no tiene.
  const capitales = {
    capitales: [
      { codigo: "08019", nombre: "Barcelona", posicion: { longitud: 2.17, latitud: 41.44 } },
    ],
  };
  const municipios = municipiosConHabitantes(LIMITES, padron, capitales).filter(
    (m) => m.provincia === "08",
  );
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

  it("pone cada municipio en la media de sus emplazamientos junto a la capital, o en su etiqueta sin capital", () => {
    const leida = leerCapaDeProvincia(contenido, "08");
    if (Result.isFailure(leida)) return assert.fail(leida.failure.message);
    assert.deepStrictEqual(
      leida.success.municipios.map((m) => [m.codigo, m.etiqueta]),
      [
        ["08019", EN_BARCELONA.posicion],
        ["08101", { longitud: 2.05, latitud: 41.4 }],
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

describe("capa de una provincia con el nombre de lugar", () => {
  it("cada municipio lleva el suyo, en una sola forma, con su código", () => {
    const municipio = (codigo: string, nombre: string): MunicipioDeCapa => ({
      codigo,
      nombre,
      etiqueta: { longitud: -0.7, latitud: 38.27 },
      habitantes: 1,
      areaKm2: 1,
      emplazamientos: 4,
      companias: [],
    });
    const capa: CapaDeProvincia = {
      provincia: "03",
      emplazamientos: [],
      barrios: [],
      fuenteDeBarrios: undefined,
      municipios: [municipio("03065", "Elx/Elche"), municipio("03031", "Benidorm")],
      lotes: [],
    };
    assert.deepStrictEqual(
      capaConNombresDeLugar(capa).municipios.map((m) => [m.codigo, m.nombre]),
      [
        ["03065", "Elx"],
        ["03031", "Benidorm"],
      ],
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

  const orange: EstacionDeFicha = {
    compania: "orange",
    codigos: ["CLMR6422A"],
    bandas: [],
    origenes: [],
  };
  const medida = { distanciaMetros: 80, acimutGrados: 175, microvatiosPorCm2: 0.98806 };

  it("un lote lleva la marca de sin ficha y las medidas de las estaciones que las tienen", () => {
    const contenido = generarLoteDeProvincia(
      "08",
      [
        {
          ...ficha(EN_PEDRALBES),
          estaciones: [
            { compania: "movistar", codigos: ["0802532"], bandas: [], origenes: [] },
            { ...orange, sinFichaEnRegistro: NOCHE, medidasDeExposicion: [medida] },
          ],
        },
      ],
      lugares,
      FUENTE_IGN,
    );
    const leido = leerLoteDeProvincia(contenido, "08");
    if (Result.isFailure(leido)) return assert.fail(leido.failure.message);
    assert.deepStrictEqual(
      leido.success[0]?.estaciones.map((e) => [e.sinFichaEnRegistro, e.medidasDeExposicion]),
      [
        [undefined, undefined],
        [NOCHE, [medida]],
      ],
    );
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
      cuadros: CUADROS,
    });
    assert.isTrue(contenido.startsWith(`{"version":"${VERSION}","formato":${FORMATO_PROVINCIAS},`));
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

  it("una provincia está cubierta si se han barrido todos sus cuadros con datos", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
      cuadros: CUADROS,
    });
    const leido = Result.getOrUndefined(leerResumen(contenido, VERSION));
    assert.deepStrictEqual(
      leido?.provincias.map((p) => [p.codigo, p.cubierta, p.barrido]),
      [
        // La caja de Barcelona toca sus emplazamientos, pero no barre ningún cuadro entero.
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
          cuadros: CUADROS,
        }),
        VERSION,
      ),
    );
    assert.deepStrictEqual(
      conCataluna?.provincias.map((p) => [p.codigo, p.cubierta, p.barrido]),
      [
        ["08", true, NOCHE],
        ["17", true, NOCHE],
        // Sin límites en la prueba no toca ningún cuadro: no se sabe nada de ella.
        ["43", false, null],
      ],
    );
  });

  it("el leído guarda el nombre oficial, y la web enseña el de lugar, en una sola forma", () => {
    const conBilingue = provincias.map((p) =>
      p.codigo === "43" ? { ...p, codigo: "46", nombre: "València/Valencia" } : p,
    );
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias: conBilingue,
      cuadros: CUADROS,
    });
    const leido = Result.getOrUndefined(leerResumen(contenido, VERSION));
    if (leido === undefined) return assert.fail("no se lee");
    assert.deepStrictEqual(
      leido.provincias.map((p) => p.nombre),
      ["Barcelona", "Girona", "València/Valencia"],
    );
    assert.deepStrictEqual(
      resumenConNombresDeLugar(leido).provincias.map((p) => [p.codigo, p.nombre]),
      [
        ["08", "Barcelona"],
        ["17", "Girona"],
        ["46", "València"],
      ],
    );
  });

  it("se puede rehacer desde el leído con otra cobertura sin volver a los datos", () => {
    const antes = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
      cuadros: CUADROS,
    });
    const leido = Result.getOrUndefined(leerResumen(antes, VERSION));
    if (leido === undefined) return assert.fail("no se lee");
    const rehecho = generarResumen({
      version: VERSION,
      fuentes: leido.fuentes,
      cobertura: [CATALUNA],
      provincias: leido.provincias,
      cuadros: CUADROS,
    });
    assert.strictEqual(
      rehecho,
      generarResumen({
        version: VERSION,
        fuentes: FUENTES,
        cobertura: [CATALUNA],
        provincias,
        cuadros: CUADROS,
      }),
    );
  });

  it("lleva las partes del índice de claves, y se rehace con ellas", () => {
    const claves = ["claves/0.json", "claves/1.json"];
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
      cuadros: CUADROS,
      claves,
    });
    const leido = Result.getOrUndefined(leerResumen(contenido, VERSION));
    assert.deepStrictEqual(leido?.claves, claves);
    // Uno de antes del índice se sigue leyendo, sin él.
    const sinIndice = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
      cuadros: CUADROS,
    });
    assert.notInclude(sinIndice, '"claves"');
    assert.isUndefined(Result.getOrUndefined(leerResumen(sinIndice, VERSION))?.claves);
  });

  // Las combinaciones de compañías no suben el formato (ADR 0026): la web de antes las ignora, la
  // de ahora lee los resúmenes de antes sin ellas, y unas que no cuadran no tumban el resumen.
  const conCombinaciones = provincias.map((p) => ({
    ...p,
    combinaciones: combinacionesDeSituados(situados.get(p.codigo) ?? []),
  }));

  it("lleva por provincia cuántos hay con cada combinación de compañías", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias: conCombinaciones,
      cuadros: CUADROS,
    });
    // Barcelona: Movistar y Orange (5), Vodafone (2) y Orange (4), uno de cada.
    assert.include(contenido, '"combinaciones":[[2,1,4,1,5,1],[1,1,8,1],[2,1]]');
    const leido = Result.getOrUndefined(leerResumen(contenido, VERSION));
    if (leido === undefined) return assert.fail("no se lee");
    assert.deepStrictEqual(
      leido.provincias.map((p) => [p.codigo, [...(p.combinaciones ?? [])]]),
      [
        [
          "08",
          [
            [2, 1],
            [4, 1],
            [5, 1],
          ],
        ],
        [
          "17",
          [
            [1, 1],
            [8, 1],
          ],
        ],
        ["43", [[2, 1]]],
      ],
    );
    assert.deepStrictEqual(
      contarConFiltro(leido.provincias[0]?.combinaciones ?? new Map(), ["orange"]),
      {
        propios: 2,
        redUsada: 0,
      },
    );
    // Rehecho desde el leído con otra cobertura, las conserva.
    const rehecho = generarResumen({
      version: VERSION,
      fuentes: leido.fuentes,
      cobertura: [CATALUNA],
      provincias: leido.provincias,
      cuadros: CUADROS,
    });
    assert.strictEqual(
      rehecho,
      generarResumen({
        version: VERSION,
        fuentes: FUENTES,
        cobertura: [CATALUNA],
        provincias: conCombinaciones,
        cuadros: CUADROS,
      }),
    );
  });

  it("un resumen sin combinaciones no las lleva, y si alguna provincia no las tiene no las lleva ninguna", () => {
    const sinEllas = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [CAJA_DE_BARCELONA],
      provincias,
      cuadros: CUADROS,
    });
    assert.notInclude(sinEllas, '"combinaciones"');
    const leido = Result.getOrUndefined(leerResumen(sinEllas, VERSION));
    assert.deepStrictEqual(
      leido?.provincias.map((p) => p.combinaciones),
      [undefined, undefined, undefined],
    );
    // Si alguna provincia no las tiene, no las lleva ninguna.
    const aMedias = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [],
      provincias: [...conCombinaciones.slice(0, 2), ...provincias.slice(2)],
      cuadros: CUADROS,
    });
    assert.notInclude(aMedias, '"combinaciones"');
  });

  it("unas combinaciones que no cuadran con su número se leen como si no estuvieran", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [],
      provincias: conCombinaciones,
      cuadros: CUADROS,
    }).replace('"combinaciones":[[2,1,4,1,5,1]', '"combinaciones":[[2,1,4,1,5,9]');
    const leido = leerResumen(contenido, VERSION);
    if (Result.isFailure(leido)) return assert.fail(leido.failure.message);
    assert.deepStrictEqual(
      leido.success.provincias.map((p) => [p.emplazamientos, p.combinaciones]),
      [
        [3, undefined],
        [2, undefined],
        [1, undefined],
      ],
    );
  });

  it("uno de otra versión no se da por bueno", () => {
    const contenido = generarResumen({
      version: VERSION,
      fuentes: FUENTES,
      cobertura: [],
      provincias,
      cuadros: CUADROS,
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

describe("índice de claves", () => {
  const situados = situarEmplazamientos(TODOS, INDICE);

  it("cada clave está en la parte que le toca, con su provincia, y solo en ella", () => {
    const partes = generarIndiceDeClaves(situados, 4);
    assert.lengthOf(partes, 4);
    const leidas = partes.map((parte) => Result.getOrUndefined(leerParteDelIndice(parte)));
    for (const e of TODOS) {
      const suya = parteDeClave(e.clave, 4);
      leidas.forEach((leida, i) => {
        assert.strictEqual(
          leida?.provincias.has(e.clave),
          i === suya,
          `${e.clave} en la parte ${i}`,
        );
      });
    }
    const todas = new Map(
      leidas.flatMap((leida) => [...(leida?.provincias ?? new Map<string, string>())]),
    );
    assert.deepStrictEqual(
      [...todas].toSorted(),
      [...situados]
        .flatMap(([p, suyos]) => suyos.map((s) => [s.emplazamiento.clave, p]))
        .toSorted(),
    );
  });

  it("no depende del orden de llegada, y una parte sin claves también se escribe", () => {
    const otraVez = situarEmplazamientos(TODOS.toReversed(), INDICE);
    assert.deepStrictEqual(generarIndiceDeClaves(otraVez), generarIndiceDeClaves(situados));
    const partes = generarIndiceDeClaves(situados, 64);
    assert.lengthOf(partes, 64);
    assert.isTrue(
      partes.some((p) => Result.getOrUndefined(leerParteDelIndice(p))?.provincias.size === 0),
    );
  });

  it("una clave que se juntó con otra lleva a la que la sustituye, en su provincia", () => {
    const [primera, segunda] = TODOS;
    if (primera === undefined || segunda === undefined) return assert.fail("sin emplazamientos");
    const anteriores = new Map([
      ["vodafone-viejo", primera.clave],
      // Una que lleva a una clave que no se publica no va.
      ["orange-viejo", "orange-que-no-esta"],
      // Ni una que vuelve a tener emplazamiento.
      [segunda.clave, primera.clave],
    ]);
    const partes = generarIndiceDeClaves(situados, 4, anteriores).map((parte) =>
      Result.getOrThrow(leerParteDelIndice(parte)),
    );
    const parteDe = (clave: string) => partes[parteDeClave(clave, 4)];
    const provincia = parteDe(primera.clave)?.provincias.get(primera.clave);
    assert.deepStrictEqual(
      situarEnLaParte(parteDe("vodafone-viejo") ?? partes[0]!, "vodafone-viejo"),
      {
        clave: primera.clave,
        provincia,
      },
    );
    assert.isUndefined(situarEnLaParte(parteDe("orange-viejo") ?? partes[0]!, "orange-viejo"));
    assert.deepStrictEqual(situarEnLaParte(parteDe(segunda.clave) ?? partes[0]!, segunda.clave), {
      clave: segunda.clave,
      provincia: parteDe(segunda.clave)?.provincias.get(segunda.clave),
    });
  });

  it("la parte de una clave es estable y sale de sus bytes en UTF-8", () => {
    // FNV-1a de 32 bits: el mismo número en la publicación y en la web, en cualquier máquina.
    assert.strictEqual(parteDeClave("", PARTES_DEL_INDICE), 0x811c_9dc5 % PARTES_DEL_INDICE);
    assert.strictEqual(parteDeClave("a", 1 << 30), 0xe40c_292c % (1 << 30));
    assert.notStrictEqual(parteDeClave("ñ", 1 << 30), parteDeClave("n", 1 << 30));
  });

  it("una parte mal formada no se da por buena, y el nombre lleva la huella", () => {
    assert.isTrue(
      Result.isFailure(
        leerParteDelIndice(`{"formato":${FORMATO_PROVINCIAS},"provincias":["08"],"claves":[]}`),
      ),
    );
    assert.strictEqual(
      ficheroDeIndiceDeClaves("0123456789abcdef9999"),
      "claves/0123456789abcdef.json",
    );
  });
});

describe("hasta dónde llegan los datos", () => {
  it("cada provincia toca los cuadros con datos en que caen sus límites", () => {
    assert.deepStrictEqual([...(CUADROS.get("08") ?? [])], ["2,41"]);
    assert.deepStrictEqual([...(CUADROS.get("17") ?? [])].toSorted(), ["2,41", "2,42"]);
    assert.isUndefined(CUADROS.get("43"));
  });

  it("una zona que aún no ha acabado ningún barrido no cuenta", () => {
    const sinAcabar = { ...CATALUNA, barrido: null };
    assert.isUndefined(distanciaALoBarrido({ longitud: 2.15, latitud: 41.4 }, [sinAcabar]));
  });

  it("un punto en una caja barrida está a 0 m; fuera, a la distancia de la más cercana", () => {
    assert.strictEqual(
      distanciaALoBarrido({ longitud: 2.15, latitud: 41.4 }, [CAJA_DE_BARCELONA]),
      0,
    );
    const girona = distanciaALoBarrido({ longitud: 2.82, latitud: 41.98 }, [CAJA_DE_BARCELONA]);
    assert.isAbove(girona ?? 0, 60_000);
    assert.isUndefined(distanciaALoBarrido({ longitud: 2.82, latitud: 41.98 }, []));
  });

  it("con la cobertura real, lo barrido se recorta a las cajas de los emplazamientos", () => {
    const barcelona = {
      caja: {
        suroeste: { longitud: 1.4, latitud: 41.2 },
        noreste: { longitud: 2.8, latitud: 42.3 },
      },
    };
    const girona = {
      caja: {
        suroeste: { longitud: 1.8, latitud: 41.6 },
        noreste: { longitud: 3.3, latitud: 42.45 },
      },
    };
    const alcance = { cobertura: [CATALUNA], provincias: [barcelona, girona, { caja: undefined }] };
    // Barcelona y Figueres, dentro.
    assert.strictEqual(distanciaALosDatos({ longitud: 2.17, latitud: 41.39 }, alcance), 0);
    assert.strictEqual(distanciaALosDatos({ longitud: 2.96, latitud: 42.27 }, alcance), 0);
    // Perpiñán está en un cuadro barrido de Cataluña, pero a 28 km del último emplazamiento.
    const perpinan = { longitud: 2.9, latitud: 42.7 };
    assert.strictEqual(distanciaALoBarrido(perpinan, [CATALUNA]), 0);
    assert.approximately(distanciaALosDatos(perpinan, alcance) ?? 0, 27_800, 500);
    // Sin ninguna zona barrida no se sabe.
    assert.isUndefined(distanciaALosDatos(perpinan, { ...alcance, cobertura: [] }));
    assert.isUndefined(
      distanciaALosDatos(perpinan, { cobertura: [CATALUNA], provincias: [{ caja: undefined }] }),
    );
  });
});
