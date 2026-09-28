import * as Effect from "effect/Effect";

/**
 * Ficheros de prueba con la forma de los de verdad: el GML de unidades administrativas del IGN y
 * el ZIP en que llega.
 */

/** Un vértice en grados, longitud y latitud. */
export type Vertice = readonly [number, number];

/** Una unidad administrativa de prueba: sus polígonos con sus anillos cerrados, en grados. */
export interface UnidadDePrueba {
  readonly codigoNacional: string;
  readonly nombre: string;
  readonly poligonos: ReadonlyArray<ReadonlyArray<ReadonlyArray<Vertice>>>;
}

const SISTEMA = "http://www.opengis.net/def/crs/EPSG/0/4258";

/** Un anillo como `gml:posList`, con latitud antes que longitud y seis decimales. */
const posList = (anillo: ReadonlyArray<Vertice>): string =>
  anillo.map(([x, y]) => `${y.toFixed(6)} ${x.toFixed(6)}`).join(" ");

const poligono = (anillos: ReadonlyArray<ReadonlyArray<Vertice>>, n: number): string => {
  const [exterior = [], ...agujeros] = anillos;
  return [
    `<gml:surfaceMember><gml:Polygon gml:id="GEOMETRY_${n}" srsName="${SISTEMA}">`,
    `<gml:exterior><gml:LinearRing><gml:posList>${posList(exterior)}</gml:posList></gml:LinearRing></gml:exterior>`,
    ...agujeros.map(
      (agujero) =>
        `<gml:interior><gml:LinearRing><gml:posList>${posList(agujero)}</gml:posList></gml:LinearRing></gml:interior>`,
    ),
    "</gml:Polygon></gml:surfaceMember>",
  ].join("\n");
};

/** Un GML de unidades administrativas como el de la descarga del IGN, con lo que se lee de él. */
export const gmlDe = (unidades: ReadonlyArray<UnidadDePrueba>): string =>
  [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="${unidades.length}" numberReturned="${unidades.length}">`,
    ...unidades.map((unidad, i) =>
      [
        "<wfs:member>",
        `<au:AdministrativeUnit gml:id="AU_ADMINISTRATIVEUNIT_${unidad.codigoNacional}">`,
        `<au:geometry><gml:MultiSurface gml:id="G${i}" srsName="${SISTEMA}">`,
        ...unidad.poligonos.map((anillos, k) => poligono(anillos, i * 100 + k)),
        "</gml:MultiSurface></au:geometry>",
        `<au:nationalCode>${unidad.codigoNacional}</au:nationalCode>`,
        `<au:name><gn:GeographicalName><gn:spelling><gn:SpellingOfName><gn:text>${unidad.nombre.replaceAll("&", "&amp;")}</gn:text></gn:SpellingOfName></gn:spelling></gn:GeographicalName></au:name>`,
        "</au:AdministrativeUnit>",
        "</wfs:member>",
      ].join("\n"),
    ),
    "</wfs:FeatureCollection>",
  ].join("\n");

/** Un rectángulo cerrado, en el sentido contrario a las agujas del reloj. */
export const rectangulo = (
  oeste: number,
  sur: number,
  este: number,
  norte: number,
): ReadonlyArray<Vertice> => [
  [oeste, sur],
  [este, sur],
  [este, norte],
  [oeste, norte],
  [oeste, sur],
];

const u16 = (valor: number) => [valor & 0xff, (valor >>> 8) & 0xff];
const u32 = (valor: number) => [...u16(valor & 0xff_ff), ...u16(valor >>> 16)];

/**
 * Un ZIP con estos ficheros comprimidos con deflate, sin CRC: el lector de Celda no lo mira.
 */
export const zipDe = (ficheros: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function* () {
    const locales: Array<number> = [];
    const central: Array<number> = [];
    for (const [nombre, contenido] of ficheros) {
      const datos = new TextEncoder().encode(contenido);
      const comprimidos = new Uint8Array(
        yield* Effect.promise(() =>
          new Response(
            new Blob([datos]).stream().pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        ),
      );
      const bytesNombre = [...new TextEncoder().encode(nombre)];
      const comun = [
        ...u16(20),
        ...u16(0),
        ...u16(8),
        ...u32(0),
        ...u32(0),
        ...u32(comprimidos.length),
        ...u32(datos.length),
        ...u16(bytesNombre.length),
        ...u16(0),
      ];
      central.push(
        ...u32(0x02_01_4b_50),
        ...u16(20),
        ...comun,
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(locales.length),
        ...bytesNombre,
      );
      locales.push(...u32(0x04_03_4b_50), ...comun, ...bytesNombre, ...comprimidos);
    }
    const fin = [
      ...u32(0x06_05_4b_50),
      ...u16(0),
      ...u16(0),
      ...u16(ficheros.length),
      ...u16(ficheros.length),
      ...u32(central.length),
      ...u32(locales.length),
      ...u16(0),
    ];
    return new Uint8Array([...locales, ...central, ...fin]);
  });

/**
 * Los municipios de prueba: A y B comparten un límite en diagonal, B linda con un territorio
 * compartido de Burgos, y aparte hay un territorio sin provincia.
 */
export const GML_MUNICIPIOS_DE_PRUEBA = gmlDe([
  {
    codigoNacional: "34090808002",
    nombre: "Municipio B",
    poligonos: [
      [
        [
          [2.02, 41],
          [2.05, 41],
          [2.05, 41.02],
          [2.03, 41.02],
          [2.02, 41],
        ],
      ],
    ],
  },
  {
    codigoNacional: "34090808001",
    nombre: "Municipio A",
    poligonos: [
      [
        [
          [2, 41],
          [2.02, 41],
          [2.03, 41.02],
          [2, 41.02],
          [2, 41],
        ],
      ],
    ],
  },
  {
    codigoNacional: "34070953005",
    nombre: "Comunidad de prueba",
    poligonos: [[rectangulo(2.05, 41, 2.07, 41.02)]],
  },
  {
    codigoNacional: "34205454001",
    nombre: "Territorio sin provincia",
    poligonos: [[rectangulo(2.5, 41, 2.52, 41.02)]],
  },
]);

/** Las provincias de prueba, con la de los territorios no asociados. */
export const GML_PROVINCIAS_DE_PRUEBA = gmlDe([
  {
    codigoNacional: "34090800000",
    nombre: "Barcelona",
    poligonos: [[rectangulo(2, 41, 2.05, 41.02)]],
  },
  {
    codigoNacional: "34070900000",
    nombre: "Burgos",
    poligonos: [[rectangulo(2.05, 41, 2.07, 41.02)]],
  },
  {
    codigoNacional: "34205400000",
    nombre: "Territorios no asociados a ninguna provincia",
    poligonos: [[rectangulo(2.5, 41, 2.52, 41.02)]],
  },
]);

/** La fuente de los límites de prueba. */
export const FUENTE_DE_PRUEBA = {
  atribucion: "Instituto Geográfico Nacional",
  producto: "Base de Datos de Límites Jurisdiccionales de España",
  licencia: "CC BY 4.0",
  enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
  fecha: "2026-08-10",
  huella: "sha256:prueba",
};

/**
 * El CSV de la tabla 29005 del INE para los municipios de prueba: con BOM, punto y coma, miles
 * con punto, varios años y un código antiguo sin valor en el último.
 */
export const CSV_DE_PRUEBA = [
  "﻿Municipios;Sexo;Periodo;Total",
  "08001 Municipio A;Total;2025;1.234",
  "08001 Municipio A;Hombres;2025;600",
  "08001 Municipio A;Total;2024;1.200",
  "08002 Municipio B;Total;2025;56",
  "08002 Municipio B;Total;2024;50",
  '08999 Municipio antiguo;Total;2025;""',
  "08999 Municipio antiguo;Total;2024;10",
  "",
].join("\r\n");

/** El canal ATOM del IGN, con lo que se lee de él. */
export const canalDePrueba = (derechos = "CC BY 4.0 ign.es") =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="es">',
    "  <title>Base de Datos de Límites Jurisdiccionales de España</title>",
    `  <rights>${derechos}</rights>`,
    "  <updated>2026-08-10T15:00:00Z</updated>",
    "  <entry>",
    "    <title>Límites Jurisdiccionales de España | application/gml+xml | ETRS89</title>",
    "    <updated>2026-08-10T15:00:00Z</updated>",
    '    <link rel="alternate" href="https://centrodedescargas.cnig.es/CentroDescargas/documentos/atom/au/lineas_limite_gml.zip" type="application/gml+xml"/>',
    "  </entry>",
    "</feed>",
  ].join("\n");

/** Un trozo del aviso legal del INE con su licencia. */
export const AVISO_DE_PRUEBA =
  '<p>La licencia de uso de la información estadística de este sitio web es la <a href="https://creativecommons.org/licenses/by/4.0/deed.es">Creative Commons Reconocimiento 4.0</a> (CC BY 4.0).</p>';
