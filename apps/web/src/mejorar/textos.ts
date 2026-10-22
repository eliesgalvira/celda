import { gradosEnteros, nombreRumbo } from "../ubicacion/textos.ts";
import { guiaDeGiro, type MotivoSinSensor } from "./estado.ts";

/** Título de la sección de la ficha. */
export const TITULO_MEJORAR = "Mejorar la señal";

const MIENTRAS = "Simula el giro con la barra.";

/** Lo que dice la brújula en cada estado. */
export const TEXTOS_BRUJULA = {
  sinSensor: (motivo: MotivoSinSensor | undefined) => {
    switch (motivo) {
      case "sin-lecturas":
        return {
          titulo: "No llegan datos de la brújula",
          texto: `Puede que este móvil no tenga brújula. ${MIENTRAS}`,
        };
      case "sin-api":
        return {
          titulo: "Giro simulado",
          texto: `Este navegador no deja leer la brújula. ${MIENTRAS}`,
        };
      default:
        return {
          titulo: "Giro simulado",
          texto: `Un ordenador no tiene brújula. ${MIENTRAS}`,
        };
    }
  },
  apagada: "O simula el giro con la barra.",
  explicando: {
    titulo: "Antes de usar la brújula",
    texto:
      "El navegador puede pedirte permiso. Celda solo usa la orientación del móvil para girar la flecha, y no la guarda.",
  },
  pidiendo: "Contesta al aviso del navegador.",
  denegada: {
    titulo: "Sin permiso para la brújula",
    texto: `Puede que el navegador no vuelva a preguntar hasta que abras Celda de nuevo. ${MIENTRAS}`,
  },
  esperando: "Esperando a la brújula…",
  activa: {
    titulo: "Brújula del móvil",
    texto: (margen: number | undefined) =>
      margen === undefined
        ? "Sostén el móvil plano, con la parte de arriba hacia la antena. Si la flecha no cuadra con la calle, dibuja un ocho con el móvil."
        : `Sostén el móvil plano, con la parte de arriba hacia la antena. Según el móvil, la brújula puede desviarse ±${String(Math.round(margen))}°.`,
  },
  dudosa: {
    titulo: "La brújula puede estar mal calibrada",
    texto: "Mueve el móvil dibujando un ocho en el aire varias veces, lejos de objetos de metal.",
  },
} as const;

/** Un rumbo como se lee: «48° (noreste)». */
const rumboLeido = (grados: number): string => {
  const enteros = gradosEnteros(grados);
  return `${enteros}° (${nombreRumbo(enteros)})`;
};

export interface TextosGiro {
  readonly titulo: string;
  readonly descripcion: string;
  /** Qué hacer ahora. */
  readonly guia: string;
  readonly alineado: boolean;
  /** Los dos rumbos en texto, uno por línea. */
  readonly rumbos: ReadonlyArray<string>;
}

/** Lo que dice la brújula del giro: hacia dónde girar, y los rumbos en texto. */
export const textosGiro = (
  objetivo: number,
  rumbo: number,
  fuente: "brujula" | "barra",
): TextosGiro => {
  const guia = guiaDeGiro(objetivo, rumbo);
  const segun = fuente === "brujula" ? "según la brújula del móvil" : "según la barra";
  return {
    titulo: fuente === "brujula" ? "Brújula" : "Brújula simulada con la barra",
    descripcion: `La flecha apunta al emplazamiento, a ${rumboLeido(objetivo)}. El móvil apunta a ${rumboLeido(rumbo)}, ${segun}.`,
    guia: guia.alineado
      ? "Apuntando al emplazamiento"
      : `Gira ${String(guia.grados)}° a la ${guia.sentido}`,
    alineado: guia.alineado,
    rumbos: [`Móvil: ${rumboLeido(rumbo)}`, `Emplazamiento: ${rumboLeido(objetivo)}`],
  };
};
