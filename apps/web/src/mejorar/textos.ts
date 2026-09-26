import { nombreRumbo } from "../ubicacion/textos.ts";
import { guiaDeGiro, type MotivoSinSensor } from "./estado.ts";

/** Título de la sección de la ficha. */
export const TITULO_MEJORAR = "Mejorar la señal";

const MIENTRAS = "Mientras, la barra simula el giro.";

/** Lo que dice la brújula en cada estado. */
export const TEXTOS_BRUJULA = {
  sinSensor: (motivo: MotivoSinSensor | undefined) => {
    switch (motivo) {
      case "sin-lecturas":
        return {
          titulo: "El móvil no da la brújula",
          texto: `No ha llegado ninguna lectura. Puede que este móvil no tenga brújula o que el navegador no la dé. ${MIENTRAS}`,
        };
      case "sin-api":
        return {
          titulo: "Giro simulado",
          texto: `Este navegador no da la brújula del dispositivo. Mueve la barra para ver cómo giraría la flecha.`,
        };
      default:
        return {
          titulo: "Giro simulado",
          texto:
            "Un ordenador no tiene brújula. Mueve la barra para ver cómo giraría la flecha con el móvil en la mano.",
        };
    }
  },
  apagada: `La flecha girará con el móvil. ${MIENTRAS}`,
  explicando: {
    titulo: "Antes de usar la brújula",
    texto:
      "Puede que tu navegador te pregunte si Celda puede leer el movimiento y la orientación del móvil. Solo sirve para girar la flecha. Se lee en tu dispositivo y no se guarda.",
  },
  pidiendo: "Contesta al aviso del navegador.",
  denegada: {
    titulo: "Sin permiso para la brújula",
    texto: `Puede que el navegador no vuelva a preguntar hasta que cierres la pestaña y abras Celda de nuevo. ${MIENTRAS}`,
  },
  esperando: "Esperando a la brújula…",
  activa: {
    titulo: "Brújula del móvil",
    texto: (margen: number | undefined) =>
      margen === undefined
        ? "Sostén el móvil plano, con la parte de arriba hacia donde apuntará la antena. Si la flecha no cuadra con la calle, mueve el móvil dibujando un ocho para calibrarla."
        : `Sostén el móvil plano, con la parte de arriba hacia donde apuntará la antena. La brújula dice que puede fallar ±${String(Math.round(margen))}°.`,
  },
  dudosa: {
    titulo: "La brújula puede estar mal calibrada",
    texto: "Mueve el móvil dibujando un ocho en el aire varias veces, lejos de objetos de metal.",
  },
} as const;

/** Un rumbo como se lee: «48° (noreste)». */
const rumboLeido = (grados: number): string => {
  const enteros = ((Math.round(grados) % 360) + 360) % 360;
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
