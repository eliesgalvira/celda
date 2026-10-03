import { cajaDeCuadro, type ZonaDeBarrido } from "@celda/dominio/barrido";
import type { ZonaBarrida } from "@celda/dominio/cobertura";

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
