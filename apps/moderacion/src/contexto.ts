import { distanciaMetros } from "@celda/dominio/area";
import {
  type AportacionConContexto,
  type AportacionEnCola,
  CONTEXTOS_POR_LLAMADA,
  type ContextoEnElBuzon,
  PAGINA_MAXIMA,
  type PaginaDeCola,
  puntoPropuesto,
  RADIO_CERCANOS_M,
} from "@celda/dominio/moderacion";
import type { TipoCompartible } from "@celda/dominio/aportacion";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { BuzonAdministrado } from "./buzon.ts";
import { LoPublicado } from "./publicado.ts";

/**
 * El contexto entero de una aportación: lo que sabe el buzón y lo que está publicado del mismo
 * emplazamiento (`AportacionConContexto`).
 */
export const conLoPublicado = Effect.fn("Moderacion.conLoPublicado")(function* (
  enBuzon: ContextoEnElBuzon,
) {
  const publicado = yield* LoPublicado;
  const { aportacion } = enBuzon;
  const { contenido } = aportacion;
  const emplazamiento = contenido.emplazamiento;
  const ficha = Option.getOrNull(
    emplazamiento === null ? Option.none() : yield* publicado.ficha(emplazamiento),
  );
  const punto = puntoPropuesto(contenido);
  const cercanos =
    emplazamiento === null && punto !== null
      ? yield* publicado.cercanos(punto, RADIO_CERCANOS_M)
      : [];
  const distanciaM =
    ficha !== null && punto !== null
      ? Math.round(distanciaMetros(ficha.posicion, punto))
      : (cercanos[0]?.metros ?? null);
  const completo: AportacionConContexto = {
    aportacion,
    emplazamiento,
    version: Option.getOrNull(yield* publicado.version),
    publicado: ficha,
    distanciaM,
    cercanos,
    historial: enBuzon.historial,
    relacionadas: enBuzon.relacionadas,
  };
  return completo;
});

/** El contexto entero de unas aportaciones del buzón, en el mismo orden. */
export const contextosDe = Effect.fn("Moderacion.contextosDe")(function* (
  ids: ReadonlyArray<string>,
) {
  const buzon = yield* BuzonAdministrado;
  const tandas: Array<ReadonlyArray<string>> = [];
  for (let desde = 0; desde < ids.length; desde += CONTEXTOS_POR_LLAMADA) {
    tandas.push(ids.slice(desde, desde + CONTEXTOS_POR_LLAMADA));
  }
  const enBuzon = (yield* Effect.forEach(tandas, buzon.contexto)).flat();
  return yield* Effect.forEach(enBuzon, conLoPublicado);
});

/** Qué pendientes se piden: de qué tipos y cuántas como mucho. */
export interface FiltroDePendientes {
  readonly tipos: ReadonlyArray<TipoCompartible>;
  readonly limite: number;
}

/**
 * Las pendientes más antiguas de los tipos del filtro, hasta `limite`, recorriendo la cola por
 * páginas.
 */
export const pendientesDe = Effect.fn("Moderacion.pendientesDe")(function* (
  filtro: FiltroDePendientes,
) {
  const buzon = yield* BuzonAdministrado;
  const elegidas: Array<AportacionEnCola> = [];
  let despuesDe: number | null = null;
  while (elegidas.length < filtro.limite) {
    const pagina: PaginaDeCola = yield* buzon.pendientes(despuesDe, PAGINA_MAXIMA);
    for (const aportacion of pagina.aportaciones) {
      if (filtro.tipos.length === 0 || filtro.tipos.includes(aportacion.contenido.tipo)) {
        elegidas.push(aportacion);
      }
    }
    if (pagina.ultima === null) break;
    despuesDe = pagina.ultima;
  }
  return elegidas.slice(0, filtro.limite);
});

/** Las pendientes del filtro con su contexto entero. */
export const pendientesConContexto = Effect.fn("Moderacion.pendientesConContexto")(function* (
  filtro: FiltroDePendientes,
) {
  const pendientes = yield* pendientesDe(filtro);
  return yield* contextosDe(pendientes.map((a) => a.id));
});

/** Todas las aceptadas después de `despuesDe`, en el orden en que se aceptaron, y la última hora. */
export const aceptadasDesde = Effect.fn("Moderacion.aceptadasDesde")(function* (
  despuesDe: number | null,
) {
  const buzon = yield* BuzonAdministrado;
  const aceptadas: Array<AportacionEnCola> = [];
  let cursor = despuesDe;
  for (;;) {
    const pagina: PaginaDeCola = yield* buzon.aceptadas(cursor, PAGINA_MAXIMA);
    aceptadas.push(...pagina.aportaciones);
    if (pagina.ultima === null) break;
    cursor = pagina.ultima;
  }
  const ultima = aceptadas.at(-1)?.moderadaEl ?? despuesDe;
  return { aceptadas, ultima };
});
