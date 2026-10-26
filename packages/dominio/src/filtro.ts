import { companiasDeMascara, mascaraDeCompanias } from "./capa.ts";
import { Compania, NOMBRE_COMPANIA } from "./compania.ts";
import { enumerar } from "./enumerar.ts";

/**
 * El filtro de compañías del mapa (ADR 0026): qué compañías quiere ver la persona. Vacío es sin
 * filtro, todas. Un emplazamiento sale si alguna de sus compañías está en el filtro. Donde una
 * compañía del filtro no tiene red propia usa la de otra (`RED_QUE_USA`), y los emplazamientos de
 * esa otra salen aparte, más claros: son la red por la que se conectan sus clientes.
 */

/** Las compañías elegidas, en el orden de `Compania.literals`, sin repetir. Vacío: todas. */
export type FiltroDeCompanias = ReadonlyArray<Compania>;

/** Sin filtro: se ven todas las compañías. */
export const SIN_FILTRO: FiltroDeCompanias = [];

/**
 * La red que usa cada compañía donde no tiene la suya, comprobado el 04/10/2026 (ADR 0026):
 *
 * - DIGI, la de Movistar: itinerancia nacional y compartición de red con Telefónica, en vigor desde
 *   el 1 de enero de 2025 y por 16 años.
 * - Yoigo, la de Orange: las dos son de MasOrange, que en 2025 apagó casi toda la red propia de
 *   Yoigo y da servicio a sus clientes con la de Orange.
 */
export const RED_QUE_USA: ReadonlyMap<Compania, Compania> = new Map([
  ["digi", "movistar"],
  ["yoigo", "orange"],
]);

/** Las compañías sin red propia que usan la red de una compañía. */
export interface GrupoSinRedPropia {
  readonly red: Compania;
  readonly companias: ReadonlyArray<string>;
}

/**
 * Las compañías sin red propia, por la red que usan, comprobado el 26/10/2026 (ADR 0026). No
 * tienen emplazamientos: elegir una pone el filtro de su red. Las que usan más de una red no están.
 */
export const SIN_RED_PROPIA: ReadonlyArray<GrupoSinRedPropia> = [
  { red: "movistar", companias: ["O2"] },
  { red: "vodafone", companias: ["Lowi", "Finetwork"] },
  {
    red: "orange",
    companias: [
      "Simyo",
      "Jazztel",
      "MásMóvil",
      "Pepephone",
      "Lebara",
      "Llamaya",
      "Euskaltel",
      "R",
      "Avatel",
    ],
  },
];

/** Una compañía sin red propia que se ha elegido, y la de la red que usa. */
export interface SinRedPropia {
  readonly compania: string;
  readonly red: Compania;
}

/** Las compañías de una lista que se pueden elegir, en su orden y sin repetir. */
export const normalizarFiltro = (companias: ReadonlyArray<Compania>): FiltroDeCompanias => {
  const elegidas = Compania.literals.filter((c) => companias.includes(c));
  // Todas elegidas es lo mismo que ninguna: no hay filtro.
  return elegidas.length === Compania.literals.length ? SIN_FILTRO : elegidas;
};

/** Si hay filtro: alguna compañía elegida, y no todas. */
export const hayFiltro = (filtro: FiltroDeCompanias): boolean => filtro.length > 0;

/** Un texto que identifica el filtro: el mismo para el mismo filtro. */
export const claveDeFiltro = (filtro: FiltroDeCompanias): string =>
  filtro.length === 0 ? "todas" : filtro.join("+");

/** Dos filtros iguales. */
export const mismoFiltro = (a: FiltroDeCompanias, b: FiltroDeCompanias): boolean =>
  claveDeFiltro(a) === claveDeFiltro(b);

/**
 * El filtro al tocar una compañía: si estaba, sale; si no, entra. Desde «todas», tocar una deja
 * solo esa: así «solo Movistar» es un toque. Quitar la última vuelve a todas.
 */
export const conmutarCompania = (
  filtro: FiltroDeCompanias,
  compania: Compania,
): FiltroDeCompanias =>
  normalizarFiltro(
    filtro.includes(compania) ? filtro.filter((c) => c !== compania) : [...filtro, compania],
  );

/** Una compañía del filtro que usa la red de otra que no está en él. */
export interface RedUsada {
  /** La compañía del filtro: DIGI o Yoigo. */
  readonly compania: Compania;
  /** La compañía cuya red usa: Movistar u Orange. */
  readonly red: Compania;
}

/**
 * Las redes que salen aparte con este filtro: las de las compañías del filtro que usan otra red,
 * si esa otra no está ya en el filtro. Sin filtro, ninguna.
 */
export const redesUsadas = (filtro: FiltroDeCompanias): ReadonlyArray<RedUsada> =>
  filtro.flatMap((compania) => {
    const red = RED_QUE_USA.get(compania);
    return red === undefined || filtro.includes(red) ? [] : [{ compania, red }];
  });

/**
 * Qué es un emplazamiento con un filtro:
 *
 * - `propio`: tiene alguna compañía del filtro. Sin filtro, todos.
 * - `red-usada`: no tiene ninguna, pero sí la red que usa alguna del filtro (`redesUsadas`).
 * - `undefined`: no sale.
 */
export type Papel = "propio" | "red-usada";

/** El filtro en máscaras de bits de la capa: lo que se mira por cada emplazamiento. */
export interface MascarasDeFiltro {
  /** Las compañías del filtro; 0 sin filtro. */
  readonly propias: number;
  /** Las redes que salen aparte. */
  readonly usadas: number;
}

export const mascarasDeFiltro = (filtro: FiltroDeCompanias): MascarasDeFiltro => ({
  propias: mascaraDeCompanias(filtro),
  usadas: mascaraDeCompanias(redesUsadas(filtro).map((r) => r.red)),
});

/** El papel de un emplazamiento por la máscara de sus compañías. */
export const papelDeMascara = (mascara: number, filtro: MascarasDeFiltro): Papel | undefined =>
  filtro.propias === 0 || (mascara & filtro.propias) !== 0
    ? "propio"
    : (mascara & filtro.usadas) !== 0
      ? "red-usada"
      : undefined;

/** El papel de un emplazamiento por sus compañías. */
export const papelDe = (
  companias: ReadonlyArray<Compania>,
  filtro: FiltroDeCompanias,
): Papel | undefined => papelDeMascara(mascaraDeCompanias(companias), mascarasDeFiltro(filtro));

/** Los emplazamientos que salen con un filtro, separados por su papel. */
export interface PorPapel<E> {
  readonly propios: ReadonlyArray<E>;
  readonly redUsada: ReadonlyArray<E>;
}

/** Los emplazamientos de una lista que salen con el filtro, separados por su papel, en su orden. */
export const separarPorPapel = <E extends { readonly companias: ReadonlyArray<Compania> }>(
  emplazamientos: ReadonlyArray<E>,
  filtro: FiltroDeCompanias,
): PorPapel<E> => {
  if (!hayFiltro(filtro)) return { propios: emplazamientos, redUsada: [] };
  const mascaras = mascarasDeFiltro(filtro);
  const propios: Array<E> = [];
  const redUsada: Array<E> = [];
  for (const emplazamiento of emplazamientos) {
    const papel = papelDeMascara(mascaraDeCompanias(emplazamiento.companias), mascaras);
    if (papel === "propio") propios.push(emplazamiento);
    else if (papel === "red-usada") redUsada.push(emplazamiento);
  }
  return { propios, redUsada };
};

/**
 * Las compañías de un emplazamiento que su marcador resalta con el filtro: las del filtro y las
 * redes que usan. Sin filtro, todas. Las demás van apagadas.
 */
export const resaltadasDe = (
  companias: ReadonlyArray<Compania>,
  filtro: FiltroDeCompanias,
): ReadonlyArray<Compania> => {
  if (!hayFiltro(filtro)) return companias;
  const { propias, usadas } = mascarasDeFiltro(filtro);
  return companiasDeMascara(mascaraDeCompanias(companias) & (propias | usadas));
};

/**
 * Cuántos emplazamientos hay con cada combinación de compañías, por la máscara de bits de la capa:
 * lo que el resumen nacional publica por provincia para contar con cualquier filtro sin la capa.
 */
export type Combinaciones = ReadonlyMap<number, number>;

/** Las combinaciones de unos emplazamientos. */
export const combinacionesDe = (
  emplazamientos: ReadonlyArray<{ readonly companias: ReadonlyArray<Compania> }>,
): Combinaciones => {
  const cuantos = new Map<number, number>();
  for (const { companias } of emplazamientos) {
    const mascara = mascaraDeCompanias(companias);
    cuantos.set(mascara, (cuantos.get(mascara) ?? 0) + 1);
  }
  return new Map([...cuantos].sort(([a], [b]) => a - b));
};

/** Lo que cuenta una zona con un filtro: los suyos y, aparte, los de la red que usan. */
export interface CuentaConFiltro {
  readonly propios: number;
  readonly redUsada: number;
}

/** Cuántos emplazamientos de unas combinaciones salen con un filtro, por su papel. */
export const contarConFiltro = (
  combinaciones: Combinaciones,
  filtro: FiltroDeCompanias,
): CuentaConFiltro => {
  const mascaras = mascarasDeFiltro(filtro);
  let propios = 0;
  let redUsada = 0;
  for (const [mascara, cuantos] of combinaciones) {
    const papel = papelDeMascara(mascara, mascaras);
    if (papel === "propio") propios += cuantos;
    else if (papel === "red-usada") redUsada += cuantos;
  }
  return { propios, redUsada };
};

/** «Movistar», «Movistar y Vodafone», «Movistar, Vodafone y Digi». */
export const nombresDelFiltro = (filtro: FiltroDeCompanias): string =>
  enumerar(filtro.map((c) => NOMBRE_COMPANIA[c]));

/** «Digi usa aquí la red de Movistar». */
export const textoDeRedUsada = (red: RedUsada): string =>
  `${NOMBRE_COMPANIA[red.compania]} usa aquí la red de ${NOMBRE_COMPANIA[red.red]}`;
