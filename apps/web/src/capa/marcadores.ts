import type { Rectangulo } from "@celda/dominio/area";
import type { ResumenDeBarrio } from "@celda/dominio/barrio";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { textoDeAusencias } from "@celda/ui/marcadores/Ausencias.tsx";
import { textoDeEmplazamientos } from "@celda/ui/marcadores/MarcadorBarrio.tsx";

/** Lo que enseña el mapa en un momento: dónde mira y a qué zoom. */
export interface Vista {
  readonly caja: Rectangulo;
  readonly zoom: number;
}

/** Margen alrededor de la vista, en fracción de su tamaño: al arrastrar, los bordes ya están. */
const MARGEN = 0.15;

/** La caja de la vista con un margen alrededor: lo que se dibuja además de lo que se ve. */
export const cajaConMargen = (caja: Rectangulo): Rectangulo => {
  const dx = (caja.noreste.longitud - caja.suroeste.longitud) * MARGEN;
  const dy = (caja.noreste.latitud - caja.suroeste.latitud) * MARGEN;
  return {
    suroeste: { longitud: caja.suroeste.longitud - dx, latitud: caja.suroeste.latitud - dy },
    noreste: { longitud: caja.noreste.longitud + dx, latitud: caja.noreste.latitud + dy },
  };
};

const enumerar = (nombres: ReadonlyArray<string>): string =>
  nombres.length <= 1
    ? (nombres[0] ?? "")
    : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1) ?? ""}`;

/** Nombre accesible del marcador: las compañías que emiten allí y el estado si no es verificado. */
export const nombreDeMarcador = (emplazamiento: EmplazamientoDeCapa): string => {
  const companias = emplazamiento.companias.map((c) => NOMBRE_COMPANIA[c]);
  const quien =
    companias.length === 0
      ? "Emplazamiento sin compañías conocidas"
      : companias.length === 1
        ? `Emplazamiento de ${companias[0] ?? ""}`
        : `Emplazamiento compartido por ${enumerar(companias)}`;
  return emplazamiento.estado === "verificado" ? quien : `${quien}, ${emplazamiento.estado}`;
};

/**
 * Nombre accesible de una agrupación: cuántos emplazamientos recoge y qué hace al pulsarla. Empieza
 * por el número, que es lo que se ve.
 */
export const nombreDeAgrupacion = (cuantos: number): string => `${cuantos} emplazamientos, acercar`;

/**
 * Nombre accesible de un barrio: lo que dice su etiqueta, en el mismo orden, y qué hace al
 * pulsarlo. «la Clota, 1 emplazamiento, sin Vodafone, Orange ni Digi, acercar».
 */
export const nombreDeBarrio = (resumen: ResumenDeBarrio): string =>
  [
    resumen.barrio.nombre,
    textoDeEmplazamientos(resumen.emplazamientos),
    textoDeAusencias(resumen.ausentes),
    "acercar",
  ]
    .filter((parte) => parte !== "")
    .join(", ");

/** Las combinaciones distintas de compañías de la capa, cada una una vez: un logo por cada una. */
export const combinacionesDe = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
): ReadonlyArray<ReadonlyArray<Compania>> => [
  ...new Map(emplazamientos.map((e) => [e.companias.join("-"), e.companias])).values(),
];
