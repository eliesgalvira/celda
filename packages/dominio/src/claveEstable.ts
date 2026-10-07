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
 * 1. Cada clave de antes va a un emplazamiento nuevo que comparte alguna observación con ella.
 *    Entre esos, primero al que ya la tiene como suya al salir de la fusión, luego al que comparte
 *    más observaciones y, si empatan, al de clave menor. Uno que solo tiene la clave por su
 *    compañía y su código, sin ninguna observación de las de antes, no se la quita a otro.
 * 2. Los que no heredan ninguna llevan la suya, y si ya la ha heredado otro, la suya con `-2`,
 *    `-3`…, como dos emplazamientos con la misma clave en la fusión (ADR 0012).
 *
 * `anterior` dice en qué emplazamiento estaba cada observación, por `llaveDeProcedencia`. Una
 * clave de antes que no hereda nadie desaparece, como la de un emplazamiento que se junta con otro.
 * Es una función pura.
 */
export const conClavesEstables = (
  nuevos: ReadonlyArray<Emplazamiento>,
  anterior: ReadonlyMap<string, string>,
): ReadonlyArray<Emplazamiento> => {
  const candidatos = nuevos.flatMap((emplazamiento, indice) => {
    const comunes = new Map<string, number>();
    for (const procedencia of procedenciasDe(emplazamiento)) {
      const suya = anterior.get(llaveDeProcedencia(procedencia));
      if (suya !== undefined) comunes.set(suya, (comunes.get(suya) ?? 0) + 1);
    }
    return [...comunes].map(([clave, comun]) => ({
      indice,
      clave,
      comun,
      propia: emplazamiento.clave === clave,
    }));
  });
  candidatos.sort(
    (a, b) =>
      Number(b.propia) - Number(a.propia) ||
      b.comun - a.comun ||
      compararTexto(nuevos[a.indice]?.clave ?? "", nuevos[b.indice]?.clave ?? "") ||
      compararTexto(a.clave, b.clave),
  );
  const tomadas = new Set<string>();
  const finales = new Map<number, string>();
  for (const { indice, clave } of candidatos) {
    if (finales.has(indice) || tomadas.has(clave)) continue;
    tomadas.add(clave);
    finales.set(indice, clave);
  }
  return nuevos.map((emplazamiento, indice) => {
    let clave = finales.get(indice);
    if (clave === undefined) {
      clave = emplazamiento.clave;
      for (let n = 2; tomadas.has(clave); n++) clave = `${emplazamiento.clave}-${n}`;
      tomadas.add(clave);
    }
    return clave === emplazamiento.clave ? emplazamiento : { ...emplazamiento, clave };
  });
};

/**
 * Adónde lleva cada clave de antes que ya no tiene emplazamiento: al emplazamiento que tiene ahora
 * más observaciones de las suyas. Sirve para que un enlace a una clave que desaparece al juntarse
 * dos emplazamientos abra el que queda (ADR 0027). Una cuyas observaciones ya no están en ninguno
 * no lleva a ninguna parte. Es una función pura.
 */
export const clavesQueDesaparecen = (
  nuevos: ReadonlyArray<Emplazamiento>,
  anterior: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> => {
  const ahora = new Map(
    nuevos.flatMap((e) => procedenciasDe(e).map((p) => [llaveDeProcedencia(p), e.clave] as const)),
  );
  const vivas = new Set(nuevos.map((e) => e.clave));
  const destinos = new Map<string, Map<string, number>>();
  for (const [llave, vieja] of anterior) {
    if (vivas.has(vieja)) continue;
    const nueva = ahora.get(llave);
    if (nueva === undefined) continue;
    const suyos = destinos.get(vieja) ?? new Map<string, number>();
    suyos.set(nueva, (suyos.get(nueva) ?? 0) + 1);
    destinos.set(vieja, suyos);
  }
  return new Map(
    [...destinos].map(([vieja, suyos]) => [
      vieja,
      [...suyos].sort((a, b) => b[1] - a[1] || compararTexto(a[0], b[0]))[0]?.[0] ?? "",
    ]),
  );
};
