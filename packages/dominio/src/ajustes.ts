import * as Schema from "effect/Schema";

import { Compania } from "./compania.ts";
import { type FiltroDeCompanias, normalizarFiltro, SIN_FILTRO } from "./filtro.ts";

/**
 * Los ajustes del dispositivo: lo que la persona elige una vez y Celda recuerda sin cuenta. No
 * son aportaciones (no se compartirían nunca), pero se guardan con su versión de esquema por la
 * misma razón: leer lo que guardó una versión anterior.
 */

/** Versión del esquema de los ajustes. */
export const ESQUEMA_AJUSTES = 1;

export const Ajustes = Schema.Struct({
  esquema: Schema.Literal(ESQUEMA_AJUSTES),
  /** El modo estudiante: con él se ve el ejercicio de emplazamientos. Apagado por defecto. */
  modoEstudiante: Schema.Boolean,
  /**
   * Las compañías que enseña el mapa (ADR 0026). Sin la clave, o vacía, todas: los ajustes de
   * antes del filtro no la llevan y se leen igual, sin cambiar de esquema.
   */
  companias: Schema.optionalKey(Schema.Array(Compania)),
  /**
   * Si este dispositivo ya ha visto la salvedad de las celdas, que sale una sola vez. Sin la clave,
   * no: los ajustes de antes se leen igual, sin cambiar de esquema.
   */
  salvedadDeCeldasVista: Schema.optionalKey(Schema.Boolean),
});
export type Ajustes = typeof Ajustes.Type;

/** El filtro de compañías de unos ajustes. */
export const filtroDeAjustes = (ajustes: Ajustes): FiltroDeCompanias =>
  ajustes.companias === undefined ? SIN_FILTRO : normalizarFiltro(ajustes.companias);

/** Los de un dispositivo que nunca ha cambiado nada. */
export const AJUSTES_INICIALES: Ajustes = { esquema: ESQUEMA_AJUSTES, modoEstudiante: false };
