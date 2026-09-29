import type { Rectangulo } from "@celda/dominio/area";
import type { ResumenDeBarrio } from "@celda/dominio/barrio";
import type { ResumenDeMunicipio } from "@celda/dominio/zona";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { textoDeAusencias } from "@celda/ui/marcadores/Ausencias.tsx";
import { textoDeEmplazamientos } from "@celda/ui/marcadores/MarcadorBarrio.tsx";
import type { CoberturaDeProvincia } from "@celda/ui/marcadores/MarcadorProvincia.tsx";

import type { ElementoProvincia } from "./agrupacion.ts";

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

/** Lo que se ve de una caja con el margen de `cajaConMargen`, algo más adentro. */
export const cajaVisible = (conMargen: Rectangulo): Rectangulo => {
  // La caja con margen crece un 15 % por cada lado; esto la deja en un 80 % de lo que se ve.
  const dx = (conMargen.noreste.longitud - conMargen.suroeste.longitud) * (0.25 / 1.3);
  const dy = (conMargen.noreste.latitud - conMargen.suroeste.latitud) * (0.25 / 1.3);
  return {
    suroeste: {
      longitud: conMargen.suroeste.longitud + dx,
      latitud: conMargen.suroeste.latitud + dy,
    },
    noreste: { longitud: conMargen.noreste.longitud - dx, latitud: conMargen.noreste.latitud - dy },
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

/**
 * Nombre accesible de un municipio, como el de un barrio: «Terrassa, 118 emplazamientos, sin Digi,
 * acercar». Uno con menos de 10 emplazamientos no tiene ausencias: «Aiguafreda, 3 emplazamientos,
 * acercar».
 */
export const nombreDeMunicipio = (resumen: ResumenDeMunicipio): string =>
  [
    resumen.municipio.nombre,
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

/** Cuánto sabe Celda de una provincia del resumen. */
export const coberturaDe = (elemento: ElementoProvincia): CoberturaDeProvincia =>
  elemento.provincia.cubierta
    ? "entera"
    : elemento.provincia.emplazamientos > 0
      ? "parcial"
      : "ninguna";

/**
 * Nombre accesible de una provincia: lo que dice su hexágono, en el mismo orden, y qué hace al
 * pulsarla. «Barcelona, 1318 emplazamientos en la parte que Celda ya tiene, acercar».
 */
export const nombreDeProvincia = (elemento: ElementoProvincia): string => {
  const { nombre, emplazamientos } = elemento.provincia;
  const cobertura = coberturaDe(elemento);
  const cuantos =
    cobertura === "ninguna"
      ? "Celda aún no tiene sus emplazamientos"
      : cobertura === "parcial"
        ? `${textoDeEmplazamientos(emplazamientos)} en la parte que Celda ya tiene`
        : textoDeEmplazamientos(emplazamientos);
  const carga =
    elemento.carga === "cargando"
      ? "cargando"
      : elemento.carga === "fallo"
        ? "no han llegado sus emplazamientos"
        : "";
  return [nombre, cuantos, textoDeAusencias(elemento.ausentes), carga, "acercar"]
    .filter((parte) => parte !== "")
    .join(", ");
};
