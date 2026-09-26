import {
  diagramaSector,
  type ParamsDiagramaSector,
  type ResultadoDiagramaSector,
  SECTOR_TIPICO,
} from "@celda/sim/diagramaSector";
import { bloque, marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";
import { mallaDeRumbos } from "@celda/sim/simulacion";
import type { LobuloSector } from "@celda/ui/panel/DiagramaRadiacion.tsx";

/** Título de la sección del panel con el diagrama de radiación. */
export const TITULO_COMO_EMITE = "Cómo emite";

/** Margen de una orientación estimada, en grados, a cada lado. */
export const MARGEN_ESTIMADO = 15;

/** El reparto habitual de tres sectores, que se dibuja cuando no hay ninguna estimación. */
export const AZIMUTS_SUPUESTOS: ReadonlyArray<number> = [0, 120, 240];

/**
 * Hacia dónde apuntan los sectores. Ninguna fuente publica los azimuts
 * (docs/investigacion/registro-oficial.md), así que nunca es un dato: o una estimación con su
 * margen, o, si no hay ninguna, una orientación supuesta que se dice como tal.
 */
export type Orientacion =
  | {
      readonly tipo: "estimada";
      readonly azimuts: ReadonlyArray<number>;
      readonly margen: number;
    }
  | { readonly tipo: "supuesta"; readonly azimuts: ReadonlyArray<number> };

/** La orientación que se dibuja a partir de los azimuts estimados que haya. */
export const orientacionDe = (estimados: ReadonlyArray<number>): Orientacion =>
  estimados.length === 0
    ? { tipo: "supuesta", azimuts: AZIMUTS_SUPUESTOS }
    : { tipo: "estimada", azimuts: estimados, margen: MARGEN_ESTIMADO };

/** Un rumbo cada 2°: 180 puntos por sector, de sobra para un diagrama de 300 px. */
const PASO_GRADOS = 2;
export const MALLA_DIAGRAMA = mallaDeRumbos(PASO_GRADOS);
export const RUMBOS_DIAGRAMA: ReadonlyArray<number> = Array.from(
  { length: MALLA_DIAGRAMA.este.length },
  (_, i) => i * PASO_GRADOS,
);

/** Los parámetros de la simulación para una orientación: la antena de sector típica. */
export const paramsDiagrama = (orientacion: Orientacion): ParamsDiagramaSector => ({
  azimuts: orientacion.azimuts,
  ...SECTOR_TIPICO,
});

const grados = (azimut: number): string => `${Math.round(azimut)}°`;

/** El rumbo de un sector como se escribe: «120°» si es supuesto, «120° ±15°» si es estimado. */
const azimutDe = (orientacion: Orientacion, azimut: number): string =>
  orientacion.tipo === "estimada" ? `${grados(azimut)} ±${orientacion.margen}°` : grados(azimut);

/** «0°, 120° y 240°». */
const enumerar = (azimuts: ReadonlyArray<number>): string => {
  const partes = azimuts.map(grados);
  return partes.length < 2
    ? (partes[0] ?? "")
    : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1) ?? ""}`;
};

const ORIENTACION = termino("azimut", "Orientación");

export interface TextosDiagrama {
  readonly titulo: string;
  readonly descripcion: string;
  readonly modelo: string;
  readonly leyenda: ReadonlyArray<string>;
  /** Con la orientación, los sectores y el modelo subrayados una vez entre todas. */
  readonly notas: ReadonlyArray<TextoMarcado>;
}

/** Lo que dice el diagrama: qué modelo es, hacia dónde apunta cada sector y de dónde sale. */
export const textosDiagrama = (orientacion: Orientacion): TextosDiagrama => {
  const n = orientacion.azimuts.length;
  const sectores = n === 1 ? "Un sector" : `${n} sectores`;
  const forma = marcado`Forma: ${termino("modelo", "modelo")} típico de antena de ${termino("sector", "sector")}, con un haz de ${String(SECTOR_TIPICO.anchoHazGrados)}°.`;
  const hacia =
    orientacion.tipo === "estimada"
      ? `con orientación estimada a ${enumerar(orientacion.azimuts)}, ±${orientacion.margen}°`
      : `con orientación supuesta a ${enumerar(orientacion.azimuts)}`;
  return {
    titulo: "Diagrama de radiación de los sectores",
    descripcion: `Modelo, no medida. ${sectores} ${hacia}. Cada uno concentra la señal en un haz de ${SECTOR_TIPICO.anchoHazGrados}° y pierde hasta ${SECTOR_TIPICO.atenuacionMaximaDb} dB hacia atrás.`,
    modelo: `${diagramaSector.id} v${diagramaSector.version}`,
    leyenda: orientacion.azimuts.map(
      (azimut, k) => `Sector ${k + 1} · ${azimutDe(orientacion, azimut)}`,
    ),
    notas: (orientacion.tipo === "estimada"
      ? [marcado`${ORIENTACION} estimada ±${String(orientacion.margen)}°.`, forma]
      : [
          marcado`${ORIENTACION} supuesta. Ninguna fuente publica hacia dónde apuntan los ${termino("sector", "sectores")} de este emplazamiento, así que se dibujan a ${enumerar(orientacion.azimuts)}, el reparto más común, solo para enseñar la forma.`,
          forma,
        ]
    ).map(bloque()),
  };
};

/** Los lóbulos que dibuja el panel a partir del resultado de la simulación. */
export const lobulosDe = (
  orientacion: Orientacion,
  resultado: ResultadoDiagramaSector,
): ReadonlyArray<LobuloSector> => {
  const n = RUMBOS_DIAGRAMA.length;
  return orientacion.azimuts.map((azimut, k) => ({
    azimut,
    etiqueta: azimutDe(orientacion, azimut),
    ganancia: resultado.ganancia.subarray(k * n, (k + 1) * n),
  }));
};
