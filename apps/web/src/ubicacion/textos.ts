import { type Coordenada, distanciaMetros, rumboGrados } from "@celda/dominio/area";
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

/** La precisión de una lectura del GPS: «±25 m». */
export const textoPrecision = (metros: number): string => `±${Math.max(1, Math.round(metros))} m`;

/** Por encima de este margen, la distancia se da como aproximada. */
const PRECISION_GRUESA = 100;

export interface TextosReferencia {
  /** Desde dónde se mira: «tu ubicación (±25 m)» o «el punto elegido». */
  readonly desde: TextoMarcado;
  /** Dónde queda el emplazamiento visto desde el punto de referencia. */
  readonly relacion: string;
  /** Si la precisión del GPS no da para fiarse de la distancia, lo dice. */
  readonly margen: TextoMarcado | undefined;
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
      desde: termino("punto-de-referencia", "el punto elegido"),
      relacion: `El emplazamiento está a ${textoDistancia(metros)} del punto${hacia}`,
      margen: undefined,
    };
  }
  const { precision } = referencia.lectura;
  // «Desde» y el margen van en el mismo bloque: la precisión se subraya una sola vez.
  const marcar = bloque();
  return {
    desde: marcar(
      marcado`${termino("punto-de-referencia", "tu ubicación")} (${termino("precision", textoPrecision(precision))})`,
    ),
    relacion: `El emplazamiento está a ${textoDistancia(metros)} de ti${hacia}`,
    margen:
      precision > PRECISION_GRUESA || precision > metros / 2
        ? marcar(
            marcado`Tu ubicación tiene un ${termino("precision", "margen")} de ${textoPrecision(precision)}, así que la distancia es aproximada.`,
          )
        : undefined,
  };
};

/** Qué se gana con un punto de referencia, en el panel sin punto. */
export const PARA_QUE_SIRVE: TextoMarcado = marcado`Con un ${termino("punto-de-referencia", "punto")} te decimos a qué distancia queda este ${termino("emplazamiento", "emplazamiento")} y en qué dirección.`;

/** Cómo reactivar la ubicación bloqueada (historia 25). */
export const COMO_REACTIVAR =
  "Has bloqueado la ubicación para esta web. Para activarla, toca el candado o el icono de ajustes junto a la dirección de la página, entra en «Ubicación» y elige «Permitir». Mientras tanto, puedes elegir el punto en el mapa.";

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
  "sin-senal":
    "El dispositivo no ha podido calcular tu posición. Pasa a veces en interiores o con la ubicación del dispositivo desactivada. Puedes volver a intentarlo o elegir el punto en el mapa.",
  "sin-fuente":
    "Los ordenadores no tienen GPS. El navegador obtiene la posición de un servicio que la calcula con las redes wifi cercanas, y en este ordenador ese servicio no existe o no ha respondido. Pasa a menudo con Chromium en Linux. Puedes elegir el punto en el mapa o buscar una dirección, y en el móvil sí podrás usar tu ubicación.",
  "tiempo-agotado":
    "Tu dispositivo ha tardado demasiado en calcular tu posición. Pasa a veces en interiores o con la ubicación del dispositivo desactivada. Puedes volver a intentarlo o elegir el punto en el mapa.",
  "no-disponible":
    "El navegador no deja que la web pida la ubicación. Suele pasar si la página no va por https o si el navegador no lo admite. Puedes elegir el punto en el mapa.",
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
 * Qué decir cuando el punto de referencia queda lejos de los datos. Los kilómetros van con un
 * espacio que no parte la línea. No nombra la zona cubierta: sale de la distancia a lo barrido, y
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
      texto: `Los datos más cercanos quedan a ${lejos}. Ese lugar todavía no está en el mapa, así que puede haber antenas alrededor del punto aunque no se vean.`,
    };
  }
  return {
    titulo: "Celda aún no tiene datos de donde estás",
    texto: `Los datos más cercanos quedan a ${lejos} de ti. Ese lugar todavía no está en el mapa, así que puede haber antenas a tu alrededor aunque no se vean.`,
  };
};
