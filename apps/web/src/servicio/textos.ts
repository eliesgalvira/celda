import { marcado, primeraVezEn, termino, type TextoMarcado } from "@celda/dominio/glosario";
import type { DatoServicio } from "@celda/ui/ubicacion/LecturaServicio.tsx";

import { azimutDe, enumerar, type Orientacion } from "../ficha/diagrama.ts";
import type { Referencia } from "../ubicacion/estado.ts";
import { nombreRumbo, textoDistancia } from "../ubicacion/textos.ts";
import type { LecturaServicio } from "./servicio.ts";

/** Hasta aquí del eje se está «casi de frente»: pierde menos de 1,2 dB. */
const DE_FRENTE_GRADOS = 20;
/** Desde aquí se está entre dos sectores: pierde más de 5,7 dB y el vecino está cerca. */
const ENTRE_DOS_GRADOS = 45;

const UN_DECIMAL = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** «0 dB» en el eje; «−2,6 dB» fuera, con el signo menos de verdad. */
export const textoGanancia = (db: number): string =>
  db > -0.05 ? "0 dB" : `−${UN_DECIMAL.format(-db)} dB`;

export interface TextosServicio {
  /** Las tres casillas: qué sector, cuánto se pierde y a qué distancia y hacia dónde. */
  readonly datos: ReadonlyArray<DatoServicio>;
  /** La frase que lo explica. */
  readonly veredicto: TextoMarcado;
  /** De dónde sale la orientación y qué quiere decir para el sector que da servicio. */
  readonly nota: TextoMarcado;
  /** Lo que dice la etiqueta junto al punto en el mapa: «340 m · sector 2». */
  readonly enMapa: string;
}

/**
 * Los textos del sector que da servicio (historias 30 y 31). Con la ubicación GPS hablan de «ti»
 * y con un punto elegido, del «punto». Dicen siempre que es un modelo y de dónde sale la
 * orientación.
 */
export const textosServicio = (
  lectura: LecturaServicio,
  tipo: Referencia["tipo"],
  orientacion: Orientacion,
): TextosServicio => {
  const tu = tipo === "gps";
  const esta = tu ? "Estás" : "El punto está";
  const distancia = textoDistancia(lectura.distancia);
  // El emplazamiento visto desde el punto: el rumbo contrario al del emplazamiento al punto.
  const hacia = `hacia el ${nombreRumbo(lectura.rumbo + 180)}`;
  // El veredicto y la nota se leen seguidos: cada término se subraya una vez entre los dos.
  const conNota = (veredicto: TextoMarcado) => {
    const [primero = [], nota = []] = primeraVezEn([veredicto, notaServicio(orientacion)]);
    return { veredicto: primero, nota };
  };

  if (lectura.sector === undefined) {
    return {
      datos: [
        { valor: "Ninguno", etiqueta: "al pie" },
        { valor: "Sin eje", etiqueta: "respecto al eje" },
        { valor: distancia, etiqueta: "del emplazamiento" },
      ],
      ...conNota(
        marcado`${esta} al pie del ${termino("emplazamiento", "emplazamiento")}. Desde tan cerca no se puede decir qué ${termino("sector-que-da-servicio", "sector")} ${tu ? "te" : "le"} da servicio.`,
      ),
      enMapa: `${distancia} · al pie`,
    };
  }

  const numero = lectura.sector + 1;
  const azimut = azimutDe(orientacion, orientacion.azimuts[lectura.sector] ?? 0);
  const sector = marcado`${termino("sector-que-da-servicio", `sector ${numero}`)} (${azimut})`;
  const grados = Math.round(Math.abs(lectura.desviacion));
  const pierde = tu ? "pierdes" : "se pierden";
  const db = termino("decibelio", "dB");
  const frase =
    grados < DE_FRENTE_GRADOS
      ? marcado`${esta} casi de frente al ${sector}, donde su haz manda más señal.`
      : grados < ENTRE_DOS_GRADOS
        ? marcado`${esta} a ${String(grados)}° del eje del ${sector} y ${pierde} ${UN_DECIMAL.format(-lectura.gananciaDb)} ${db}, poca cosa.`
        : marcado`${esta} entre dos sectores, a ${String(grados)}° del eje del ${sector}, y ${pierde} unos ${String(Math.round(-lectura.gananciaDb))} ${db}. Es donde un sector le pasa el relevo al otro.`;
  const fuera =
    lectura.enCelda === false
      ? marcado` Además, ${tu ? "estás" : "el punto está"} fuera de la ${termino("celda", "celda")} de este emplazamiento: hay otro más cerca, que puede ser el que ${tu ? "te" : "le"} da servicio.`
      : [];
  return {
    datos: [
      { valor: `Sector ${numero}`, etiqueta: tu ? "te da servicio" : "da servicio" },
      { valor: textoGanancia(lectura.gananciaDb), etiqueta: "respecto al eje" },
      { valor: distancia, etiqueta: hacia },
    ],
    ...conNota([...frase, ...fuera]),
    enMapa: `${distancia} · sector ${numero}`,
  };
};

/** De dónde sale la orientación de los sectores y qué quiere decir para el que da servicio. */
export const notaServicio = (orientacion: Orientacion): TextoMarcado => {
  const servicio = termino("sector-que-da-servicio", "sector que da servicio");
  return orientacion.tipo === "estimada"
    ? marcado`${termino("azimut", "Orientación")} estimada, con ±${String(orientacion.margen)}° de margen en cada eje. Cerca del límite entre dos sectores, el ${servicio} puede ser el de al lado.`
    : marcado`${termino("azimut", "Orientación")} supuesta a ${enumerar(orientacion.azimuts)}: ninguna fuente publica hacia dónde apuntan los sectores, así que el ${servicio} sale de esa suposición y puede ser otro.`;
};
