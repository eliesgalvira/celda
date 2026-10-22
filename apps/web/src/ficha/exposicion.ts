import {
  type Baremo,
  compararMedida,
  type MedidaComparada,
  zonaDeComparacion,
} from "@celda/dominio/baremo";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";
import type { EstacionDeFicha, Ficha } from "@celda/dominio/ficha";
import { llano, marcado, primeraVezEn, termino, type TextoMarcado } from "@celda/dominio/glosario";
import type { EstacionExpuesta } from "@celda/ui/panel/Exposicion.tsx";

import { nombreRumbo } from "../ubicacion/textos.ts";
import { nombreDeZona, sinMedidasDe } from "./textos.ts";

/**
 * El nivel de referencia más bajo del anexo II del Real Decreto 1066/2001, en µW/cm²: el de 10 a
 * 400 MHz, donde está la radio FM. La norma compara con él una medida que suma todas las
 * frecuencias (investigación 09, apartado 2.2).
 */
const NIVEL_DE_REFERENCIA_MAS_BAJO = 200;

const NIVEL = `${NIVEL_DE_REFERENCIA_MAS_BAJO} µW/cm²`;

export const TITULO_EXPOSICION: TextoMarcado = marcado`${termino("medida-de-exposicion", "Medidas de exposición")}`;

const VALOR = new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 3 });
const PORCENTAJE = new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 2 });
const METROS = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

const textoValor = (microvatiosPorCm2: number): string => VALOR.format(microvatiosPorCm2);

const masAltaQue = (comparada: MedidaComparada): string => `${comparada.masAltaQue} de cada 100`;

export interface TextosExposicion {
  /** Las frases de la sección, sin volver a subrayar el término de su título. */
  readonly frases: ReadonlyArray<TextoMarcado>;
  readonly estaciones: ReadonlyArray<EstacionExpuesta>;
}

/** Las estaciones base de la ficha con alguna medida de exposición. */
export const estacionesConMedidas = (ficha: Ficha): ReadonlyArray<EstacionDeFicha> =>
  ficha.estaciones.filter((estacion) => (estacion.medidasDeExposicion ?? []).length > 0);

/** Con qué se comparan las medidas de una ficha: el nombre de su zona y cómo queda cada una. */
interface Comparacion {
  readonly zona: string;
  readonly de: (medida: MedidaDeExposicion) => MedidaComparada;
}

/** Cómo queda la medida más alta frente a las de su zona, en la frase de la sección. */
const frenteASuZona = (comparacion: Comparacion, maxima: MedidaDeExposicion): string => {
  const comparada = comparacion.de(maxima);
  const veces = Math.round(maxima.microvatiosPorCm2 / comparada.tipica);
  return ` Teniendo en cuenta la distancia a la antena, es más alta que ${masAltaQue(comparada)} medidas de ${comparacion.zona}${veces >= 2 ? ` y unas ${veces} veces la típica` : ""}.`;
};

/**
 * Lo que dice de una ficha la sección de las medidas de exposición del ministerio (ADR 0030). Con
 * el baremo de su provincia, compara cada medida con las de su zona teniendo en cuenta la
 * distancia; sin él, porque no ha llegado o porque esa versión no lo tiene, enseña las medidas sin
 * comparar.
 */
export const textosExposicion = (ficha: Ficha, baremo: Baremo | undefined): TextosExposicion => {
  const elegida =
    baremo === undefined || ficha.lugar === undefined
      ? undefined
      : zonaDeComparacion(baremo, ficha.lugar);
  const comparacion: Comparacion | undefined =
    baremo === undefined || elegida === undefined
      ? undefined
      : {
          zona: nombreDeZona(elegida),
          de: (medida) => compararMedida(baremo, elegida.zona, medida),
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
        comparacion:
          comparada === undefined
            ? undefined
            : { tipica: textoValor(comparada.tipica), masAltaQue: masAltaQue(comparada) },
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
  if (maxima === undefined) return { frases: [], estaciones };

  const valor = maxima.microvatiosPorCm2;
  const deLaMaxima = `La medida más alta es de ${textoValor(valor)} µW/cm², el ${PORCENTAJE.format((100 * valor) / NIVEL_DE_REFERENCIA_MAS_BAJO)} % de ${NIVEL}.`;
  const provincia = ficha.lugar?.provincia ?? null;
  const sinZona =
    baremo !== undefined && elegida === undefined && provincia !== null
      ? [
          llano(
            `Celda no las compara con las de su zona porque en ${nombreDeZona({ tipo: "provincia", lugar: provincia })} hay medidas de pocos emplazamientos.`,
          ),
        ]
      : [];

  const frases = [
    llano(comparacion === undefined ? deLaMaxima : deLaMaxima + frenteASuZona(comparacion, maxima)),
    ...sinZona,
    marcado`Cada medida suma todo lo que llega a ese punto, de todas las compañías y también de la radio y la televisión, y por eso la norma la compara con ${NIVEL}, su ${termino("nivel-de-referencia", "nivel de referencia")} más bajo.${conMedidas.length > 1 ? " Por lo mismo, las de dos compañías no se suman." : ""}`,
    llano(
      "Son comprobaciones de las Jefaturas de Inspección o certificaciones de las compañías, y el ministerio no dice cuál es cada una ni cuándo se hizo. Sirven para comprobar que se cumple el límite legal y no dicen nada de cómo funciona un móvil allí.",
    ),
  ];
  return { frases: primeraVezEn([TITULO_EXPOSICION, ...frases]).slice(1), estaciones };
};
