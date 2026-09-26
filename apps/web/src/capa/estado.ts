import type { FuenteDeBarrios } from "@celda/dominio/barrio";
import type { CapaLeida } from "@celda/dominio/capa";
import { marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";
import type { Credito } from "@celda/ui/Atribucion.tsx";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import type { FalloCapa } from "./servicio.ts";

/** Por qué no se ha podido cargar la capa de emplazamientos. */
export type MotivoFalloCapa =
  | "sin-publicar"
  | "sin-backend"
  | "sin-descarga"
  | "danada"
  | "interno";

export type EstadoCapa =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "lista"; readonly capa: CapaLeida }
  | { readonly tipo: "fallo"; readonly motivo: MotivoFalloCapa };

const MOTIVO: Readonly<Record<FalloCapa["_tag"], MotivoFalloCapa>> = {
  SinCapaPublicada: "sin-publicar",
  BackendNoResponde: "sin-backend",
  CapaNoDescargada: "sin-descarga",
  CapaIlegible: "danada",
  VersionDistinta: "danada",
};

/** El estado de la capa según cómo ha terminado su carga. */
export const estadoDeCarga = (salida: Exit.Exit<CapaLeida, FalloCapa>): EstadoCapa =>
  Exit.match(salida, {
    onSuccess: (capa) => ({ tipo: "lista", capa }),
    onFailure: (causa) => ({
      tipo: "fallo",
      motivo: Cause.findErrorOption(causa).pipe(
        Option.match({ onNone: () => "interno" as const, onSome: (error) => MOTIVO[error._tag] }),
      ),
    }),
  });

const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

/** El texto de la marca de agua del mapa: la fecha de los datos de la capa, en Barcelona. */
export const textoDatosDelMapa = (fecha: number): TextoMarcado =>
  marcado`${termino("version-de-los-datos", "Datos del mapa")}: ${FECHA.format(fecha).replace(".", "")}`;

/**
 * El crédito de los límites de barrio, con su fecha y su licencia, como pide CC BY 4.0:
 * «Ajuntament de Barcelona (barrios, 12 nov 2024, CC BY 4.0)».
 */
export const creditoDeBarrios = (fuente: FuenteDeBarrios): Credito => {
  const fecha = Date.parse(`${fuente.fecha}T12:00:00Z`);
  const cuando = Number.isNaN(fecha) ? fuente.fecha : FECHA.format(fecha).replace(".", "");
  return {
    texto: `${fuente.atribucion} (barrios, ${cuando}, ${fuente.licencia})`,
    enlace: fuente.enlace,
  };
};
