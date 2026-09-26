import * as Schema from "effect/Schema";

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
});
export type Ajustes = typeof Ajustes.Type;

/** Los de un dispositivo que nunca ha cambiado nada. */
export const AJUSTES_INICIALES: Ajustes = { esquema: ESQUEMA_AJUSTES, modoEstudiante: false };
