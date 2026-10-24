import {
  type Baremo,
  bajoElUnoDeCadaCien,
  compararMedida,
  type MedidaComparada,
  zonaDeComparacion,
} from "@celda/dominio/baremo";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { enumerar } from "@celda/dominio/enumerar";
import {
  claveDeMedida,
  type MedidaDeExposicion,
  NIVEL_DE_REFERENCIA_MAS_BAJO,
} from "@celda/dominio/exposicion";
import type { EstacionDeFicha, Ficha } from "@celda/dominio/ficha";
import { llano, marcado, primeraVezEn, termino, type TextoMarcado } from "@celda/dominio/glosario";
import type { EstacionExpuesta } from "@celda/ui/panel/Exposicion.tsx";

import { nombreRumbo } from "../ubicacion/textos.ts";
import { nombreDeZona, sinMedidasDe } from "./textos.ts";

const NIVEL = `${NIVEL_DE_REFERENCIA_MAS_BAJO}\u00a0µW/cm²`;

export const TITULO_EXPOSICION: TextoMarcado = marcado`${termino("medida-de-exposicion", "Medidas de exposición")}`;

const VALOR = new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 3 });
const PORCENTAJE = new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 2 });
const METROS = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

const textoValor = (microvatiosPorCm2: number): string => VALOR.format(microvatiosPorCm2);

/** «a 55 m», sin que el número y la unidad se separen. El registro da los metros enteros, así que 0 m es menos de 1. */
const aDistancia = (metros: number): string =>
  metros < 1 ? "a menos de 1\u00a0m" : `a ${METROS.format(metros)}\u00a0m`;

/** Cómo queda la medida más alta frente a las de su zona, o por qué no se compara. */
export type FrenteAOtrasMedidas =
  | {
      readonly tipo: "comparada";
      /** De cada 100 medidas de la zona, cuántas quedan por debajo: de 0 a 99. */
      readonly masAltaQue: number;
      /** Con qué medidas se compara y la típica allí. */
      readonly nota: string;
    }
  | { readonly tipo: "sin-zona"; readonly nota: string };

/** La medida más alta del emplazamiento, ya escrita. */
export interface MaximaDeExposicion {
  /** En µW/cm², sin la unidad: «2,15». */
  readonly valor: string;
  /** Las compañías que la publican: dos, si es de un emplazamiento compartido. */
  readonly companias: ReadonlyArray<Compania>;
  /** «Orange, a 55 m de la antena». */
  readonly quien: string;
  /** La barra de 0 a la medida más alta de España, con el baremo. */
  readonly barra: { readonly parte: number; readonly final: string } | undefined;
  /** Cuánto es frente al nivel de referencia y, con la barra, hasta dónde llega. */
  readonly nota: TextoMarcado;
  /** Sin el baremo, nada. */
  readonly frente: FrenteAOtrasMedidas | undefined;
}

export interface TextosExposicion {
  /** Sin ninguna medida, nada. */
  readonly maxima: MaximaDeExposicion | undefined;
  readonly estaciones: ReadonlyArray<EstacionExpuesta>;
  /** Qué son las medidas, en el plegable de la sección. Sin ninguna medida, nada. */
  readonly explicacion: ReadonlyArray<TextoMarcado>;
}

/** Las estaciones base de la ficha con alguna medida de exposición. */
export const estacionesConMedidas = (ficha: Ficha): ReadonlyArray<EstacionDeFicha> =>
  ficha.estaciones.filter((estacion) => (estacion.medidasDeExposicion ?? []).length > 0);

/** Con qué se comparan las medidas de una ficha: cómo queda cada una y qué decir de la zona. */
interface Comparacion {
  readonly de: (medida: MedidaDeExposicion) => MedidaComparada;
  /** «Se compara con las medidas de la provincia de Barcelona, porque en Gavà hay pocas.» */
  readonly conQue: string;
}

/** La típica allí a la distancia de la más alta y, si son 2 o más, cuántas veces es esta. */
const laTipica = (comparada: MedidaComparada, maxima: MedidaDeExposicion): string => {
  const veces = Math.round(maxima.microvatiosPorCm2 / comparada.tipica);
  return `La típica ${aDistancia(maxima.distanciaMetros)} de la antena es ${textoValor(comparada.tipica)}\u00a0µW/cm²${veces >= 2 ? `, y esta es unas ${veces} veces mayor` : ""}.`;
};

/**
 * Lo que dice de una ficha la sección de las medidas de exposición del ministerio (ADR 0030). Con
 * el baremo de su provincia, sitúa la más alta entre las de España y la compara, como cada
 * medida, con las de su zona teniendo en cuenta la distancia; sin él, porque no ha llegado o
 * porque esa versión no lo tiene, enseña las medidas sin comparar.
 */
export const textosExposicion = (ficha: Ficha, baremo: Baremo | undefined): TextosExposicion => {
  const elegida =
    baremo === undefined || ficha.lugar === undefined
      ? undefined
      : zonaDeComparacion(baremo, ficha.lugar);
  const municipio = ficha.lugar?.municipio ?? null;
  const comparacion: Comparacion | undefined =
    baremo === undefined || elegida === undefined
      ? undefined
      : {
          de: (medida) => compararMedida(baremo, elegida.zona, medida),
          conQue: `Se compara con las medidas de ${nombreDeZona(elegida)}${
            elegida.tipo === "provincia" && municipio !== null
              ? `, porque en ${nombreDeZona({ tipo: "municipio", lugar: municipio })} hay pocas`
              : ""
          }.`,
        };

  const estaciones = ficha.estaciones.map((estacion): EstacionExpuesta => ({
    compania: estacion.compania,
    nombre: NOMBRE_COMPANIA[estacion.compania],
    filas: (estacion.medidasDeExposicion ?? []).map((medida) => {
      const comparada = comparacion?.de(medida);
      return {
        distancia: `${METROS.format(medida.distanciaMetros)} m`,
        direccion: nombreRumbo(medida.acimutGrados),
        valor: textoValor(medida.microvatiosPorCm2),
        comparacion: comparada === undefined ? undefined : { masAltaQue: comparada.masAltaQue },
      };
    }),
    sinMedidas: sinMedidasDe(estacion),
  }));

  const conMedidas = estacionesConMedidas(ficha);
  const maxima = conMedidas
    .flatMap((estacion) => estacion.medidasDeExposicion ?? [])
    .reduce<MedidaDeExposicion | undefined>(
      (mayor, medida) =>
        mayor === undefined || medida.microvatiosPorCm2 > mayor.microvatiosPorCm2 ? medida : mayor,
      undefined,
    );
  if (maxima === undefined) return { maxima: undefined, estaciones, explicacion: [] };

  const companias = conMedidas
    .filter((estacion) =>
      (estacion.medidasDeExposicion ?? []).some(
        (medida) => claveDeMedida(medida) === claveDeMedida(maxima),
      ),
    )
    .map((estacion) => estacion.compania);
  const valor = maxima.microvatiosPorCm2;
  const espana = baremo?.espana;
  const delNivel = marcado`Es el ${PORCENTAJE.format((100 * valor) / NIVEL_DE_REFERENCIA_MAS_BAJO)}\u00a0% del ${termino("nivel-de-referencia", "nivel de referencia")}, que es ${NIVEL}.`;
  const provincia = ficha.lugar?.provincia ?? null;
  const frente: FrenteAOtrasMedidas | undefined =
    comparacion !== undefined
      ? {
          tipo: "comparada",
          masAltaQue: comparacion.de(maxima).masAltaQue,
          nota: `${comparacion.conQue} ${laTipica(comparacion.de(maxima), maxima)}`,
        }
      : baremo !== undefined && provincia !== null
        ? {
            tipo: "sin-zona",
            nota: `No se compara con otras medidas porque en ${nombreDeZona({ tipo: "provincia", lugar: provincia })} hay medidas de pocos emplazamientos.`,
          }
        : undefined;

  const nota =
    espana === undefined
      ? delNivel
      : [
          ...delNivel,
          ...llano(
            ` La barra llega hasta la medida más alta de España, ${textoValor(espana.maxima)}\u00a0µW/cm². ${bajoElUnoDeCadaCien(espana)} de cada 100 medidas de España no llegan al 1\u00a0% del nivel de referencia.`,
          ),
        ];
  const explicacion = [
    marcado`Cada medida suma todo lo que llega a ese punto, de todas las compañías y también de la radio y la televisión, y por eso la norma la compara con ${NIVEL}, su ${termino("nivel-de-referencia", "nivel de referencia")} más bajo.${conMedidas.length > 1 ? " Por lo mismo, las de dos compañías no se suman." : ""}`,
    llano(
      "Son comprobaciones de las Jefaturas de Inspección o certificaciones de las compañías, y el ministerio no dice cuál es cada una ni cuándo se hizo. Sirven para comprobar que no se pasa del nivel de referencia, y no dicen nada de cómo funciona un móvil allí.",
    ),
  ];
  const [, notaMarcada = nota] = primeraVezEn([TITULO_EXPOSICION, nota]);

  return {
    maxima: {
      valor: textoValor(valor),
      companias,
      quien: `${enumerar(companias.map((compania) => NOMBRE_COMPANIA[compania]))}, ${aDistancia(maxima.distanciaMetros)} de la antena`,
      barra:
        espana === undefined
          ? undefined
          : { parte: valor / espana.maxima, final: textoValor(espana.maxima) },
      nota: notaMarcada,
      frente,
    },
    estaciones,
    // El plegable es otro bloque: vuelve a subrayar los términos.
    explicacion: primeraVezEn(explicacion),
  };
};
