import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import {
  type CajaDeZona,
  cajaDeZona,
  type FormaDeZona,
} from "@celda/ui/marcadores/MarcadorZona.tsx";

import type {
  Elemento,
  ElementoBarrio,
  ElementoMunicipio,
  ElementoProvincia,
} from "./agrupacion.ts";

interface Caja {
  readonly izquierda: number;
  readonly arriba: number;
  readonly derecha: number;
  readonly abajo: number;
}

const cajaEn = (punto: Salto, relativa: CajaDeZona): Caja => ({
  izquierda: punto.x + relativa.izquierda,
  arriba: punto.y + relativa.arriba,
  derecha: punto.x + relativa.derecha,
  abajo: punto.y + relativa.abajo,
});

const sePisan = (a: Caja, b: Caja): boolean =>
  a.izquierda < b.derecha && b.izquierda < a.derecha && a.arriba < b.abajo && b.arriba < a.abajo;

/** Una zona, que puede ir completa o compacta: un barrio, un municipio o una provincia. */
export type ConEtiqueta = ElementoBarrio | ElementoMunicipio | ElementoProvincia;

const esZona = (elemento: Elemento): elemento is ConEtiqueta =>
  elemento.tipo === "barrio" || elemento.tipo === "municipio" || elemento.tipo === "provincia";

/** Lo que ocupa un marcador que no es una zona: el logo de 44 px o el hexágono de 50 × 56. */
const OTRO: Readonly<Record<"emplazamiento" | "agrupacion", CajaDeZona>> = {
  emplazamiento: { izquierda: -22, arriba: -22, derecha: 22, abajo: 22 },
  agrupacion: { izquierda: -25, arriba: -28, derecha: 25, abajo: 28 },
};

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

/** Una provincia que no está cubierta entera o cuya capa está en camino lleva una línea más. */
const conEstado = (e: ConEtiqueta): boolean =>
  e.tipo === "provincia" && (!e.provincia.cubierta || e.carga !== "resumen");

/** Primero los que tienen más emplazamientos; a igualdad, por código, para que no baile. */
const porPrioridad = (a: ConEtiqueta, b: ConEtiqueta): number =>
  emplazamientosDe(b) - emplazamientosDe(a) || (codigoDe(a) < codigoDe(b) ? -1 : 1);

const cajaDe = (e: ConEtiqueta, punto: Salto, forma: FormaDeZona): Caja =>
  cajaEn(punto, cajaDeZona(forma, nombreDe(e), conEstado(e)));

/**
 * Qué forma toma cada zona de `elementos` en la pantalla. Las agrupaciones y los emplazamientos
 * sueltos se colocan primero, porque su sitio no se puede cambiar. Después, las zonas de más a
 * menos emplazamientos: cada una va completa, con su nombre, si no pisa nada de lo
 * ya colocado, y compacta, solo el hexágono, si no. La compacta se dibuja aunque pise otra, porque
 * esconder una zona haría creer que no tiene emplazamientos.
 */
export const formasDeEtiquetas = (
  elementos: ReadonlyArray<Elemento>,
  proyectar: (elemento: Elemento) => Salto,
): ReadonlyMap<string, FormaDeZona> => {
  const formas = new Map<string, FormaDeZona>();
  const zonas = elementos.filter(esZona);
  if (zonas.length === 0) return formas;
  const colocadas: Array<Caja> = [];
  for (const elemento of elementos) {
    if (!esZona(elemento)) colocadas.push(cajaEn(proyectar(elemento), OTRO[elemento.tipo]));
  }
  for (const zona of zonas.toSorted(porPrioridad)) {
    const punto = proyectar(zona);
    const completa = cajaDe(zona, punto, "completa");
    const cabe = !colocadas.some((otra) => sePisan(completa, otra));
    const forma: FormaDeZona = cabe ? "completa" : "compacta";
    colocadas.push(cabe ? completa : cajaDe(zona, punto, "compacta"));
    formas.set(zona.clave, forma);
  }
  return formas;
};
