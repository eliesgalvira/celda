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

const enumerar = (partes: ReadonlyArray<string>): string =>
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

/**
 * Las bandas de una estación base, una vez cada una y de la más baja a la más alta: «800 MHz».
 * Una banda que no encaja en ninguna conocida se escribe con su tramo publicado.
 */
export const textosBandas = (bandas: ReadonlyArray<Banda>): ReadonlyArray<string> => [
  ...new Set(
    bandas.map((banda) => {
      if (banda.mhz !== null) return `${banda.mhz} MHz`;
      const [rango] = banda.rangos;
      return rango === undefined ? "Banda sin tramo" : `${rango.desdeMhz}–${rango.hastaMhz} MHz`;
    }),
  ),
];

export const SIN_BANDAS = "Celda aún no ha leído sus bandas en el registro oficial.";

const NOMBRE_FUENTE: Readonly<Record<Fuente, string>> = {
  "registro-oficial": "Registro oficial",
  antenasmoviles: "antenasmoviles.es",
  opencellid: "OpenCelliD",
};

const ENLACE_FUENTE: Readonly<Record<Fuente, string>> = {
  "registro-oficial": "Ver en el registro oficial",
  antenasmoviles: "Ver en antenasmoviles.es",
  opencellid: "Ver en OpenCelliD",
};

/** Cómo se cuenta una observación en la ficha: quién lo dice, qué y desde cuándo, y su enlace. */
export const textosOrigen = (origen: OrigenDeFicha) => ({
  fuente: NOMBRE_FUENTE[origen.fuente],
  detalle:
    origen.afirma === "desmontada"
      ? `la da por desmontada desde el ${fechaCorta(origen.fecha)}`
      : `desde el ${fechaCorta(origen.fecha)}`,
  textoEnlace: ENLACE_FUENTE[origen.fuente],
  tono: origen.afirma === "desmontada" ? ("correccion" as const) : ("presente" as const),
});

/** La marca de agua de la ficha, comparada con la del mapa (historia 57). */
export const textosMarca = (
  ficha: Ficha,
  comparacion: ComparacionConCapa,
): { readonly titulo: string; readonly detalle?: string } =>
  comparacion.tipo === "posterior"
    ? {
        titulo: "Actualizado después del mapa",
        detalle:
          `Esta ficha es del ${fechaCorta(comparacion.ficha)} y el mapa, del ` +
          `${fechaCorta(comparacion.capa)}. El marcador cambiará cuando se publique el mapa nuevo.`,
      }
    : { titulo: `Datos de la ficha: ${fechaCorta(ficha.version)}` };
