import type { Mhz } from "@celda/dominio/banda";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { EstacionDeFicha } from "@celda/dominio/ficha";
import {
  BANDAS_NOMINALES,
  FRANJA_DE_BANDA,
  generacionProbable,
  USOS_DE_BANDA,
} from "@celda/dominio/tecnologia";
import type { EstacionTecnica } from "@celda/ui/panel/DatosTecnicos.tsx";
import type { FilaEje } from "@celda/ui/panel/EjeFrecuencias.tsx";

import {
  enumerar,
  fechaCorta,
  NOMBRE_FUENTE,
  SIN_BANDAS,
  textoCodigos,
  textoTramo,
} from "./textos.ts";

/** Las bandas nominales de una estación base, una vez cada una y de menor a mayor. */
const bandasDe = (estacion: EstacionDeFicha): ReadonlyArray<Mhz> =>
  BANDAS_NOMINALES.filter((mhz) => estacion.bandas.some((banda) => banda.mhz === mhz));

/** Si de una estación se conocen todas las bandas: tiene alguna y todas encajan en una nominal. */
const conocidaDelTodo = (estacion: EstacionDeFicha): boolean =>
  estacion.bandas.length > 0 && estacion.bandas.every((banda) => banda.mhz !== null);

const nombres = (estaciones: ReadonlyArray<EstacionDeFicha>): string =>
  enumerar(estaciones.map((e) => NOMBRE_COMPANIA[e.compania]));

const quienEmite = (estaciones: ReadonlyArray<EstacionDeFicha>): string => {
  if (estaciones.length === 0) return "Ninguna fuente dice qué compañía emite aquí.";
  if (estaciones.length === 1) return `Aquí emite ${nombres(estaciones)}.`;
  return `${nombres(estaciones)} comparten este emplazamiento.`;
};

/**
 * Qué generación da, deducida de las bandas. El 5G dice con qué compañías si no lo dan todas:
 * es lo que más cambia de una a otra.
 */
const queGeneracion = (estaciones: ReadonlyArray<EstacionDeFicha>): string => {
  const con = (generacion: "4G" | "5G") =>
    estaciones.filter((e) => bandasDe(e).some((mhz) => generacionProbable(mhz) === generacion));
  const con4G = con("4G");
  const con5G = con("5G");
  const cinco = con5G.length === estaciones.length ? "5G" : `5G con ${nombres(con5G)}`;
  if (con5G.length === 0) return "4G";
  if (con4G.length === 0) return cinco;
  return con5G.length === estaciones.length ? "4G y 5G" : `4G, y ${cinco}`;
};

/** Si llega lejos o da velocidad. Solo dice lo que falta si se conocen todas las bandas. */
const queAlcance = (bandas: ReadonlyArray<Mhz>, completo: boolean): string => {
  const franjas = new Set(bandas.map((mhz) => FRANJA_DE_BANDA[mhz]));
  const bajas = franjas.has("baja");
  const altas = franjas.has("alta");
  if (bajas && altas) {
    return "llega lejos y entra bien en los edificios, y tiene bandas altas que dan más velocidad";
  }
  if (bajas) {
    return completo
      ? "llega lejos y entra bien en los edificios, pero no tiene bandas altas, que son las que dan más velocidad"
      : "llega lejos y entra bien en los edificios";
  }
  if (altas) {
    return completo
      ? "tiene bandas altas que dan más velocidad, pero no bajas, que son las que llegan más lejos y entran mejor en los edificios"
      : "tiene bandas altas que dan más velocidad";
  }
  return completo
    ? "sus bandas son medias, con alcance y velocidad intermedios"
    : "son bandas medias, con alcance y velocidad intermedios";
};

const mayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * La frase que abre la ficha (historia 13): quién emite, si da 4G o 5G y si llega lejos o da
 * velocidad. El registro oficial no publica la tecnología, así que se deduce de la banda y se
 * dice «probablemente». Lo que no se conoce se dice que no se conoce.
 */
export const fraseDeResumen = (estaciones: ReadonlyArray<EstacionDeFicha>): string => {
  const quien = quienEmite(estaciones);
  if (estaciones.length === 0) return quien;

  const bandas = BANDAS_NOMINALES.filter((mhz) =>
    estaciones.some((e) => bandasDe(e).includes(mhz)),
  );
  if (bandas.length === 0) {
    return (
      `${quien} Aún no se conocen sus bandas, así que no se sabe si da 4G o 5G ` +
      "ni si llega lejos o da velocidad."
    );
  }

  const completo = estaciones.every(conocidaDelTodo);
  const sinBandas = estaciones.filter((e) => bandasDe(e).length === 0);
  const segun = completo ? "Por sus bandas" : "Por las bandas que se conocen";
  const falta =
    sinBandas.length === 0 ? "" : ` De ${nombres(sinBandas)} aún no se conocen las bandas.`;
  return (
    `${quien} ${segun}, probablemente da ${queGeneracion(estaciones)}. ` +
    `${mayuscula(queAlcance(bandas, completo))}.${falta}`
  );
};

export const TITULO_EJE = "Qué frecuencia usa cada compañía (MHz)";

/** Las filas del eje de frecuencias (historia 14): una por compañía, con sus bandas nominales. */
export const filasDelEje = (estaciones: ReadonlyArray<EstacionDeFicha>): ReadonlyArray<FilaEje> =>
  estaciones.map((estacion) => {
    const bandas = bandasDe(estacion);
    return {
      compania: estacion.compania,
      nombre: NOMBRE_COMPANIA[estacion.compania],
      bandas,
      nota: bandas.length === 0 ? "Aún no se conocen sus bandas" : undefined,
    };
  });

/** La tecnología de una banda en los datos técnicos: la probable y, entre paréntesis, las otras. */
const textoTecnologia = (mhz: Mhz | null): string => {
  if (mhz === null) return "No se sabe";
  const [probable, ...otras] = USOS_DE_BANDA[mhz];
  return otras.length === 0 ? `${probable}` : `${probable} (o ${otras.join(" o ")})`;
};

/** Lo que cuentan los datos técnicos de cada estación base (historia 19). */
export const datosTecnicosDe = (
  estaciones: ReadonlyArray<EstacionDeFicha>,
): ReadonlyArray<EstacionTecnica> =>
  estaciones.map((estacion) => ({
    compania: estacion.compania,
    nombre: NOMBRE_COMPANIA[estacion.compania],
    codigos: textoCodigos(estacion.codigos),
    expedientes: estacion.bandas.map((banda) => ({
      referencia: banda.referencia,
      tramo: textoTramo(banda),
      banda: banda.mhz === null ? "Sin banda conocida" : `${banda.mhz} MHz`,
      tecnologia: textoTecnologia(banda.mhz),
    })),
    sinExpedientes: SIN_BANDAS,
    origenes: estacion.origenes.map((origen) => ({
      fuente: NOMBRE_FUENTE[origen.fuente],
      clave: origen.clave,
      fecha:
        origen.afirma === "desmontada"
          ? `la da por desmontada desde el ${fechaCorta(origen.fecha)}`
          : `desde el ${fechaCorta(origen.fecha)}`,
    })),
  }));

export const NOTA_TECNICA =
  "El registro oficial no publica la tecnología, la orientación de los sectores, la altura ni " +
  "la potencia, y Celda aún no tiene los identificadores de celda. La tecnología probable se " +
  "deduce de la banda. En España, el 700 y el 3500 MHz se subastaron para 5G, y el resto se " +
  "usa sobre todo para 4G.";
