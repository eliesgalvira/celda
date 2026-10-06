import { compararTexto } from "./banda.ts";
import type { Emplazamiento, Procedencia } from "./emplazamiento.ts";

/**
 * Claves estables de los emplazamientos. La fusión da a cada emplazamiento la clave de su estación
 * base del registro oficial con la compañía y el código menores (ADR 0012). Esa clave cambia si
 * cambian sus estaciones base: si deja de estar la de DIGI en uno con DIGI y Movistar, pasaría de
 * `digi-…` a `movistar-…`. Con ella se rompen los enlaces a su ficha y lo aceptado en la
 * moderación, que se guarda con la clave. Aquí cada emplazamiento conserva la clave que ya tenía.
 */

/** La llave de una observación entre las procedencias de los emplazamientos. */
export const llaveDeProcedencia = ({ fuente, clave }: Procedencia): string =>
  `${fuente}\u0000${clave}`;

/** Las procedencias de un emplazamiento: las observaciones de todas sus estaciones base. */
export const procedenciasDe = (emplazamiento: Pick<Emplazamiento, "estaciones">) =>
  emplazamiento.estaciones.flatMap((estacion) => estacion.observaciones);

/**
 * Los emplazamientos de una fusión con su clave estable, en el mismo orden:
 *
 * 1. Uno cuya clave ya existía la conserva.
 * 2. Los demás heredan la clave anterior con la que comparten más observaciones, si nadie la ha
 *    conservado ni heredado antes. Heredan primero los que comparten más, y si empatan, el de
 *    clave menor.
 * 3. Si no, se quedan con la suya.
 *
 * `anterior` dice en qué emplazamiento estaba cada observación, por `llaveDeProcedencia`, y
 * `anteriores`, las claves que había. Una clave de antes que queda sin dueño desaparece, como
 * la de un emplazamiento que se junta con otro. Es una función pura.
 */
export const conClavesEstables = (
  nuevos: ReadonlyArray<Emplazamiento>,
  anterior: ReadonlyMap<string, string>,
  anteriores: ReadonlySet<string>,
): ReadonlyArray<Emplazamiento> => {
  const tomadas = new Set<string>();
  const finales = new Map<number, string>();
  nuevos.forEach((emplazamiento, indice) => {
    if (anteriores.has(emplazamiento.clave)) {
      tomadas.add(emplazamiento.clave);
      finales.set(indice, emplazamiento.clave);
    }
  });
  const candidatos = nuevos.flatMap((emplazamiento, indice) => {
    if (finales.has(indice)) return [];
    const comunes = new Map<string, number>();
    for (const procedencia of procedenciasDe(emplazamiento)) {
      const suya = anterior.get(llaveDeProcedencia(procedencia));
      if (suya !== undefined) comunes.set(suya, (comunes.get(suya) ?? 0) + 1);
    }
    return [...comunes].map(([clave, comun]) => ({ indice, clave, comun }));
  });
  candidatos.sort(
    (a, b) =>
      b.comun - a.comun ||
      compararTexto(nuevos[a.indice]?.clave ?? "", nuevos[b.indice]?.clave ?? "") ||
      compararTexto(a.clave, b.clave),
  );
  for (const { indice, clave } of candidatos) {
    if (finales.has(indice) || tomadas.has(clave)) continue;
    tomadas.add(clave);
    finales.set(indice, clave);
  }
  return nuevos.map((emplazamiento, indice) => {
    const clave = finales.get(indice) ?? emplazamiento.clave;
    return clave === emplazamiento.clave ? emplazamiento : { ...emplazamiento, clave };
  });
};
