import { FOTO_AEREA } from "../mapa/expresiones.ts";

/** Si un valor es la pregunta de `conFoto`: `["case", ["global-state", FOTO_AEREA], con, sin]`. */
const esConFoto = <T>(valor: ReadonlyArray<T>): boolean => {
  const [operador, condicion] = valor;
  return (
    operador === "case" &&
    valor.length === 4 &&
    Array.isArray(condicion) &&
    condicion[0] === "global-state" &&
    condicion[1] === FOTO_AEREA
  );
};

/**
 * Lo que vale una propiedad del estilo con la foto aérea encendida o apagada: cada `conFoto`
 * que lleve dentro, a cualquier profundidad, queda en su rama. Lo demás no cambia.
 */
export const conLaFoto = <T>(valor: T, encendida: boolean): T => {
  if (!Array.isArray(valor)) return valor;
  if (esConFoto(valor)) {
    // SAFETY: las dos ramas de un `conFoto` son valores de la misma propiedad que la expresión.
    const rama = (encendida ? valor[2] : valor[3]) as T;
    return conLaFoto(rama, encendida);
  }
  // SAFETY: una expresión con sus partes resueltas sigue siendo un valor de la misma propiedad.
  return valor.map((parte: T) => conLaFoto(parte, encendida)) as T;
};
