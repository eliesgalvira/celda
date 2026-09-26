import { type Coordenada, distanciaMetros, rumboGrados } from "@celda/dominio/area";

import { type MotivoFalloGps, posicionDe, type Referencia } from "./estado.ts";

const KILOMETROS = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

/** Una distancia legible: de 10 en 10 metros hasta el kilómetro y en kilómetros a partir de ahí. */
export const textoDistancia = (metros: number): string => {
  if (metros < 995) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  return `${KILOMETROS.format(metros / 1000)} km`;
};

const RUMBOS = [
  "norte",
  "noreste",
  "este",
  "sureste",
  "sur",
  "suroeste",
  "oeste",
  "noroeste",
] as const;

/** El nombre de un rumbo en ocho direcciones: 48° es «noreste». */
export const nombreRumbo = (grados: number): string =>
  RUMBOS[Math.round((((grados % 360) + 360) % 360) / 45) % 8] ?? "norte";

/** La precisión de una lectura del GPS: «±25 m». */
export const textoPrecision = (metros: number): string => `±${Math.max(1, Math.round(metros))} m`;

/** Por encima de este margen, la distancia se da como aproximada. */
const PRECISION_GRUESA = 100;

export interface TextosReferencia {
  /** Desde dónde se mira: «tu ubicación (±25 m)» o «el punto elegido». */
  readonly desde: string;
  /** Dónde queda el emplazamiento visto desde el punto de referencia. */
  readonly relacion: string;
  /** Si la precisión del GPS no da para fiarse de la distancia, lo dice. */
  readonly margen: string | undefined;
}

/**
 * Los textos del punto de referencia en la ficha de un emplazamiento. Con la ubicación GPS hablan
 * de «ti» y con un punto elegido, del «punto» (historia 31).
 */
export const textosReferencia = (
  referencia: Referencia,
  emplazamiento: Coordenada,
): TextosReferencia => {
  const desde = posicionDe(referencia);
  const metros = distanciaMetros(desde, emplazamiento);
  const rumbo = Math.round(rumboGrados(desde, emplazamiento)) % 360;
  const hacia = metros < 5 ? "." : `, hacia el ${nombreRumbo(rumbo)} (${rumbo}°).`;
  if (referencia.tipo === "elegido") {
    return {
      desde: "el punto elegido",
      relacion: `El emplazamiento está a ${textoDistancia(metros)} del punto${hacia}`,
      margen: undefined,
    };
  }
  const { precision } = referencia.lectura;
  return {
    desde: `tu ubicación (${textoPrecision(precision)})`,
    relacion: `El emplazamiento está a ${textoDistancia(metros)} de ti${hacia}`,
    margen:
      precision > PRECISION_GRUESA || precision > metros / 2
        ? `Tu ubicación tiene un margen de ${textoPrecision(precision)}, así que la distancia es aproximada.`
        : undefined,
  };
};

/** Qué se gana con un punto de referencia, en el panel sin punto. */
export const PARA_QUE_SIRVE =
  "Con un punto te decimos a qué distancia queda este emplazamiento y en qué dirección.";

/** Cómo reactivar la ubicación bloqueada (historia 25). */
export const COMO_REACTIVAR =
  "Has bloqueado la ubicación para esta web. Para activarla, toca el candado o el icono de ajustes junto a la dirección de la página, entra en «Ubicación» y elige «Permitir». Mientras tanto, puedes elegir el punto en el mapa.";

/** Qué ha pasado cuando la ubicación no llega. */
export const TITULO_FALLO: Readonly<Record<MotivoFalloGps, string>> = {
  denegado: "Has bloqueado la ubicación",
  "sin-senal": "Tu dispositivo no sabe dónde está",
  "tiempo-agotado": "La ubicación no ha llegado a tiempo",
  "no-disponible": "Este navegador no da la ubicación",
};

export const EXPLICACION_FALLO: Readonly<Record<MotivoFalloGps, string>> = {
  denegado: COMO_REACTIVAR,
  "sin-senal":
    "No ha podido calcular tu posición. Pasa a veces en interiores o con la ubicación del dispositivo apagada. Puedes volver a intentarlo o elegir el punto en el mapa.",
  "tiempo-agotado":
    "Tu dispositivo ha tardado demasiado en calcular tu posición. Puedes volver a intentarlo o elegir el punto en el mapa.",
  "no-disponible":
    "El navegador no deja que la web pida la ubicación. Suele pasar si la página no va por https o si el navegador no lo admite. Puedes elegir el punto en el mapa.",
};
