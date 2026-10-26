import type { FuenteDeBarrios } from "@celda/dominio/barrio";
import type { FuenteDeMunicipios } from "@celda/dominio/municipio";
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
 * la pantalla y el CSV. Todo son funciones puras.
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

/**
 * De dónde salen el límite, el área y los habitantes de la zona: un barrio de Barcelona, con los
 * límites y el padrón del Ayuntamiento, o un municipio, con los límites del IGN y el padrón del
 * INE.
 */
export type OrigenDeLaZona =
  | {
      readonly tipo: "barrio";
      readonly limites: FuenteDeBarrios;
      readonly poblacion: FuenteDePoblacion;
    }
  | {
      readonly tipo: "municipio";
      /** Código INE del municipio. */
      readonly codigo: string;
      readonly limites: FuenteDeMunicipios;
      readonly poblacion: FuenteDePoblacion;
    };

/** Cómo se cita el límite de la zona: el IGN pide su fórmula para una obra derivada. */
export const citaDeLimites = (origen: OrigenDeLaZona): string =>
  origen.tipo === "barrio"
    ? `Límites de barrio, ${origen.limites.atribucion} (${origen.limites.licencia})`
    : `Obra derivada de ${origen.limites.producto} ${origen.limites.fecha} CC-BY 4.0 ign.es`;

/**
 * Cómo se citan los habitantes: el padrón, su fecha de referencia, quién lo publica y su licencia.
 * El INE pide además decir que los datos elaborados son propios.
 */
export const citaDelPadron = (origen: OrigenDeLaZona): string => {
  const { poblacion } = origen;
  const padron = `Padrón a ${poblacion.referencia}, ${poblacion.atribucion} (${poblacion.licencia})`;
  return origen.tipo === "barrio"
    ? padron
    : `${padron}. Elaboración propia con datos extraídos del sitio web del INE: www.ine.es`;
};

/** De dónde salen los datos que no calcula el ejercicio. */
export interface ContextoDeTabla {
  /** El nombre de la zona como se lee en el título: «Pedralbes» o «Tordera (Barcelona)». */
  readonly zona: string;
  readonly origen: OrigenDeLaZona;
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
  capa: { nombre: "Mapa de Celda", en: "del mapa de Celda" },
  fichas: { nombre: "Fichas de los emplazamientos", en: "de las fichas de los emplazamientos" },
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

const numero = (n: number | null | undefined, formato: (n: number) => string): Valor =>
  n === undefined || n === null ? NINGUNO : { texto: formato(n), numero: n };

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
  const { origen } = contexto;
  const padron = citaDelPadron(origen);
  const fechaPadron = origen.poblacion.publicada;
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
            fuente: citaDeLimites(origen),
            fecha: origen.limites.fecha,
          },
          ...(origen.tipo === "municipio"
            ? [
                {
                  magnitud: "Código INE",
                  valores: [{ texto: origen.codigo }],
                  fuente: citaDeLimites(origen),
                  fecha: origen.limites.fecha,
                },
              ]
            : []),
          {
            magnitud: "Área",
            unidad: "km²",
            valores: [numero(resultado.areaKm2, decimal)],
            fuente:
              origen.tipo === "barrio"
                ? "Calculada con los límites"
                : "Calculada con los límites del IGN sin simplificar",
            fecha: origen.limites.fecha,
          },
          {
            magnitud: "Habitantes",
            valores: [numero(resultado.habitantes, entero)],
            fuente:
              resultado.habitantes === null
                ? `${padron}. El padrón aún no tiene esta zona`
                : padron,
            fecha: fechaPadron,
          },
          {
            magnitud: "Densidad",
            unidad: "habitantes por km²",
            valores: [numero(resultado.densidad, entero)],
            fuente: "Habitantes entre área",
            fecha: fechaPadron,
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
            fecha: fechaPadron,
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
            fecha: fechaPadron,
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
            fecha: parametros.fecha === "" ? fechaPadron : parametros.fecha,
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

/** Marca de orden de bytes: dice a la hoja de cálculo que el fichero está en UTF-8. */
const BOM = "\uFEFF";

/** Un valor en el CSV: vacío si no hay ninguno; un número, con dos decimales y coma decimal. */
const valorCsv = (valor: Valor | undefined): string => {
  if (valor === undefined || valor.texto === NINGUNO.texto) return "";
  return valor.numero === undefined
    ? valor.texto
    : String(Math.round(valor.numero * 100) / 100).replace(".", ",");
};

const celdaCsv = (texto: string): string =>
  /[;"\r\n]/u.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;

/**
 * La tabla en CSV como lo abre una hoja de cálculo en castellano: punto y coma entre columnas,
 * coma decimal, saltos de línea de Windows y la marca de UTF-8 al principio para que las tildes
 * se lean bien. Un valor de toda la zona va en la primera columna de las compañías.
 */
export const csvDeTabla = (tabla: Tabla): string => {
  const filas = [
    cabecera(tabla),
    ...tabla.secciones.flatMap((seccion) =>
      seccion.filas.map((fila) => [
        seccion.titulo,
        fila.magnitud,
        fila.unidad ?? "",
        ...tabla.companias.map((_, i) => valorCsv(fila.valores[i])),
        fila.fuente,
        fila.fecha,
      ]),
    ),
  ];
  return `${BOM}${filas.map((fila) => fila.map(celdaCsv).join(";")).join("\r\n")}\r\n`;
};

/** El nombre del fichero, sin extensión: «estaciones-base-pedralbes». */
export const nombreDeFichero = (zona: string): string =>
  `estaciones-base-${zona
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")}`;
