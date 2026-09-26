import type { Mhz } from "./banda.ts";

/**
 * Qué se puede decir de una banda sin que la fuente lo publique. El registro oficial da la banda
 * de cada expediente pero no su tecnología (2G, 3G, 4G o 5G). Todo lo de este fichero es una
 * deducción a partir de cómo se repartió y se usa cada banda en España, y la interfaz la
 * presenta como tal («probablemente 5G»). Las fuentes están en
 * `docs/investigacion/tecnologia-por-banda.md`.
 */

/** Las bandas nominales de menor a mayor frecuencia: el eje de la ficha. */
export const BANDAS_NOMINALES: ReadonlyArray<Mhz> = [700, 800, 900, 1800, 2100, 2600, 3500];

export type Generacion = "2G" | "3G" | "4G" | "5G";

/**
 * Generaciones que se usan o se han usado en cada banda en España, de la más probable hoy a la
 * menos. Un expediente es una banda y una tecnología, pero el registro no dice cuál.
 */
export const USOS_DE_BANDA: Readonly<Record<Mhz, ReadonlyArray<Generacion>>> = {
  700: ["5G"],
  800: ["4G"],
  900: ["4G", "2G", "3G"],
  1800: ["4G", "2G"],
  2100: ["4G", "3G"],
  2600: ["4G"],
  3500: ["5G"],
};

/** La generación más probable de una banda hoy: la primera de sus usos. */
export const generacionProbable = (mhz: Mhz): Generacion => USOS_DE_BANDA[mhz][0] ?? "4G";

/**
 * Dónde cae una banda entre alcance y velocidad. Las bajas (por debajo de 1 GHz) llegan más
 * lejos y atraviesan mejor las paredes; las altas tienen bloques más anchos y dan más velocidad,
 * con menos alcance. Es física de la propagación, no un dato de la fuente.
 */
export type Franja = "baja" | "media" | "alta";

export const FRANJA_DE_BANDA: Readonly<Record<Mhz, Franja>> = {
  700: "baja",
  800: "baja",
  900: "baja",
  1800: "media",
  2100: "media",
  2600: "alta",
  3500: "alta",
};
