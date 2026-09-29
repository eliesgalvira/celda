import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import {
  type FormaDeBarrio,
  type Medida,
  medidaDeBarrio,
} from "@celda/ui/marcadores/MarcadorBarrio.tsx";
import { medidaDeProvincia } from "@celda/ui/marcadores/MarcadorProvincia.tsx";

import type { ElementoBarrio, ElementoMunicipio, ElementoProvincia } from "./agrupacion.ts";

interface Caja {
  readonly izquierda: number;
  readonly arriba: number;
  readonly derecha: number;
  readonly abajo: number;
}

const cajaEn = (punto: Salto, medida: Medida): Caja => ({
  izquierda: punto.x - medida.ancho / 2,
  arriba: punto.y - medida.alto / 2,
  derecha: punto.x + medida.ancho / 2,
  abajo: punto.y + medida.alto / 2,
});

/** La caja de una provincia: el hexágono va centrado en su punto, y el nombre debajo. */
const cajaDeProvincia = (punto: Salto, medida: Medida): Caja => ({
  izquierda: punto.x - medida.ancho / 2,
  arriba: punto.y - 28,
  derecha: punto.x + medida.ancho / 2,
  abajo: punto.y - 28 + medida.alto,
});

const sePisan = (a: Caja, b: Caja): boolean =>
  a.izquierda < b.derecha && b.izquierda < a.derecha && a.arriba < b.abajo && b.arriba < a.abajo;

/** Una etiqueta que puede ir completa o compacta: un barrio, un municipio o una provincia. */
export type ConEtiqueta = ElementoBarrio | ElementoMunicipio | ElementoProvincia;

const emplazamientosDe = (e: ConEtiqueta): number =>
  e.tipo === "provincia" ? e.provincia.emplazamientos : e.resumen.emplazamientos;

const codigoDe = (e: ConEtiqueta): string =>
  e.tipo === "barrio"
    ? e.resumen.barrio.codigo
    : e.tipo === "municipio"
      ? e.resumen.municipio.codigo
      : e.provincia.codigo;

const nombreDe = (e: ConEtiqueta): string =>
  e.tipo === "barrio"
    ? e.resumen.barrio.nombre
    : e.tipo === "municipio"
      ? e.resumen.municipio.nombre
      : e.provincia.nombre;

/** Primero los que tienen más emplazamientos; a igualdad, por código, para que no baile. */
const porPrioridad = (a: ConEtiqueta, b: ConEtiqueta): number =>
  emplazamientosDe(b) - emplazamientosDe(a) || (codigoDe(a) < codigoDe(b) ? -1 : 1);

const cajaDe = (e: ConEtiqueta, punto: Salto, forma: FormaDeBarrio): Caja =>
  e.tipo === "provincia"
    ? cajaDeProvincia(punto, medidaDeProvincia(forma, forma === "completa" ? e.ausentes.length : 0))
    : cajaEn(
        punto,
        medidaDeBarrio(forma, nombreDe(e), forma === "completa" ? e.resumen.ausentes.length : 0),
      );

/**
 * Qué forma toma la etiqueta de cada barrio, municipio o provincia en la pantalla. Se colocan de más a menos
 * emplazamientos: cada una va completa si no pisa ninguna de las ya colocadas y compacta si no.
 * La compacta se dibuja aunque pise otra, porque esconder una zona haría creer que no tiene
 * emplazamientos. Con el zoom del nivel de barrios, en Barcelona se pisan pocas.
 */
export const formasDeEtiquetas = (
  etiquetas: ReadonlyArray<ConEtiqueta>,
  proyectar: (etiqueta: ConEtiqueta) => Salto,
): ReadonlyMap<string, FormaDeBarrio> => {
  const colocadas: Array<Caja> = [];
  const formas = new Map<string, FormaDeBarrio>();
  for (const etiqueta of etiquetas.toSorted(porPrioridad)) {
    const punto = proyectar(etiqueta);
    const completa = cajaDe(etiqueta, punto, "completa");
    const cabe = !colocadas.some((otra) => sePisan(completa, otra));
    const forma: FormaDeBarrio = cabe ? "completa" : "compacta";
    colocadas.push(cabe ? completa : cajaDe(etiqueta, punto, "compacta"));
    formas.set(etiqueta.clave, forma);
  }
  return formas;
};

/** `formasDeEtiquetas` solo con barrios. */
export const formasDeBarrios = (
  barrios: ReadonlyArray<ElementoBarrio>,
  proyectar: (barrio: ElementoBarrio) => Salto,
): ReadonlyMap<string, FormaDeBarrio> =>
  formasDeEtiquetas(barrios, (etiqueta) =>
    etiqueta.tipo === "barrio" ? proyectar(etiqueta) : { x: 0, y: 0 },
  );
