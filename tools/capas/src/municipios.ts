import type { Poligono } from "@celda/dominio/barrio";
import type {
  FuenteDeMunicipios,
  LimitesDeMunicipios,
  PadronDeMunicipios,
  Provincia,
  Territorio,
  TipoDeTerritorio,
} from "@celda/dominio/municipio";
import { areaKm2, type FuenteDePoblacion } from "@celda/dominio/poblacion";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { puntoDeEtiqueta } from "./barrios.ts";
import { type AnilloEntero, MILLONESIMAS, type UnidadDelIgn } from "./gml.ts";
import { leerCsv } from "./poblacion.ts";
import { codificarArco, construirTopologia, simplificarArco } from "./topologia.ts";

/**
 * Municipios y provincias del IGN con los habitantes del padrón del INE (ADR 0017). Los límites
 * salen de la descarga masiva de la Base de Datos de Límites Jurisdiccionales y se guardan
 * simplificados a 50 m, con la topología; los habitantes, de la tabla 29005 del INE.
 */

/** Canal ATOM del conjunto de límites del IGN. */
export const CANAL_IGN = "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml";

/** Los dos ficheros del ZIP del IGN que se usan: municipios y provincias. */
export const GML_MUNICIPIOS = "au_AdministrativeUnit_4thOrder0.gml";
export const GML_PROVINCIAS = "au_AdministrativeUnit_3rdOrder0.gml";

/** La tabla del padrón en CSV, en `www.ine.es`, donde su `robots.txt` deja pedirla. */
export const CSV_PADRON = "https://www.ine.es/jaxiT3/files/t/es/csv_bdsc/29005.csv";
export const ENLACE_PADRON_INE = "https://www.ine.es/jaxiT3/Tabla.htm?t=29005";

/** Tolerancia de la simplificación (ADR 0017). */
export const TOLERANCIA_METROS = 50;

/** Resolución de los arcos guardados: cien milésimas de grado, un metro más o menos. */
const UNIDADES_POR_GRADO = 100_000;

/** Código de la «provincia» del IGN que junta los territorios que no son de ninguna. */
const SIN_PROVINCIA = "54";

/** Los límites o el padrón no son lo que se esperaba: se para antes de escribir nada. */
export class MunicipiosIlegibles extends Schema.TaggedError<MunicipiosIlegibles>()(
  "MunicipiosIlegibles",
  { motivo: Schema.String },
) {}

const ilegibles = (motivo: string) => new MunicipiosIlegibles({ motivo });

/** Un anillo en millonésimas como anillo en grados. */
const enGrados = (anillo: AnilloEntero): Poligono[number] => {
  const vertices: Array<readonly [number, number]> = [];
  for (let k = 0; k + 1 < anillo.length; k += 2) {
    vertices.push([(anillo[k] ?? 0) / MILLONESIMAS, (anillo[k + 1] ?? 0) / MILLONESIMAS]);
  }
  return vertices;
};

const poligonosEnGrados = (unidad: UnidadDelIgn): ReadonlyArray<Poligono> =>
  unidad.poligonos.map((anillos) => anillos.map(enGrados));

/** Qué es una unidad del IGN y con qué códigos se guarda. */
export interface Clasificacion {
  readonly tipo: TipoDeTerritorio;
  readonly codigo: string;
  readonly provincia: string | null;
}

/**
 * Qué es cada unidad según su código nacional, `34` + comunidad + provincia + cinco cifras. Es
 * un municipio si esas cinco cifras empiezan por la provincia, y entonces son su código INE.
 */
export const clasificar = (codigoNacional: string): Clasificacion => {
  const provincia = codigoNacional.slice(4, 6);
  if (provincia === SIN_PROVINCIA) {
    return { tipo: "sin-provincia", codigo: codigoNacional, provincia: null };
  }
  return codigoNacional.slice(6, 8) === provincia
    ? { tipo: "municipio", codigo: codigoNacional.slice(6, 11), provincia }
    : { tipo: "compartido", codigo: codigoNacional, provincia };
};

const porCodigo = <A extends { readonly codigo: string }>(a: A, b: A): number =>
  a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0;

/** Área con cuatro decimales, como la de los barrios. */
const redondearArea = (km2: number): number => Math.round(km2 * 1e4) / 1e4;

/**
 * Los límites de municipios y provincias a partir de las unidades de los dos GML del IGN. Falla
 * si un código se repite, si una provincia no está entre las unidades de provincia o si una
 * geometría no se puede partir en arcos. Es una función pura: las mismas unidades dan los mismos
 * límites, en el orden en que lleguen.
 */
export const limitesDelIgn = (
  municipios: ReadonlyArray<UnidadDelIgn>,
  provincias: ReadonlyArray<UnidadDelIgn>,
  fuente: FuenteDeMunicipios,
): Result.Result<LimitesDeMunicipios, MunicipiosIlegibles> => {
  const tablaDeProvincias: Array<Provincia> = provincias
    .flatMap((unidad) => {
      const codigo = unidad.codigoNacional.slice(4, 6);
      return codigo === SIN_PROVINCIA
        ? []
        : [{ codigo, nombre: unidad.nombre, etiqueta: puntoDeEtiqueta(poligonosEnGrados(unidad)) }];
    })
    .toSorted(porCodigo);
  const codigosDeProvincia = new Set(tablaDeProvincias.map((p) => p.codigo));
  if (codigosDeProvincia.size !== tablaDeProvincias.length) {
    return Result.fail(ilegibles("hay una provincia repetida"));
  }

  const ordenadas = municipios
    .map((unidad) => ({ unidad, ...clasificar(unidad.codigoNacional) }))
    .toSorted(porCodigo);
  const vistos = new Set<string>();
  for (const { codigo, provincia, unidad } of ordenadas) {
    if (vistos.has(codigo)) return Result.fail(ilegibles(`el código ${codigo} se repite`));
    vistos.add(codigo);
    if (provincia !== null && !codigosDeProvincia.has(provincia)) {
      return Result.fail(
        ilegibles(
          `${unidad.codigoNacional} ${unidad.nombre} es de la provincia ${provincia}, que no está`,
        ),
      );
    }
  }

  const topologia = Result.try({
    try: () => construirTopologia(ordenadas.map(({ unidad }) => unidad.poligonos)),
    catch: (causa) => ilegibles(causa instanceof Error ? causa.message : String(causa)),
  });
  if (Result.isFailure(topologia)) return Result.fail(topologia.failure);

  const territorios: Array<Territorio> = ordenadas.map(({ unidad, tipo, codigo, provincia }, i) => {
    const poligonos = poligonosEnGrados(unidad);
    return {
      codigo,
      tipo,
      nombre: unidad.nombre,
      provincia,
      etiqueta: puntoDeEtiqueta(poligonos),
      areaKm2: redondearArea(areaKm2(poligonos)),
      poligonos: topologia.success.recintos[i] ?? [],
    };
  });
  const divisor = MILLONESIMAS / UNIDADES_POR_GRADO;
  return Result.succeed({
    fuente,
    toleranciaMetros: TOLERANCIA_METROS,
    unidadesPorGrado: UNIDADES_POR_GRADO,
    provincias: tablaDeProvincias,
    territorios,
    arcos: topologia.success.arcos.map((arco) =>
      codificarArco(simplificarArco(arco, TOLERANCIA_METROS, MILLONESIMAS), divisor),
    ),
  });
};

const COLUMNAS_PADRON = ["Municipios", "Sexo", "Periodo", "Total"] as const;

/**
 * Los habitantes de cada municipio en el año más reciente del CSV de la tabla 29005 del INE. El
 * CSV va separado por punto y coma, con los miles separados por puntos («1.731.649») y una fila
 * por municipio, sexo y año. Los municipios sin valor ese año, que son códigos antiguos, se
 * descartan. Falla si faltan columnas o si un valor no es un número.
 */
export const padronDelIne = (
  csv: string,
  fuente: Omit<FuenteDePoblacion, "referencia">,
): Result.Result<PadronDeMunicipios, MunicipiosIlegibles> => {
  const filas = leerCsv(csv, ";");
  const [cabecera, ...resto] = filas;
  const posicion = COLUMNAS_PADRON.map((columna) => cabecera?.indexOf(columna) ?? -1);
  const falta = COLUMNAS_PADRON.find((_, k) => (posicion[k] ?? -1) < 0);
  if (falta !== undefined) return Result.fail(ilegibles(`el padrón no tiene la columna ${falta}`));
  const [enMunicipio = 0, enSexo = 0, enPeriodo = 0, enTotal = 0] = posicion;

  const porAnio = new Map<number, Map<string, number>>();
  for (const [i, fila] of resto.entries()) {
    if (fila[enSexo] !== "Total") continue;
    const codigo = /^(\d{5}) /u.exec(fila[enMunicipio] ?? "")?.[1];
    const anio = Number(fila[enPeriodo]);
    if (codigo === undefined || !Number.isInteger(anio)) {
      return Result.fail(ilegibles(`la fila ${i + 2} del padrón no se entiende`));
    }
    const valor = (fila[enTotal] ?? "").replaceAll(".", "");
    if (valor === "") continue;
    if (!/^\d+$/u.test(valor)) {
      return Result.fail(ilegibles(`la fila ${i + 2} del padrón no trae un número: «${valor}»`));
    }
    const delAnio = porAnio.get(anio) ?? new Map<string, number>();
    delAnio.set(codigo, Number(valor));
    porAnio.set(anio, delAnio);
  }
  const anio = Math.max(...porAnio.keys());
  const habitantes = porAnio.get(anio);
  if (habitantes === undefined) return Result.fail(ilegibles("el padrón no trae ningún año"));
  return Result.succeed({
    fuente: {
      atribucion: fuente.atribucion,
      licencia: fuente.licencia,
      enlace: fuente.enlace,
      referencia: `${anio}-01-01`,
      publicada: fuente.publicada,
    },
    municipios: [...habitantes]
      .map(([codigo, cuantos]) => ({ codigo, habitantes: cuantos }))
      .toSorted(porCodigo),
  });
};

/** Hasta cuántos códigos se nombran en un error. */
const NOMBRADOS = 10;

/**
 * Comprueba que los municipios de los límites y los del padrón son los mismos, por código INE.
 * Si falta uno en cualquiera de los dos lados, falla y dice cuáles.
 */
export const cruzarConElPadron = (
  limites: LimitesDeMunicipios,
  padron: PadronDeMunicipios,
): Result.Result<void, MunicipiosIlegibles> => {
  const enLimites = new Set(
    limites.territorios.filter((t) => t.tipo === "municipio").map((t) => t.codigo),
  );
  const enPadron = new Set(padron.municipios.map((m) => m.codigo));
  const sinPadron = [...enLimites].filter((codigo) => !enPadron.has(codigo));
  const sinLimites = [...enPadron].filter((codigo) => !enLimites.has(codigo));
  if (sinPadron.length === 0 && sinLimites.length === 0) return Result.void;
  const lista = (codigos: ReadonlyArray<string>) =>
    `${codigos.slice(0, NOMBRADOS).join(", ")}${codigos.length > NOMBRADOS ? "…" : ""}`;
  return Result.fail(
    ilegibles(
      [
        sinPadron.length > 0
          ? `${sinPadron.length} municipios sin padrón (${lista(sinPadron)})`
          : "",
        sinLimites.length > 0
          ? `${sinLimites.length} municipios del padrón sin límites (${lista(sinLimites)})`
          : "",
      ]
        .filter((parte) => parte !== "")
        .join(" y "),
    ),
  );
};

/**
 * El fichero de límites que se guarda en el repositorio: JSON con una provincia, un recinto o un
 * arco por línea, para que un cambio se lea en un diff.
 */
export const ficheroDeMunicipios = (limites: LimitesDeMunicipios): string => {
  const lineas = <A>(elementos: ReadonlyArray<A>) =>
    elementos.map((elemento) => JSON.stringify(elemento)).join(",\n");
  return (
    `{"fuente":${JSON.stringify(limites.fuente)},` +
    `"toleranciaMetros":${limites.toleranciaMetros},` +
    `"unidadesPorGrado":${limites.unidadesPorGrado},"provincias":[\n` +
    `${lineas(limites.provincias)}\n],"territorios":[\n` +
    `${lineas(limites.territorios)}\n],"arcos":[\n` +
    `${lineas(limites.arcos)}\n]}\n`
  );
};

/** El fichero del padrón que se guarda en el repositorio, con un municipio por línea. */
export const ficheroDePadron = (padron: PadronDeMunicipios): string =>
  `{"fuente":${JSON.stringify(padron.fuente)},"municipios":[\n` +
  `${padron.municipios.map((m) => JSON.stringify(m)).join(",\n")}\n]}\n`;
