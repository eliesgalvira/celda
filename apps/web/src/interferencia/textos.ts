import type { Mhz } from "@celda/dominio/banda";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { marcado, termino, type TextoMarcado } from "@celda/dominio/glosario";

import type { Recuento } from "./interferencia.ts";

/** La frase clave de la vista (historia 39). */
export const FRASE_CLAVE: TextoMarcado = marcado`Solo se estorban las antenas de la misma ${termino("compania", "compañía")} en la misma ${termino("banda", "frecuencia")}.`;

/** Qué se ve en la trama. */
export const QUE_SE_VE: TextoMarcado = marcado`Cada hexágono da la ${termino("sinr", "señal frente a interferencia")}: cuánto destaca la señal que le da servicio sobre la ${termino("interferencia", "interferencia")} de las demás. Al subir la ${termino("ocupacion", "ocupación")}, empeoran los bordes entre celdas.`;

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
  const otras = recuento["otra-banda"];
  if (confirmada + supuesta === 0) {
    return `El registro no da ninguna estación base de ${nombre} en ${mhz} MHz.`;
  }
  const fuera =
    otras === 0
      ? ""
      : otras === 1
        ? " No cuenta la que solo emite en otras bandas."
        : ` No cuentan las ${otras} que solo emiten en otras bandas.`;
  if (supuesta === 0) {
    const cuales = confirmada === 1 ? "la estación base" : `las ${confirmada} estaciones base`;
    return `Entran ${cuales} de ${nombre} que el registro da en ${mhz} MHz.${fuera}`;
  }
  const supuestas =
    supuesta === 1
      ? "La que aún no tiene bandas leídas se supone"
      : `Las ${supuesta} que aún no tienen bandas leídas se suponen`;
  const confirma =
    confirmada === 0
      ? `El registro aún no confirma ninguna estación base de ${nombre} en ${mhz} MHz.`
      : `El registro confirma ${estaciones(confirmada)} de ${nombre} en ${mhz} MHz.`;
  return `${confirma} ${supuestas} en esa banda.${fuera}`;
};

/** Lo que ninguna fuente publica y la vista supone. */
export const SUPUESTOS: TextoMarcado = marcado`${termino("sector", "Sectores")} supuestos a 0°, 120° y 240° y potencia típica: ninguna fuente publica la orientación ni la potencia.`;

/** Desde dónde se da el valor: «En el punto» o «En tu ubicación» (historia 31). */
export const desdeDe = (tipo: "gps" | "elegido"): TextoMarcado =>
  tipo === "elegido"
    ? marcado`En el ${termino("punto-de-referencia", "punto")}`
    : marcado`En ${termino("punto-de-referencia", "tu ubicación")}`;
