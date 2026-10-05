import type { Mhz } from "@celda/dominio/banda";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";

import type { Recuento } from "./interferencia.ts";

/** La frase clave de la vista (historia 39). */
export const FRASE_CLAVE: TextoMarcado = marcado`Solo interfieren entre sí las antenas de la misma ${termino("compania", "compañía")} que usan la misma ${termino("banda", "frecuencia")}.`;

/** Qué se ve en la trama. */
export const QUE_SE_VE: TextoMarcado = marcado`Cada hexágono muestra cuánto destaca la ${termino("sinr", "señal")} sobre la ${termino("interferencia", "interferencia")} de las demás antenas. Con más ${termino("ocupacion", "ocupación")} empeoran los bordes entre celdas.`;

/** Sin punto de referencia, cómo tener el valor (historia 42). */
export const SIN_PUNTO: TextoMarcado = marcado`Elige un ${termino("punto-de-referencia", "punto")} o usa tu ubicación para ver su valor.`;

const estaciones = (n: number): string => (n === 1 ? "1 estación base" : `${n} estaciones base`);

/**
 * Qué estaciones base entran y qué se supone de ellas. El registro no ha dado todavía las bandas
 * de muchas, y la vista las supone en la banda elegida; lo dice con el recuento.
 */
export const textoDeEstaciones = (recuento: Recuento, compania: Compania, mhz: Mhz): string => {
  const nombre = NOMBRE_COMPANIA[compania];
  const { confirmada, supuesta } = recuento;
  if (confirmada + supuesta === 0) {
    return `El registro no da ninguna estación base de ${nombre} en ${mhz} MHz.`;
  }
  if (supuesta === 0) {
    return `${confirmada === 1 ? "Se cuenta" : "Se cuentan"} ${estaciones(confirmada)} de ${nombre} en ${mhz} MHz.`;
  }
  const supuestas =
    supuesta === 1
      ? "La que aún no tiene bandas leídas se supone"
      : `Las ${supuesta} que aún no tienen bandas leídas se suponen`;
  const confirma =
    confirmada === 0
      ? `El registro aún no confirma ninguna estación base de ${nombre} en ${mhz} MHz.`
      : `El registro confirma ${estaciones(confirmada)} de ${nombre} en ${mhz} MHz.`;
  return `${confirma} ${supuestas} en esa banda.`;
};

/** Lo que ninguna fuente publica y la vista supone. */
export const SUPUESTOS: TextoMarcado = marcado`Los ${termino("sector", "sectores")}, a 0°, 120° y 240°, y la potencia son supuestos.`;

/** Desde dónde se da el valor: «En el punto» o «En tu ubicación» (historia 31). */
export const desdeDe = (tipo: "gps" | "elegido"): TextoMarcado =>
  tipo === "elegido"
    ? marcado`En el ${termino("punto-de-referencia", "punto")}`
    : marcado`En ${termino("punto-de-referencia", "tu ubicación")}`;
