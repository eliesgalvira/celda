import type { FuenteDeBarrios } from "@celda/dominio/barrio";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  type Certeza,
  FUENTE_DE_PARAMETROS,
  GENERACIONES,
  GRUPO_DE_LINEAS,
  GRUPOS_DE_LINEAS,
  NOMBRE_GRUPO,
  type ParametrosDelEjercicio,
  type ResultadoDeCompania,
  type ResultadoDelEjercicio,
} from "@celda/dominio/ejercicio";
import type { FuenteDePoblacion } from "@celda/dominio/poblacion";
import { BANDAS_NOMINALES } from "@celda/dominio/tecnologia";

/**
 * La tabla del ejercicio de emplazamientos, con la fuente y la fecha de cada fila: la misma para
 * la pantalla, el CSV y el XLSX. Todo son funciones puras.
 */

/** Un valor de la tabla: el texto que se ve y, si es un número, el número para exportarlo. */
export interface Valor {
  readonly texto: string;
  readonly numero?: number;
  readonly marca?: "si" | "no" | "probable" | "posible" | "sin-datos";
}

export interface Fila {
  readonly magnitud: string;
  readonly unidad?: string;
  /** Uno por compañía, o uno solo para toda la zona. */
  readonly valores: ReadonlyArray<Valor>;
  readonly fuente: string;
  /** Fecha del dato, `AAAA-MM-DD`. */
  readonly fecha: string;
}

export interface Seccion {
  readonly titulo: string;
  readonly filas: ReadonlyArray<Fila>;
}

export interface Tabla {
  readonly titulo: string;
  readonly companias: ReadonlyArray<Compania>;
  readonly secciones: ReadonlyArray<Seccion>;
}

/** De dónde salen los datos que no calcula el ejercicio. */
export interface ContextoDeTabla {
  readonly zona: string;
  readonly poblacion: FuenteDePoblacion;
  readonly limites: FuenteDeBarrios;
  /** Fecha de la capa de emplazamientos, en milisegundos. */
  readonly fechaCapa: number;
  readonly parametros: ParametrosDelEjercicio;
  /**
   * De dónde salen las bandas: de la capa del mapa, con su fecha, o de las fichas publicadas,
   * con la fecha de la lectura.
   */
  readonly bandas: { readonly de: "capa" | "fichas"; readonly fecha: number };
}

const ORIGEN_BANDAS = {
  capa: { nombre: "Capa del mapa", en: "de la capa del mapa" },
  fichas: { nombre: "Fichas publicadas", en: "de las fichas publicadas" },
} as const;

const ENTERO = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/** Un número entero como se lee en castellano: «12.479». */
export const entero = (n: number): string => ENTERO.format(n);
/** Un número con hasta dos decimales: «2,68». */
export const decimal = (n: number): string => DECIMAL.format(n);

/** Un día `AAAA-MM-DD` de una fecha en milisegundos, en la hora de Barcelona. */
export const dia = (fecha: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(fecha);

const NINGUNO: Valor = { texto: "—" };

const numero = (n: number | undefined, formato: (n: number) => string): Valor =>
  n === undefined ? NINGUNO : { texto: formato(n), numero: n };

const TEXTO_CERTEZA: Readonly<Record<Certeza, Valor>> = {
  probable: { texto: "probable", marca: "probable" },
  posible: { texto: "posible", marca: "posible" },
  "no-consta": { texto: "no consta", marca: "sin-datos" },
};

/** Si se puede decir «no» de una banda: todas las estaciones tienen bandas conocidas. */
const todasConBandas = (c: ResultadoDeCompania): boolean =>
  c.estaciones > 0 && c.conBandas === c.estaciones;

const sonLosDeFabrica = (p: ParametrosDelEjercicio, porDefecto: ParametrosDelEjercicio) =>
  p.penetracion === porDefecto.penetracion &&
  GRUPOS_DE_LINEAS.every((grupo) => p.cuotas[grupo] === porDefecto.cuotas[grupo]);

/** La fuente de los parámetros: la CNMC si no se han cambiado, o que los ha puesto quien estudia. */
export const fuenteDeParametros = (
  parametros: ParametrosDelEjercicio,
  porDefecto: ParametrosDelEjercicio,
): { readonly texto: string; readonly fecha: string } =>
  sonLosDeFabrica(parametros, porDefecto)
    ? {
        texto: `${FUENTE_DE_PARAMETROS.atribucion}, toda España, ${FUENTE_DE_PARAMETROS.periodo}`,
        fecha: FUENTE_DE_PARAMETROS.publicada,
      }
    : { texto: "Valor puesto a mano en el ejercicio", fecha: "" };

/** La tabla del ejercicio para una zona. */
export const tablaDelEjercicio = (
  resultado: ResultadoDelEjercicio,
  contexto: ContextoDeTabla,
  porDefecto: ParametrosDelEjercicio,
): Tabla => {
  const companias = resultado.companias;
  const porCompania = (valor: (c: ResultadoDeCompania) => Valor) => companias.map(valor);
  const parametros = fuenteDeParametros(contexto.parametros, porDefecto);
  const padron = `Padrón a ${contexto.poblacion.referencia}, ${contexto.poblacion.atribucion} (${contexto.poblacion.licencia})`;
  const capa = "Mapa de Celda: registro oficial y correcciones";
  const fechaCapa = dia(contexto.fechaCapa);
  const fechaBandas = dia(contexto.bandas.fecha);
  const origenBandas = ORIGEN_BANDAS[contexto.bandas.de];
  const sinCompania = (c: ResultadoDeCompania, valor: () => Valor) =>
    c.estaciones === 0 ? NINGUNO : valor();

  return {
    titulo: `Emplazamiento de estaciones base en ${contexto.zona}`,
    companias: companias.map((c) => c.compania),
    secciones: [
      {
        titulo: "Zona",
        filas: [
          {
            magnitud: "Zona",
            valores: [{ texto: contexto.zona }],
            fuente: `Límites de barrio, ${contexto.limites.atribucion} (${contexto.limites.licencia})`,
            fecha: contexto.limites.fecha,
          },
          {
            magnitud: "Área",
            unidad: "km²",
            valores: [numero(resultado.areaKm2, decimal)],
            fuente: "Calculada con los límites",
            fecha: contexto.limites.fecha,
          },
          {
            magnitud: "Habitantes",
            valores: [numero(resultado.habitantes, entero)],
            fuente: padron,
            fecha: contexto.poblacion.publicada,
          },
          {
            magnitud: "Densidad",
            unidad: "habitantes por km²",
            valores: [numero(resultado.densidad, entero)],
            fuente: "Habitantes entre área",
            fecha: contexto.poblacion.publicada,
          },
          {
            magnitud: "Penetración",
            unidad: "líneas móviles por cada 100 habitantes",
            valores: [numero(contexto.parametros.penetracion, decimal)],
            fuente: parametros.texto,
            fecha: parametros.fecha,
          },
          {
            magnitud: "Líneas móviles en la zona",
            valores: [numero(resultado.lineas, entero)],
            fuente: "Habitantes por penetración",
            fecha: contexto.poblacion.publicada,
          },
        ],
      },
      {
        titulo: "Estaciones base",
        filas: [
          {
            magnitud: "Estaciones base en la zona",
            valores: porCompania((c) => ({ texto: entero(c.estaciones), numero: c.estaciones })),
            fuente: capa,
            fecha: fechaCapa,
          },
          {
            magnitud: "Distancia media a la vecina",
            unidad: "m",
            valores: porCompania((c) => numero(c.distanciaMedia, entero)),
            fuente: "A la más cercana de la compañía, dentro o fuera",
            fecha: fechaCapa,
          },
          {
            magnitud: "Radio de cobertura",
            unidad: "m",
            valores: porCompania((c) => numero(c.radio, entero)),
            fuente: "Mitad de la distancia media a la vecina",
            fecha: fechaCapa,
          },
          {
            magnitud: "Habitantes por estación base",
            valores: porCompania((c) => numero(c.habitantesPorEstacion, entero)),
            fuente: "Habitantes entre estaciones",
            fecha: contexto.poblacion.publicada,
          },
          {
            magnitud: "Cuota de líneas móviles",
            unidad: "%",
            valores: porCompania((c) => ({
              texto: decimal(contexto.parametros.cuotas[GRUPO_DE_LINEAS[c.compania]]),
              numero: contexto.parametros.cuotas[GRUPO_DE_LINEAS[c.compania]],
            })),
            fuente: `${parametros.texto}; ${NOMBRE_GRUPO.masorange}, juntas`,
            fecha: parametros.fecha,
          },
          {
            magnitud: "Usuarios por estación base",
            valores: porCompania((c) => numero(c.usuariosPorEstacion, entero)),
            fuente: "Líneas por cuota, entre estaciones del grupo",
            fecha: parametros.fecha === "" ? contexto.poblacion.publicada : parametros.fecha,
          },
        ],
      },
      {
        titulo: "Tecnologías, deducidas de las bandas",
        filas: GENERACIONES.map((generacion) => ({
          magnitud: generacion,
          valores: porCompania((c) =>
            sinCompania(c, () => TEXTO_CERTEZA[c.tecnologias[generacion]]),
          ),
          fuente: `Deducida de las bandas ${origenBandas.en}`,
          fecha: fechaBandas,
        })),
      },
      {
        titulo: "Bandas",
        filas: BANDAS_NOMINALES.map((mhz) => ({
          magnitud: `${entero(mhz)} MHz`,
          valores: porCompania((c) =>
            sinCompania(c, (): Valor => {
              if (c.bandas.includes(mhz)) return { texto: "sí", marca: "si" };
              return todasConBandas(c)
                ? { texto: "no", marca: "no" }
                : { texto: "no consta", marca: "sin-datos" };
            }),
          ),
          fuente: `${origenBandas.nombre}, del registro oficial`,
          fecha: fechaBandas,
        })),
      },
    ],
  };
};

/** Las columnas de la tabla exportada, en orden. */
const cabecera = (tabla: Tabla): ReadonlyArray<string> => [
  "Sección",
  "Magnitud",
  "Unidad",
  ...tabla.companias.map((c) => NOMBRE_COMPANIA[c]),
  "Fuente",
  "Fecha",
];

/** Una celda exportada: un número, que la hoja de cálculo trata como tal, o un texto. */
export interface Celda {
  readonly texto: string;
  readonly numero?: number;
}

const texto = (valor: string): Celda => ({ texto: valor });

/**
 * La tabla como filas de celdas, con una fila de cabecera. Un valor de toda la zona va en la
 * primera columna de las compañías. Los números se redondean a dos decimales.
 */
export const filasExportadas = (tabla: Tabla): ReadonlyArray<ReadonlyArray<Celda>> => [
  cabecera(tabla).map(texto),
  ...tabla.secciones.flatMap((seccion) =>
    seccion.filas.map((fila): ReadonlyArray<Celda> => {
      const valores = tabla.companias.map((_, i): Celda => {
        const valor = fila.valores[i];
        if (valor === undefined || valor.texto === NINGUNO.texto) return texto("");
        return valor.numero === undefined
          ? texto(valor.texto)
          : { texto: valor.texto, numero: Math.round(valor.numero * 100) / 100 };
      });
      return [
        texto(seccion.titulo),
        texto(fila.magnitud),
        texto(fila.unidad ?? ""),
        ...valores,
        texto(fila.fuente),
        texto(fila.fecha),
      ];
    }),
  ),
];

/** Marca de orden de bytes: dice a la hoja de cálculo que el fichero está en UTF-8. */
const BOM = "﻿";

const celdaCsv = (celda: Celda): string => {
  const escrita = celda.numero === undefined ? celda.texto : String(celda.numero).replace(".", ",");
  return /[;"\r\n]/u.test(escrita) ? `"${escrita.replaceAll('"', '""')}"` : escrita;
};

/**
 * La tabla en CSV como lo abre una hoja de cálculo en castellano: punto y coma entre columnas,
 * coma decimal, saltos de línea de Windows y la marca de UTF-8 al principio para que las tildes
 * se lean bien.
 */
export const csvDeTabla = (tabla: Tabla): string =>
  `${BOM}${filasExportadas(tabla)
    .map((fila) => fila.map(celdaCsv).join(";"))
    .join("\r\n")}\r\n`;

/** El nombre del fichero, sin extensión: «estaciones-base-pedralbes». */
export const nombreDeFichero = (zona: string): string =>
  `estaciones-base-${zona
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")}`;
