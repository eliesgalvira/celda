import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import {
  DatosNoDisponibles,
  DatosPublicables,
  publicar as publicarDatos,
  publicarYContar as publicarYContarDatos,
  type ResultadoPublicacion,
} from "@celda/publicacion/publicar";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import refs from "../confect/_generated/refs";
import type { PaginaDeInstantanea } from "../confect/capas.spec";

/** Emplazamientos por página de la instantánea: cada uno lee además sus estaciones base. */
const PAGINA = 250;

/** Un fallo de Convex, para el registro de la publicación. */
const noDisponible = (error: { readonly message: string }) =>
  new DatosNoDisponibles({ motivo: `Convex ha respondido algo inesperado: ${error.message}` });

/**
 * Los datos de la publicación sacados de Convex con sus funciones internas: la versión, la
 * instantánea por páginas, las fichas de cada lote y el registro de las capas publicadas.
 */
const datosDeConvex = Effect.gen(function* () {
  const consulta = yield* QueryRunner.QueryRunner;
  const mutacion = yield* MutationRunner.MutationRunner;
  return DatosPublicables.of({
    version: consulta(refs.internal.datos.version).pipe(
      Effect.map(({ version }) => version),
      Effect.mapError(noDisponible),
    ),
    emplazamientos: Effect.gen(function* () {
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
      return emplazamientos;
    }).pipe(Effect.mapError(noDisponible)),
    fichas: (claves) =>
      consulta(refs.internal.capas.fichas, { claves }).pipe(Effect.mapError(noDisponible)),
    registrar: ({ ficheros: _ficheros, ...capa }) =>
      mutacion(refs.internal.capas.registrar, capa).pipe(
        Effect.asVoid,
        Effect.mapError(noDisponible),
      ),
  });
});

/** Publica la instantánea de Convex en el almacén del contexto (`publicar` de `@celda/publicacion`). */
export const publicar = (limites: LimitesDeBarrios, porLote?: number) =>
  Effect.flatMap(datosDeConvex, (datos) =>
    publicarDatos(limites, porLote).pipe(Effect.provideService(DatosPublicables, datos)),
  );

/**
 * Publica, y convierte un fallo en un resultado que lo cuenta. La usan la acción de publicar y
 * las pruebas: una publicación fallida no deshace la ingesta, y la siguiente la repite.
 */
export const publicarYContar = (limites: LimitesDeBarrios, porLote?: number) =>
  Effect.flatMap(datosDeConvex, (datos) =>
    publicarYContarDatos(limites, porLote).pipe(Effect.provideService(DatosPublicables, datos)),
  );

/**
 * Lo que hace la ingesta al terminar una ejecución completada: publicar. Publicar sin cambios no
 * escribe nada, así que se llama siempre, y si la anterior falló la recupera.
 */
export class Publicacion extends Context.Service<
  Publicacion,
  { readonly publicar: Effect.Effect<ResultadoPublicacion> }
>()("@celda/convex/publicacion") {}

/** La publicación en el mismo proceso, con el Convex y el almacén que haya en el contexto. */
export const publicacionDirecta = (limites: LimitesDeBarrios, porLote?: number) =>
  Layer.effect(
    Publicacion,
    Effect.map(
      Effect.context<QueryRunner.QueryRunner | MutationRunner.MutationRunner | AlmacenDeFicheros>(),
      (contexto) =>
        Publicacion.of({
          publicar: publicarYContar(limites, porLote).pipe(Effect.provideContext(contexto)),
        }),
    ),
  );

/** Publica tras una ejecución de ingesta y apunta en el registro qué ha pasado. */
export const publicarTrasLaIngesta = Effect.gen(function* () {
  const publicacion = yield* Publicacion;
  const resultado = yield* publicacion.publicar;
  if (resultado.tipo === "fallida") {
    yield* Effect.logWarning(`Publicación fallida: ${resultado.motivo}`);
  } else if (resultado.tipo === "sin-almacen") {
    yield* Effect.logInfo("Sin almacén de ficheros: no se publica nada");
  } else {
    yield* Effect.logInfo(
      `${resultado.version}: ${resultado.tipo}, ${resultado.escritos} ficheros escritos`,
    );
  }
  return resultado;
});
