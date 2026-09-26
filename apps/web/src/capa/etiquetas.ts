import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import {
  type FormaDeBarrio,
  type Medida,
  medidaDeBarrio,
} from "@celda/ui/marcadores/MarcadorBarrio.tsx";

import type { ElementoBarrio } from "./agrupacion.ts";

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

const sePisan = (a: Caja, b: Caja): boolean =>
  a.izquierda < b.derecha && b.izquierda < a.derecha && a.arriba < b.abajo && b.arriba < a.abajo;

/** Primero los barrios con más emplazamientos; a igualdad, por código, para que no baile. */
const porPrioridad = (a: ElementoBarrio, b: ElementoBarrio): number =>
  b.resumen.emplazamientos - a.resumen.emplazamientos ||
  (a.resumen.barrio.codigo < b.resumen.barrio.codigo ? -1 : 1);

/**
 * Qué forma toma la etiqueta de cada barrio en la pantalla. Se colocan de más a menos
 * emplazamientos: cada una va completa si no pisa ninguna de las ya colocadas y compacta si no.
 * La compacta se dibuja aunque pise otra, porque esconder un barrio haría creer que no tiene
 * emplazamientos. Con el zoom del nivel de barrios, en Barcelona se pisan pocas.
 */
export const formasDeBarrios = (
  barrios: ReadonlyArray<ElementoBarrio>,
  proyectar: (barrio: ElementoBarrio) => Salto,
): ReadonlyMap<string, FormaDeBarrio> => {
  const colocadas: Array<Caja> = [];
  const formas = new Map<string, FormaDeBarrio>();
  for (const barrio of barrios.toSorted(porPrioridad)) {
    const punto = proyectar(barrio);
    const { nombre } = barrio.resumen.barrio;
    const completa = cajaEn(
      punto,
      medidaDeBarrio("completa", nombre, barrio.resumen.ausentes.length),
    );
    const cabe = !colocadas.some((otra) => sePisan(completa, otra));
    const forma: FormaDeBarrio = cabe ? "completa" : "compacta";
    colocadas.push(cabe ? completa : cajaEn(punto, medidaDeBarrio("compacta", nombre, 0)));
    formas.set(barrio.clave, forma);
  }
  return formas;
};
