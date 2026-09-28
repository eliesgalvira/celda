import type { Caja, ZonaBarrida } from "@celda/dominio/cobertura";

/** Una zona de barrido tal como la configura la ingesta, sin la fecha de su último barrido. */
export type ZonaDeBarrido = Omit<ZonaBarrida, "barrido">;

/**
 * La zona de barrido mientras el registro oficial se lee en una sola caja: la caja entera, que no
 * barre de punta a punta ninguna provincia. Las zonas por celdas y provincias del ADR 0014
 * sustituyen a esta.
 */
export const zonaDeLaCaja = (caja: Caja): ZonaDeBarrido => ({
  nombre: "registro-oficial",
  cajas: [caja],
  provincias: [],
});

/**
 * Las zonas con la fecha de su último barrido completo: la de la última ejecución completada del
 * registro oficial, que hoy las recorre todas en cada ejecución.
 */
export const coberturaCon = (
  zonas: ReadonlyArray<ZonaDeBarrido>,
  barrido: number | null,
): ReadonlyArray<ZonaBarrida> => zonas.map((zona) => ({ ...zona, barrido }));
