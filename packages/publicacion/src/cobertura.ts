import { type Caja, cajaDeCuadro, type ZonaDeBarrido } from "@celda/dominio/barrido";
import type { ZonaBarrida } from "@celda/dominio/cobertura";

/**
 * La zona de una ingesta que lee el registro oficial en una sola caja, como la de Convex con la
 * caja de Barcelona: la caja entera, que no barre de punta a punta ningún cuadro.
 */
export const zonaDeLaCaja = (caja: Caja, titulo: string, barrido: number | null): ZonaBarrida => ({
  nombre: "registro-oficial",
  titulo,
  cajas: [caja],
  barrido,
});

/**
 * Las zonas de barrido por cuadros (ADR 0014) tal como se publican: sus cuadros como cajas y la
 * fecha de su último barrido completo, o `null` si aún no se ha completado ninguno.
 */
export const zonasBarridas = (
  zonas: ReadonlyArray<ZonaDeBarrido>,
  barridos: ReadonlyMap<string, number | null>,
): ReadonlyArray<ZonaBarrida> =>
  zonas.map((zona) => ({
    nombre: zona.nombre,
    titulo: zona.titulo,
    cajas: zona.cuadros.map(cajaDeCuadro),
    barrido: barridos.get(zona.nombre) ?? null,
  }));
