const DESPLAZAMIENTO = 0xcbf29ce484222325n;
const PRIMO = 0x100000001b3n;
const MASCARA = 0xffffffffffffffffn;

/**
 * Huella de un texto: FNV-1a de 64 bits sobre sus unidades UTF-16, en 16 cifras hexadecimales.
 * Sirve para saber si algo ha cambiado cuando la fuente no manda `ETag` ni `Last-Modified`.
 * No es criptográfica: solo compara lo que dice una fuente de un día para otro.
 */
export const huella = (texto: string): string => {
  let valor = DESPLAZAMIENTO;
  for (let i = 0; i < texto.length; i++) {
    valor = ((valor ^ BigInt(texto.charCodeAt(i))) * PRIMO) & MASCARA;
  }
  return valor.toString(16).padStart(16, "0");
};
