import type { Banda } from "@celda/dominio/banda";
import type { Estado } from "@celda/dominio/emplazamiento";
import type { Ficha, OrigenDeFicha } from "@celda/dominio/ficha";
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
export const antetituloDe = (ficha: Ficha): string =>
  ficha.estaciones.length > 1 ? "Emplazamiento compartido" : "Emplazamiento";

/**
 * El título de la ficha. Ninguna fuente da un nombre a los emplazamientos, así que es la calle
 * y el número tal como los publica la fuente, sin el municipio ni la provincia del final.
 */
export const tituloDe = (ficha: Ficha): string => {
  const calle = ficha.direccion.split(". ")[0]?.trim() ?? "";
  return calle === "" ? "Emplazamiento sin dirección" : calle;
};

/** Dónde está, bajo el título. El barrio llegará con los límites de barrio. */
export const lugarDe = (ficha: Ficha): string => ficha.municipio;

export const NOMBRE_ESTADO: Readonly<Record<Estado, string>> = {
  verificado: "Verificado",
  corregido: "Corregido",
  nuevo: "Nuevo",
};

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

export const SIN_BANDAS = "Celda aún no ha leído sus bandas en el registro oficial.";

export const NOMBRE_FUENTE: Readonly<Record<Fuente, string>> = {
  "registro-oficial": "Registro oficial",
  antenasmoviles: "antenasmoviles.es",
  opencellid: "OpenCelliD",
};

const ENLACE_FUENTE: Readonly<Record<Fuente, string>> = {
  "registro-oficial": "Ver en el registro oficial",
  antenasmoviles: "Ver en antenasmoviles.es",
  opencellid: "Ver en OpenCelliD",
};

/**
 * El código de la observación, delante de su fecha: «086040, ». El registro oficial pone en su
 * clave la razón social y el código («VODAFONE ESPAÑA, S.A.U. - 086040»).
 */
const codigoDeOrigen = (origen: OrigenDeFicha): string => {
  const codigo = origen.clave.split(" - ").at(-1)?.trim() ?? "";
  return codigo === "" || codigo === origen.clave ? "" : `${codigo}, `;
};

/** Cómo se cuenta una observación en la ficha: quién lo dice, qué y desde cuándo, y su enlace. */
export const textosOrigen = (origen: OrigenDeFicha) => ({
  fuente: NOMBRE_FUENTE[origen.fuente],
  detalle: `${codigoDeOrigen(origen)}${
    origen.afirma === "desmontada"
      ? `la da por desmontada desde el ${fechaCorta(origen.fecha)}`
      : `desde el ${fechaCorta(origen.fecha)}`
  }`,
  textoEnlace: ENLACE_FUENTE[origen.fuente],
  tono: origen.afirma === "desmontada" ? ("correccion" as const) : ("presente" as const),
});

/** Lo que dice la marca de agua de la ficha: un título y, si va por delante del mapa, por qué. */
export interface TextosMarca {
  readonly titulo: string;
  readonly detalle?: string;
}

/** La marca de agua de la ficha, comparada con la del mapa (historia 57). */
export const textosMarca = (ficha: Ficha, comparacion: ComparacionConCapa): TextosMarca => {
  if (comparacion.tipo !== "posterior") {
    return { titulo: `Datos de la ficha: ${fechaCorta(ficha.version)}` };
  }
  const [deLaFicha, delMapa] = fechasDistinguibles(comparacion.ficha, comparacion.capa);
  return {
    titulo: "Actualizado después del mapa",
    detalle:
      `Esta ficha es del ${deLaFicha} y el mapa, del ${delMapa}. ` +
      "El marcador cambiará cuando se publique el mapa nuevo.",
  };
};
