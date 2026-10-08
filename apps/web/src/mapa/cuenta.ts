import { type FiltroDeCompanias, mascarasDeFiltro, papelDe } from "@celda/dominio/filtro";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { contarEnTramos, type PuntosLeidos, tramosDeMunicipio } from "@celda/dominio/puntos";

import { cuentaDeProvincia, type EstadoProvincia } from "../capa/nacional.ts";
import type { SitioDeLaVista } from "./lugar.ts";

/**
 * Cuántos emplazamientos tiene el sitio que se mira, para la cabecera: «Barcelona · 2.905
 * emplazamientos». Sale de lo publicado y sigue al filtro de compañías, como los hexágonos: cuenta
 * los de sus compañías y no los de la red que usan.
 */
export interface CuentaDelSitio {
  readonly cuantos: number;
  /** Si es solo lo de la parte barrida de su provincia: su número no es el de todo el sitio. */
  readonly parcial: boolean;
}

/** Lo que hay publicado para contar: el resumen y, si han llegado, los puntos o las provincias. */
export interface FuentesDeLaCuenta {
  readonly resumen: ResumenLeido;
  readonly puntos: PuntosLeidos | undefined;
  readonly provincias: ReadonlyMap<string, EstadoProvincia>;
  readonly filtro: FiltroDeCompanias;
}

/**
 * La cuenta de un sitio, o `undefined` si no se sabe: un municipio sin los puntos ni la capa de su
 * provincia, una provincia de la que Celda aún no tiene nada o un resumen de antes de las
 * combinaciones de compañías con un filtro puesto.
 *
 * - España, por el resumen: la suma de sus provincias, parcial si alguna no está cubierta.
 * - Una provincia, por el resumen.
 * - Un municipio, por los puntos de la vista de puntos o, con la vista agrupada, por la capa de su
 *   provincia si ha llegado. Parcial si su provincia no está cubierta.
 */
export const cuentaDelSitio = (
  sitio: SitioDeLaVista,
  fuentes: FuentesDeLaCuenta,
): CuentaDelSitio | undefined => {
  const { resumen, filtro } = fuentes;
  if (sitio.tipo === "espana") {
    const cuentas = resumen.provincias.map((p) => cuentaDeProvincia(p, filtro));
    if (cuentas.some((c) => c.sinFiltrar)) return undefined;
    return {
      cuantos: cuentas.reduce((suma, c) => suma + c.cuantos, 0),
      parcial: resumen.provincias.some((p) => !p.cubierta),
    };
  }
  const codigoDeProvincia = sitio.codigo.slice(0, 2);
  const provincia = resumen.provincias.find((p) => p.codigo === codigoDeProvincia);
  if (provincia === undefined || (provincia.emplazamientos === 0 && !provincia.cubierta)) {
    return undefined;
  }
  const parcial = !provincia.cubierta;
  if (sitio.tipo === "provincia") {
    const cuenta = cuentaDeProvincia(provincia, filtro);
    return cuenta.sinFiltrar ? undefined : { cuantos: cuenta.cuantos, parcial };
  }
  if (fuentes.puntos !== undefined) {
    const tramos = tramosDeMunicipio(fuentes.puntos, sitio.codigo);
    return {
      cuantos: contarEnTramos(fuentes.puntos, tramos, mascarasDeFiltro(filtro)),
      parcial,
    };
  }
  const estado = fuentes.provincias.get(codigoDeProvincia);
  if (estado?.tipo !== "lista") return undefined;
  const cuantos = estado.provincia.capa.emplazamientos.filter(
    (e) => e.municipio === sitio.codigo && papelDe(e.companias, filtro) === "propio",
  ).length;
  return { cuantos, parcial };
};

/** Los números con el punto de los miles también en los de cuatro cifras: «2.905». */
const NUMERO = new Intl.NumberFormat("es-ES", { useGrouping: "always" });

/** Lo que dice la cabecera bajo el nombre: «2.905 emplazamientos», «1 emplazamiento». */
export const textoDeCuenta = (cuenta: CuentaDelSitio): string => {
  const cuantos = `${NUMERO.format(cuenta.cuantos)} ${cuenta.cuantos === 1 ? "emplazamiento" : "emplazamientos"}`;
  return cuenta.parcial ? `${cuantos}, solo una parte` : cuantos;
};
