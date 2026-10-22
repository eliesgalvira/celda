import type { Banda } from "@celda/dominio/banda";
import type { Estado } from "@celda/dominio/emplazamiento";
import type { EstacionDeFicha, Ficha, OrigenDeFicha } from "@celda/dominio/ficha";
import { bloque, llano, marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";
import { nombreDeLugarDeMunicipio, nombreDeLugarDeProvincia } from "@celda/dominio/nombreDeLugar";
import type { Lugar } from "@celda/dominio/municipio";
import type { Fuente } from "@celda/dominio/observacion";

import type { ComparacionConCapa } from "./marcaDeAgua.ts";

const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

/** Una fecha corta en la hora de Barcelona: «26 sept 2026». */
export const fechaCorta = (fecha: number): string => FECHA.format(fecha).replace(".", "");

const HORA = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

/** Dos fechas que se distinguen al leerlas: con la hora si caen el mismo día. */
const fechasDistinguibles = (a: number, b: number): readonly [string, string] =>
  fechaCorta(a) === fechaCorta(b)
    ? [`${fechaCorta(a)} a las ${HORA.format(a)}`, `${fechaCorta(b)} a las ${HORA.format(b)}`]
    : [fechaCorta(a), fechaCorta(b)];

/** «a», «a y b», «a, b y c». */
export const enumerar = (partes: ReadonlyArray<string>): string =>
  partes.length <= 1
    ? (partes[0] ?? "")
    : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1) ?? ""}`;

/** Qué es, sobre el título: «Emplazamiento» o «Emplazamiento compartido». */
export const antetituloDe = (ficha: Ficha): TextoMarcado =>
  marcado`${termino("emplazamiento", "Emplazamiento")}${ficha.estaciones.length > 1 ? " compartido" : ""}`;

/**
 * El título de la ficha. Ninguna fuente da un nombre a los emplazamientos, así que es la calle
 * y el número tal como los publica la fuente, sin el municipio ni la provincia del final. El
 * registro escribe «CL X, 1. MUNICIPIO, PROVINCIA»; una dirección de OpenStreetMap, como la de un
 * emplazamiento que solo conoce la comunidad, es «Carrer de X, 1, Barrio, 08014 Barcelona».
 */
export const tituloDe = (ficha: Ficha): string => {
  const direccion = ficha.direccion.trim();
  if (/,\s*\d{5}\s+[^,]+$/u.test(direccion)) {
    const [via = "", numero = ""] = direccion.split(",").map((parte) => parte.trim());
    return /^\d/u.test(numero) ? `${via}, ${numero}` : via;
  }
  const calle = direccion.split(". ")[0]?.trim() ?? "";
  return calle === "" ? "Emplazamiento sin dirección" : calle;
};

/** Ceuta y Melilla son ciudades autónomas: municipio y provincia a la vez, con el mismo nombre. */
const CIUDADES_AUTONOMAS = new Set(["51", "52"]);

/**
 * Dónde está, bajo el título: el municipio y la provincia del IGN que pone el publicador, con su
 * nombre de lugar (ADR 0025): «Sant Cugat del Vallès, provincia de Barcelona», «Elx, provincia de
 * Alacant». En un territorio compartido por varios
 * municipios, solo la provincia. Si la ficha no los trae, porque se publicó antes o porque el
 * emplazamiento cae lejos de todo municipio, el municipio tal como lo escribe la fuente. Con el
 * barrio de Barcelona en que cae, si la capa de su provincia lo sabe, el barrio va delante: «el
 * Raval, Barcelona, provincia de Barcelona» (#13).
 */
export const lugarDe = (ficha: Ficha, barrio?: string): string => {
  const sitio = municipioYProvinciaDe(ficha);
  return barrio === undefined ? sitio : `${barrio}, ${sitio}`;
};

const municipioYProvinciaDe = (ficha: Ficha): string => {
  const { municipio, provincia } = ficha.lugar ?? { municipio: null, provincia: null };
  const deMunicipio =
    municipio === null ? null : nombreDeLugarDeMunicipio(municipio.codigo, municipio.nombre);
  if (provincia === null) return deMunicipio ?? ficha.municipio;
  const deProvincia = nombreDeLugarDeProvincia(provincia.codigo, provincia.nombre);
  if (deMunicipio === null) {
    return `Territorio compartido entre municipios, provincia de ${deProvincia}`;
  }
  return CIUDADES_AUTONOMAS.has(provincia.codigo)
    ? deMunicipio
    : `${deMunicipio}, provincia de ${deProvincia}`;
};

/**
 * Cómo se nombra en una frase una zona, con su nombre de lugar (ADR 0025): un municipio, «Gavà»,
 * o una provincia, «la provincia de Barcelona», salvo Ceuta y Melilla, que se nombran solas.
 */
export const nombreDeZona = (zona: {
  readonly tipo: "municipio" | "provincia";
  readonly lugar: NonNullable<Lugar["provincia"]>;
}): string => {
  const { codigo, nombre } = zona.lugar;
  if (zona.tipo === "municipio") return nombreDeLugarDeMunicipio(codigo, nombre);
  const deProvincia = nombreDeLugarDeProvincia(codigo, nombre);
  return CIUDADES_AUTONOMAS.has(codigo) ? deProvincia : `la provincia de ${deProvincia}`;
};

/**
 * El crédito del municipio y la provincia, en la forma que piden las condiciones del IGN para
 * una obra derivada: producto, fecha, licencia y atribución.
 */
export const creditoDelLugar = (ficha: Ficha): string | undefined => {
  const fuente = ficha.lugar?.fuente;
  if (fuente === undefined) return undefined;
  const fecha = Date.parse(`${fuente.fecha}T12:00:00Z`);
  const cuando = Number.isNaN(fecha) ? fuente.fecha : fechaCorta(fecha);
  return `Municipio y provincia: obra derivada de ${fuente.producto} ${cuando}, ${fuente.licencia}, ${fuente.atribucion} (ign.es).`;
};

const NOMBRE_ESTADO: Readonly<Record<Estado, string>> = {
  verificado: "Verificado",
  corregido: "Corregido",
  nuevo: "Nuevo",
};

/** La etiqueta del estado, que abre su explicación del glosario (#18). */
export const etiquetaDeEstado = (estado: Estado): TextoMarcado =>
  termino(estado, NOMBRE_ESTADO[estado]);

/** Los códigos de una estación base: «Código 0802532» o «Códigos 086040 y 86040». */
export const textoCodigos = (codigos: ReadonlyArray<string>): string =>
  codigos.length === 1 ? `Código ${codigos[0] ?? ""}` : `Códigos ${enumerar(codigos)}`;

const MHZ = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, useGrouping: false });

/**
 * El tramo de un expediente tal como lo publica la fuente, con coma decimal: «925,1–935,1 MHz»
 * o, con dos rangos, «1910–1915 y 2155–2170 MHz».
 */
export const textoTramo = (banda: Banda): string =>
  banda.rangos.length === 0
    ? "Sin tramo publicado"
    : `${enumerar(banda.rangos.map((r) => `${MHZ.format(r.desdeMhz)}–${MHZ.format(r.hastaMhz)}`))} MHz`;

/**
 * Lo que se dice de una estación base sin ficha en el registro: el listado del registro la
 * incluye, pero su página de detalle dice «Código de emplazamiento no válido».
 */
export const SIN_FICHA_EN_REGISTRO = "El registro no tiene ficha para este emplazamiento";

/** Cuándo se comprobó que el registro no tiene la ficha: «comprobado el 2 oct 2026». */
export const comprobadoEl = (fecha: number): string => `comprobado el ${fechaCorta(fecha)}`;

/**
 * Qué decir de una estación base de la que no se conoce algo que sale de su ficha del registro,
 * `que`: si el registro no tiene su ficha, que no la tiene y desde cuándo se sabe; si no está en
 * el registro, que no hay de dónde leerlo; si Celda aún no ha leído su ficha (`sinLeer`), que no
 * la ha leído; y si la ha leído, que el registro no lo publica (#41).
 */
const faltaDe = (estacion: EstacionDeFicha, que: string, sinLeer: boolean): string => {
  if (estacion.sinFichaEnRegistro !== undefined) {
    return `${SIN_FICHA_EN_REGISTRO} (${comprobadoEl(estacion.sinFichaEnRegistro)}), así que no se conocen ${que}.`;
  }
  if (!estacion.origenes.some((o) => o.fuente === "registro-oficial")) {
    return `No está en el registro oficial, así que no se conocen ${que}.`;
  }
  return sinLeer
    ? `Celda aún no ha leído ${que} en el registro oficial.`
    : `El registro oficial no publica ${que}.`;
};

/** Qué decir de una estación base sin bandas. */
export const sinBandasDe = (estacion: EstacionDeFicha): string =>
  faltaDe(estacion, "sus bandas", estacion.bandasSinLeer);

/**
 * Qué decir de una estación base sin medidas de exposición del ministerio. Sin la lista, Celda
 * aún no ha leído su ficha desde que las guarda (#73); con la lista vacía, el registro no publica
 * ninguna.
 */
export const sinMedidasDe = (estacion: EstacionDeFicha): string =>
  faltaDe(estacion, "sus medidas de exposición", estacion.medidasDeExposicion === undefined);

export const NOMBRE_FUENTE: Readonly<Record<Fuente, string>> = {
  "registro-oficial": "Registro oficial",
  comunidad: "Comunidad de Celda",
};

export const ENLACE_FUENTE: Readonly<Record<Fuente, string>> = {
  "registro-oficial": "Ver en el registro oficial",
  comunidad: "Ver la corrección",
};

/**
 * El código de una observación, sin lo demás de su clave: «086040». El registro oficial pone en su
 * clave la razón social y el código («VODAFONE ESPAÑA, S.A.U. - 086040»); la comunidad, la
 * compañía y el código («vodafone - 086040»). Una clave sin código no da nada.
 */
const codigoDeLaClave = (clave: string): string => {
  const codigo = clave.split(" - ").at(-1)?.trim() ?? "";
  return codigo === clave ? "" : codigo;
};

/** El código de la observación, delante de su fecha: «086040, ». */
const codigoDeOrigen = (origen: OrigenDeFicha): string => {
  const codigo = codigoDeLaClave(origen.clave);
  return codigo === "" ? "" : `${codigo}, `;
};

/**
 * De dónde sale una observación en los datos técnicos: la del registro oficial, tal como él
 * escribe al titular y el código; la de otra fuente, solo su código, porque el resto de su clave
 * es interno de Celda.
 */
export const claveDeOrigen = (origen: OrigenDeFicha): string => {
  if (origen.fuente === "registro-oficial") return origen.clave;
  const codigo = codigoDeLaClave(origen.clave);
  return codigo === "" ? "" : `código ${codigo}`;
};

/** El nombre de una fuente en la ficha; el registro oficial lleva su explicación. */
const fuenteMarcada = (fuente: Fuente): TextoMarcado =>
  fuente === "registro-oficial"
    ? termino("registro-oficial", NOMBRE_FUENTE[fuente])
    : llano(NOMBRE_FUENTE[fuente]);

/**
 * Cómo se cuenta una observación en la ficha: quién lo dice, qué y desde cuándo, y su enlace.
 * Una corrección explica qué es con sus propias palabras, «la da por desmontada».
 */
export const textosOrigen = (origen: OrigenDeFicha) => ({
  fuente: fuenteMarcada(origen.fuente),
  detalle:
    origen.afirma === "desmontada"
      ? marcado`${codigoDeOrigen(origen)}${termino("correccion", "la da por desmontada")} desde el ${fechaCorta(origen.fecha)}`
      : llano(`${codigoDeOrigen(origen)}desde el ${fechaCorta(origen.fecha)}`),
  enlace: origen.url,
  textoEnlace: ENLACE_FUENTE[origen.fuente],
  tono: origen.afirma === "desmontada" ? ("correccion" as const) : ("presente" as const),
});

/**
 * Las observaciones de todas las estaciones base, ya escritas. Son un solo bloque: el registro
 * oficial y la corrección se subrayan la primera vez que salen, no en cada estación base.
 */
export const textosDeOrigenes = (estaciones: ReadonlyArray<EstacionDeFicha>) => {
  const marcar = bloque();
  return estaciones.map((estacion) =>
    estacion.origenes.map((origen) => {
      const textos = textosOrigen(origen);
      return { ...textos, fuente: marcar(textos.fuente), detalle: marcar(textos.detalle) };
    }),
  );
};

/** Lo que dice la marca de agua de la ficha: un título y, si va por delante del mapa, por qué. */
export interface TextosMarca {
  readonly titulo: TextoMarcado;
  readonly detalle?: string;
}

/** La marca de agua de la ficha, comparada con la del mapa (historia 57). */
export const textosMarca = (ficha: Ficha, comparacion: ComparacionConCapa): TextosMarca => {
  if (comparacion.tipo !== "posterior") {
    return {
      titulo: marcado`${termino("version-de-los-datos", "Datos de la ficha")}: ${fechaCorta(ficha.version)}`,
    };
  }
  const [deLaFicha, delMapa] = fechasDistinguibles(comparacion.ficha, comparacion.capa);
  return {
    titulo: termino("marca-de-agua", "Actualizado después del mapa"),
    detalle: `Esta ficha es del ${deLaFicha} y el mapa, del ${delMapa}.`,
  };
};
