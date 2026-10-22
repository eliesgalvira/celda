import { type Coordenada, distanciaMetros } from "@celda/dominio/area";
import { type AlcanceDeLosDatos, distanciaALosDatos } from "@celda/dominio/cobertura";
import { bloque, marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";

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

/** Un rumbo en grados enteros entre 0 y 359. */
export const gradosEnteros = (grados: number): number => ((Math.round(grados) % 360) + 360) % 360;

/** La precisión de una lectura del GPS: «±25 m». */
export const textoPrecision = (metros: number): string => `±${Math.max(1, Math.round(metros))} m`;

/** Por encima de este margen, la distancia se da como aproximada. */
const PRECISION_GRUESA = 100;

export interface TextosReferencia {
  /** Desde dónde se mira: «tu ubicación (±25 m)» o «el punto elegido». */
  readonly desde: TextoMarcado;
  /** Si la precisión del GPS no da para fiarse de la distancia, lo dice. */
  readonly margen: TextoMarcado | undefined;
}

/**
 * Los textos del punto de referencia en la ficha de un emplazamiento. Con la ubicación GPS hablan
 * de «ti» y con un punto elegido, del «punto» (historia 31). La distancia y el rumbo los dice
 * «Mejorar la señal», justo debajo.
 */
export const textosReferencia = (
  referencia: Referencia,
  emplazamiento: Coordenada,
): TextosReferencia => {
  if (referencia.tipo === "elegido") {
    return { desde: termino("punto-de-referencia", "el punto elegido"), margen: undefined };
  }
  const metros = distanciaMetros(posicionDe(referencia), emplazamiento);
  const { precision } = referencia.lectura;
  // «Desde» y el margen van en el mismo bloque: la precisión se subraya una sola vez.
  const marcar = bloque();
  return {
    desde: marcar(
      marcado`${termino("punto-de-referencia", "tu ubicación")} (${termino("precision", textoPrecision(precision))})`,
    ),
    margen:
      precision > PRECISION_GRUESA || precision > metros / 2
        ? marcar(
            marcado`Con un ${termino("precision", "margen")} de ${textoPrecision(precision)}, la distancia es aproximada.`,
          )
        : undefined,
  };
};

/** Cómo reactivar la ubicación bloqueada (historia 25). */
export const COMO_REACTIVAR =
  "Para activarla, toca el candado junto a la dirección de la página y permite la ubicación.";

/** Qué ha pasado cuando la ubicación no llega. */
export const TITULO_FALLO: Readonly<Record<MotivoFalloGps, string>> = {
  denegado: "La ubicación está bloqueada",
  "sin-senal": "Tu dispositivo no ha encontrado su posición",
  "sin-fuente": "Este ordenador no puede calcular su posición",
  "tiempo-agotado": "La ubicación no ha llegado a tiempo",
  "no-disponible": "Este navegador no permite usar la ubicación",
};

export const EXPLICACION_FALLO: Readonly<Record<MotivoFalloGps, string>> = {
  denegado: COMO_REACTIVAR,
  "sin-senal": "Pasa en interiores o con la ubicación desactivada.",
  "sin-fuente": "Busca una dirección o, en el móvil, usa tu ubicación.",
  "tiempo-agotado": "Pasa en interiores o con la ubicación desactivada.",
  "no-disponible": "Busca una dirección o elige el punto en el mapa.",
};

/**
 * Hasta dónde, pasado el borde de lo barrido, el punto de referencia aún cuenta como dentro: a
 * 3 km del borde siguen viéndose emplazamientos alrededor del punto.
 */
export const MARGEN_DE_LOS_DATOS = 3000;

/**
 * A cuántos metros queda el punto de referencia de los datos, si queda fuera de ellos y de su
 * margen. Los datos son la cobertura real del resumen nacional (ADR 0016): las zonas barridas
 * recortadas a las cajas de los emplazamientos de sus provincias (`distanciaALosDatos`). Sin
 * resumen, o sin ninguna zona barrida, no se sabe y no dice nada.
 */
export const fueraDeLosDatos = (
  referencia: Referencia,
  alcance: AlcanceDeLosDatos | undefined,
): number | undefined => {
  const metros =
    alcance === undefined ? undefined : distanciaALosDatos(posicionDe(referencia), alcance);
  return metros !== undefined && metros > MARGEN_DE_LOS_DATOS ? metros : undefined;
};

export interface TextosFueraDeLosDatos {
  readonly titulo: string;
  readonly texto: string;
}

/**
 * Qué decir cuando el punto de referencia queda lejos de los datos. Desde 10 km, los kilómetros van
 * con un espacio que no parte la línea. No nombra la zona cubierta: sale de la distancia a lo barrido, y
 * sigue siendo verdad al ampliarlo.
 */
export const textosFueraDeLosDatos = (
  referencia: Referencia,
  metros: number,
): TextosFueraDeLosDatos => {
  const lejos =
    metros < 10_000
      ? textoDistancia(metros)
      : `unos ${KILOMETROS.format(Math.round(metros / 1000))}\u00a0km`;
  if (referencia.tipo === "elegido") {
    return {
      titulo: "Celda aún no tiene datos de ese punto",
      texto: `Los datos más cercanos quedan a ${lejos}. Puede haber antenas alrededor del punto aunque no se vean.`,
    };
  }
  return {
    titulo: "Celda aún no tiene datos de donde estás",
    texto: `Los datos más cercanos quedan a ${lejos} de ti. Puede haber antenas a tu alrededor aunque no se vean.`,
  };
};
