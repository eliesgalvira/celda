import { FOTO_AEREA } from "../mapa/expresiones.ts";

/** Si un valor es la pregunta de `conFoto`: `["case", ["global-state", FOTO_AEREA], con, sin]`. */
const esConFoto = (valor: ReadonlyArray<unknown>): boolean => {
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
export const conLaFoto = (valor: unknown, encendida: boolean): unknown => {
  if (!Array.isArray(valor)) return valor;
  if (esConFoto(valor)) return conLaFoto(encendida ? valor[2] : valor[3], encendida);
  return valor.map((parte) => conLaFoto(parte, encendida));
};
