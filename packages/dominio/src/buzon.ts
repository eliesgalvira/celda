import type { AportacionCompartible } from "./aportacion.ts";
import { contiene, type Coordenada, ESPANA } from "./area.ts";

/**
 * Las comprobaciones que hace el buzón (ADR 0020) a una aportación compartida, además de su
 * esquema: que lo que dice sea posible. Son funciones puras para que la web pueda avisar antes
 * de enviar lo mismo que rechazaría el buzón.
 */

/** Lo más que puede ir adelantado el reloj del dispositivo respecto al del buzón. */
export const ADELANTO_MAXIMO_MS = 10 * 60 * 1000;

const enEspana = (punto: Coordenada): boolean => contiene(ESPANA.limites, punto);

/**
 * Por qué el buzón no aceptaría una aportación que ya cumple su esquema, o `undefined` si la
 * aceptaría. `ahora` es la hora del buzón, en milisegundos.
 */
export const motivoNoAceptable = (
  aportacion: AportacionCompartible,
  ahora: number,
): string | undefined => {
  if (aportacion.creada > ahora + ADELANTO_MAXIMO_MS) return "la fecha de creación es futura";
  switch (aportacion.tipo) {
    case "correccion-propuesta": {
      const { cambio } = aportacion;
      return (cambio.tipo === "posicion" || cambio.tipo === "falta") && !enEspana(cambio.posicion)
        ? "el punto propuesto está fuera de España"
        : undefined;
    }
    case "corroboracion":
      return undefined;
  }
};
