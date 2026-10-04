import type { Rectangulo } from "@celda/dominio/area";
import type { ResumenDeBarrio } from "@celda/dominio/barrio";
import type { ResumenDeMunicipio } from "@celda/dominio/zona";
import {
  mascaraDeCompanias,
  type EmplazamientoDeCapa,
  companiasDeMascara,
} from "@celda/dominio/capa";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  type FiltroDeCompanias,
  hayFiltro,
  nombresDelFiltro,
  redesUsadas,
  resaltadasDe,
  SIN_FILTRO,
} from "@celda/dominio/filtro";
import { idDeLogo, type LogoDeMarcador } from "@celda/ui/marcadores/LogoCompanias.tsx";
import {
  type CoberturaDeProvincia,
  textoDeEmplazamientos,
} from "@celda/ui/marcadores/MarcadorZona.tsx";

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

/**
 * De quién son los emplazamientos que se cuentan con un filtro: « de Movistar y Vodafone». Sin
 * filtro, nada.
 */
const deQuien = (filtro: FiltroDeCompanias): string =>
  hayFiltro(filtro) ? ` de ${nombresDelFiltro(filtro)}` : "";

/**
 * Las redes que usan las compañías del filtro, dicho de unos emplazamientos que son de ellas: «la
 * red que usa Digi», «las redes que usan Digi y Yoigo».
 */
const redQueUsan = (filtro: FiltroDeCompanias): string => {
  const usadas = redesUsadas(filtro);
  const quienes = enumerar(usadas.map((r) => NOMBRE_COMPANIA[r.compania]));
  return usadas.length > 1 ? `las redes que usan ${quienes}` : `la red que usa ${quienes}`;
};

/** De qué redes son los emplazamientos de la red usada: « de Movistar, la red que usa Digi». */
const deLaRed = (filtro: FiltroDeCompanias): string =>
  ` de ${enumerar(redesUsadas(filtro).map((r) => NOMBRE_COMPANIA[r.red]))}, ${redQueUsan(filtro)}`;

/**
 * Nombre accesible del marcador: las compañías que emiten allí y el estado si no es verificado.
 * Con un filtro, si es de la red que usa una compañía del filtro, lo dice: «Emplazamiento de
 * Movistar, red que usa Digi».
 */
export const nombreDeMarcador = (
  emplazamiento: EmplazamientoDeCapa,
  filtro: FiltroDeCompanias = SIN_FILTRO,
  redUsada = false,
): string => {
  const companias = emplazamiento.companias.map((c) => NOMBRE_COMPANIA[c]);
  const quien =
    companias.length === 0
      ? "Emplazamiento sin compañías conocidas"
      : companias.length === 1
        ? `Emplazamiento de ${companias[0] ?? ""}`
        : `Emplazamiento compartido por ${enumerar(companias)}`;
  const deRed = redesUsadas(filtro).filter((r) => emplazamiento.companias.includes(r.red));
  const conRed =
    redUsada && deRed.length > 0
      ? `${quien}, red que usa ${enumerar(deRed.map((r) => NOMBRE_COMPANIA[r.compania]))}`
      : quien;
  return emplazamiento.estado === "verificado" ? conRed : `${conRed}, ${emplazamiento.estado}`;
};

/**
 * Nombre accesible de una agrupación: cuántos emplazamientos recoge y qué hace al pulsarla. Empieza
 * por el número, que es lo que se ve. Con un filtro, de quién son: «12 emplazamientos de
 * Movistar, acercar» o, los de la red usada, «30 emplazamientos de Movistar, la red que usa Digi,
 * acercar».
 */
export const nombreDeAgrupacion = (
  cuantos: number,
  filtro: FiltroDeCompanias = SIN_FILTRO,
  redUsada = false,
): string =>
  `${cuantos} emplazamientos${redUsada && hayFiltro(filtro) ? deLaRed(filtro) : deQuien(filtro)}, acercar`;

/**
 * Nombre accesible de un barrio: lo que dice su etiqueta, en el mismo orden, y qué hace al
 * pulsarlo. «la Clota, 1 emplazamiento, acercar». Como el mapa, no dice qué compañías faltan
 * (ADR 0024). Con un filtro, de quién son los que cuenta.
 */
export const nombreDeBarrio = (
  resumen: ResumenDeBarrio,
  filtro: FiltroDeCompanias = SIN_FILTRO,
): string =>
  `${resumen.barrio.nombre}, ${textoDeEmplazamientos(resumen.emplazamientos)}${deQuien(filtro)}, acercar`;

/** Nombre accesible de un municipio, como el de un barrio: «Terrassa, 118 emplazamientos, acercar». */
export const nombreDeMunicipio = (
  resumen: ResumenDeMunicipio,
  filtro: FiltroDeCompanias = SIN_FILTRO,
): string =>
  `${resumen.municipio.nombre}, ${textoDeEmplazamientos(resumen.emplazamientos)}${deQuien(filtro)}, acercar`;

/**
 * Los logos distintos de unos emplazamientos con un filtro, cada uno una vez: cada combinación de
 * compañías con las que resalta (`resaltadasDe`). Se mira cada combinación, no cada emplazamiento.
 */
export const logosDe = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  filtro: FiltroDeCompanias = SIN_FILTRO,
): ReadonlyArray<LogoDeMarcador> => {
  const mascaras = new Set(emplazamientos.map((e) => mascaraDeCompanias(e.companias)));
  const logos = new Map<string, LogoDeMarcador>();
  for (const mascara of [...mascaras].sort((a, b) => a - b)) {
    const companias = companiasDeMascara(mascara);
    const resaltadas = resaltadasDe(companias, filtro);
    logos.set(idDeLogo(companias, resaltadas), { companias, resaltadas });
  }
  return [...logos.values()];
};

/** Cuánto sabe Celda de una provincia del resumen. */
export const coberturaDe = (elemento: ElementoProvincia): CoberturaDeProvincia =>
  elemento.provincia.cubierta
    ? "entera"
    : elemento.provincia.emplazamientos > 0
      ? "parcial"
      : "ninguna";

/**
 * Nombre accesible de una provincia: lo que dice su hexágono, en el mismo orden, y qué hace al
 * pulsarla. «Barcelona, 1318 emplazamientos en la parte que Celda ya tiene, acercar». Con un
 * filtro, de quién son y, aparte, cuántos hay de la red que usan.
 */
export const nombreDeProvincia = (
  elemento: ElementoProvincia,
  filtro: FiltroDeCompanias = SIN_FILTRO,
): string => {
  const { nombre } = elemento.provincia;
  const cobertura = coberturaDe(elemento);
  const deLosSuyos = elemento.sinFiltrar
    ? " de todas las compañías"
    : `${deQuien(filtro)}${elemento.deLaRed > 0 ? ` y ${elemento.deLaRed}${deLaRed(filtro)}` : ""}`;
  const emplazamientos = `${textoDeEmplazamientos(elemento.cuantos)}${deLosSuyos}`;
  const cuantos =
    cobertura === "ninguna"
      ? "Celda aún no tiene sus emplazamientos"
      : cobertura === "parcial"
        ? `${emplazamientos} en la parte que Celda ya tiene`
        : emplazamientos;
  const carga =
    elemento.carga === "cargando"
      ? "cargando"
      : elemento.carga === "fallo"
        ? "no han llegado sus emplazamientos"
        : "";
  return [nombre, cuantos, carga, "acercar"].filter((parte) => parte !== "").join(", ");
};
