import { type EmplazamientoDeCapa, generarCapa } from "@celda/dominio/capa";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import refs from "../confect/_generated/refs";
import type { PaginaDeInstantanea } from "../confect/capas.spec";

/** Dónde se guardan las capas: una carpeta servida por un origen estático o una CDN. */
export class AlmacenDeCapas extends Context.Service<
  AlmacenDeCapas,
  {
    /**
     * Guarda un fichero nuevo. Si ya existe con el mismo contenido no hace nada (`false`); si
     * existe con otro, falla: una versión publicada no cambia nunca.
     */
    readonly guardar: (
      fichero: string,
      contenido: string,
    ) => Effect.Effect<boolean, CapaInmutable | AlmacenNoDisponible>;
    /** URL pública del fichero en el origen. */
    readonly url: (fichero: string) => string;
  }
>()("@celda/convex/capas/AlmacenDeCapas") {}

/** Ya hay un fichero con ese nombre y otro contenido. */
export class CapaInmutable extends Schema.TaggedError<CapaInmutable>()("CapaInmutable", {
  fichero: Schema.String,
}) {}

/** No se ha podido leer o escribir en el almacén de capas. */
export class AlmacenNoDisponible extends Schema.TaggedError<AlmacenNoDisponible>()(
  "AlmacenNoDisponible",
  { motivo: Schema.String },
) {}

/** No hay emplazamientos de los que sacar una capa. */
export class SinEmplazamientos extends Schema.TaggedError<SinEmplazamientos>()(
  "SinEmplazamientos",
  {},
) {}

/** Los datos cambiaron mientras se leía la instantánea; hay que volver a empezar. */
export class InstantaneaMovida extends Schema.TaggedError<InstantaneaMovida>()(
  "InstantaneaMovida",
  { antes: Schema.Finite, despues: Schema.NullOr(Schema.Finite) },
) {}

export interface CapaPublicadaAhora {
  readonly version: string;
  readonly url: string;
  readonly emplazamientos: number;
  readonly bytes: number;
  /** Si el fichero no existía y se ha escrito ahora. */
  readonly ficheroNuevo: boolean;
  /** Si la versión no estaba registrada en Convex. */
  readonly versionNueva: boolean;
}

/** Emplazamientos por página: cada uno lee además sus estaciones base. */
const PAGINA = 250;

/**
 * Publica la capa de la instantánea actual:
 *
 * 1. Lee la versión de los datos y todos los emplazamientos por páginas.
 * 2. Vuelve a leer la versión. Si ha cambiado, las páginas no son de la misma instantánea y la
 *    publicación falla sin escribir nada.
 * 3. Genera la capa, la guarda en el almacén (sin pisar nunca un fichero distinto) y la registra
 *    en Convex como vigente.
 *
 * Repetirla sin cambios en los datos no escribe nada: el fichero y la versión ya existen.
 */
export const publicarCapa = Effect.fn("Capas.publicar")(function* () {
  const consulta = yield* QueryRunner.QueryRunner;
  const mutacion = yield* MutationRunner.MutationRunner;
  const almacen = yield* AlmacenDeCapas;

  const { version: fecha } = yield* consulta(refs.public.datos.version);
  if (fecha === null) {
    return yield* new SinEmplazamientos();
  }
  const emplazamientos: Array<EmplazamientoDeCapa> = [];
  let despuesDe: string | null = null;
  do {
    const pagina: typeof PaginaDeInstantanea.Type = yield* consulta(
      refs.internal.capas.instantanea,
      { despuesDe, limite: PAGINA },
    );
    emplazamientos.push(...pagina.elementos);
    despuesDe = pagina.ultima;
  } while (despuesDe !== null);
  const despues = yield* consulta(refs.public.datos.version);
  if (despues.version !== fecha) {
    return yield* new InstantaneaMovida({ antes: fecha, despues: despues.version });
  }

  const capa = generarCapa(fecha, emplazamientos);
  const bytes = new TextEncoder().encode(capa.contenido).length;
  const ficheroNuevo = yield* almacen.guardar(capa.fichero, capa.contenido);
  const url = almacen.url(capa.fichero);
  const { nueva } = yield* mutacion(refs.internal.capas.registrar, {
    version: capa.version,
    fecha,
    url,
    emplazamientos: capa.emplazamientos,
    bytes,
    publicadaEn: yield* Clock.currentTimeMillis,
  });
  return {
    version: capa.version,
    url,
    emplazamientos: capa.emplazamientos,
    bytes,
    ficheroNuevo,
    versionNueva: nueva,
  } satisfies CapaPublicadaAhora;
});
