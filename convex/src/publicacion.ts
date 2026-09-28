import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import {
  codificarVigente,
  decodificarVigente,
  type EmplazamientoDeCapa,
  FICHERO_VIGENTE,
  ficheroDeCapa,
  generarCapa,
  versionDeCapa,
  type Vigente,
} from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { generarLote } from "@celda/dominio/loteDeFichas";
import { EMPLAZAMIENTOS_POR_LOTE } from "@celda/dominio/lotes";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import refs from "../confect/_generated/refs";
import type { PaginaDeInstantanea } from "../confect/capas.spec";
import type { Publicada, ResultadoPublicacion } from "../confect/publicacion.spec";

/**
 * El almacén de ficheros donde se publica: una carpeta servida por un origen estático, o R2
 * detrás de la CDN. Todo fichero es inmutable menos `vigente.json`.
 */
export class AlmacenDeFicheros extends Context.Service<
  AlmacenDeFicheros,
  {
    /**
     * Guarda un fichero que no cambiará nunca. Si ya existe con el mismo contenido no hace nada
     * (`false`); si existe con otro, falla con `FicheroInmutable` y no lo toca.
     */
    readonly guardar: (
      fichero: string,
      contenido: string,
    ) => Effect.Effect<boolean, FicheroInmutable | AlmacenNoDisponible>;
    /** Lee un fichero; `None` si no existe. */
    readonly leer: (fichero: string) => Effect.Effect<Option.Option<string>, AlmacenNoDisponible>;
    /** Sustituye `vigente.json`, el único fichero que cambia. */
    readonly cambiarVigente: (contenido: string) => Effect.Effect<void, AlmacenNoDisponible>;
    /** Todos los ficheros guardados, con su ruta dentro del almacén (`fichas@…/0.json`). */
    readonly listar: Effect.Effect<ReadonlyArray<string>, AlmacenNoDisponible>;
    /** Borra un fichero de una versión retirada. Si ya no está, no hace nada. */
    readonly borrar: (fichero: string) => Effect.Effect<void, AlmacenNoDisponible>;
    /** URL pública de un fichero. */
    readonly url: (fichero: string) => string;
  }
>()("@celda/convex/publicacion/AlmacenDeFicheros") {}

/** Ya hay un fichero con ese nombre y otro contenido. */
export class FicheroInmutable extends Schema.TaggedError<FicheroInmutable>()("FicheroInmutable", {
  fichero: Schema.String,
}) {}

/** No se ha podido leer o escribir en el almacén. */
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

/**
 * El almacén ya tiene publicada una versión posterior a los datos: otro despliegue publica en el
 * mismo sitio, o se ha restaurado una copia antigua de Convex. No se retrocede.
 */
export class VigentePosterior extends Schema.TaggedError<VigentePosterior>()("VigentePosterior", {
  vigente: Schema.String,
  datos: Schema.String,
}) {}

/** `vigente.json` existe pero no se entiende: no se sabe qué hay publicado. */
export class VigenteIlegible extends Schema.TaggedError<VigenteIlegible>()("VigenteIlegible", {
  motivo: Schema.String,
}) {}

export type FalloPublicacion =
  | Schema.SchemaError
  | FicheroInmutable
  | AlmacenNoDisponible
  | SinEmplazamientos
  | InstantaneaMovida
  | VigentePosterior
  | VigenteIlegible;

/** Emplazamientos por página de la instantánea: cada uno lee además sus estaciones base. */
const PAGINA = 250;

/** Lotes que se leen y se escriben a la vez. */
const A_LA_VEZ = 4;

const bytesDe = (texto: string): number => new TextEncoder().encode(texto).length;

/** Lo que dice `vigente.json` del almacén, si existe. */
const vigenteDelAlmacen = Effect.gen(function* () {
  const almacen = yield* AlmacenDeFicheros;
  const contenido = yield* almacen.leer(FICHERO_VIGENTE);
  if (Option.isNone(contenido)) return Option.none<Vigente>();
  const leido = decodificarVigente(contenido.value);
  if (Result.isFailure(leido)) {
    return yield* new VigenteIlegible({ motivo: leido.failure.message });
  }
  return Option.some(leido.success);
});

/**
 * Cuántas versiones anteriores a la vigente se quedan en el almacén (issue #14). Una pestaña que
 * lleva días abierta sigue leyendo las fichas de su versión; si ya no están, lee las de la
 * vigente y lo dice (ADR 0004).
 */
export const VERSIONES_ANTERIORES = 7;

/** El sello de la versión de un fichero publicado (`2026-09-26T02:15:03Z`), o `undefined`. */
const selloDe = (fichero: string): string | undefined =>
  /^(?:sitios|fichas)@([^/]+?)(?:\.json|\/\d+\.json)$/u.exec(fichero)?.[1];

/**
 * Borra del almacén las versiones que sobran: se quedan la vigente, las `VERSIONES_ANTERIORES`
 * anteriores y cualquier versión posterior a la vigente, que puede ser otra publicación a medias.
 * De cada versión retirada se borra primero la capa, para que nadie empiece a leerla, y luego
 * sus lotes. Devuelve las versiones retiradas.
 */
export const retirarVersionesViejas = Effect.fn("Publicacion.retirarVersionesViejas")(function* (
  vigente: string,
) {
  const almacen = yield* AlmacenDeFicheros;
  const sello = selloDe(ficheroDeCapa(vigente));
  if (sello === undefined) return [];
  const ficheros = yield* almacen.listar;
  const anteriores = [
    ...new Set(ficheros.flatMap((f) => selloDe(f) ?? []).filter((s) => s < sello)),
  ].sort((a, b) => (a < b ? 1 : -1));
  const viejas = new Set(anteriores.slice(VERSIONES_ANTERIORES));
  const deViejas = ficheros.filter((f) => viejas.has(selloDe(f) ?? ""));
  const capas = deViejas.filter((f) => f.startsWith("sitios@"));
  yield* Effect.forEach(capas, almacen.borrar, { concurrency: A_LA_VEZ, discard: true });
  yield* Effect.forEach(
    deViejas.filter((f) => !f.startsWith("sitios@")),
    almacen.borrar,
    { concurrency: A_LA_VEZ, discard: true },
  );
  return [...viejas].map((s) => `sitios@${s}`);
});

/**
 * La retirada tras publicar. Si falla, la publicación sigue siendo buena: se apunta en el
 * registro y la siguiente lo vuelve a intentar.
 */
const retirarTrasPublicar = (vigente: string) =>
  retirarVersionesViejas(vigente).pipe(
    Effect.tap((retiradas) =>
      retiradas.length === 0
        ? Effect.void
        : Effect.logInfo(`Versiones retiradas del almacén: ${retiradas.join(", ")}`),
    ),
    Effect.catch((fallo) =>
      Effect.logWarning(`No se han podido retirar las versiones viejas: ${fallo.motivo}`),
    ),
  );

/**
 * Publica la instantánea actual: la capa y las fichas de todos sus emplazamientos, de la misma
 * versión, y después `vigente.json` apuntando a ella.
 *
 * 1. Lee la versión de los datos. Si `vigente.json` ya apunta a ella, termina sin escribir nada.
 * 2. Lee todos los emplazamientos por páginas y comprueba que la versión no se ha movido.
 * 3. Genera la capa, con el barrio de cada emplazamiento según `limites` y su lote de fichas.
 * 4. Lee las fichas de cada lote y guarda el lote. Si falta alguna, los datos han cambiado.
 * 5. Vuelve a comprobar la versión, guarda la capa y la registra en Convex.
 * 6. Cambia `vigente.json`, salvo que otra publicación haya dejado ya una versión posterior.
 * 7. Retira las versiones que sobran (`retirarVersionesViejas`), también si estaba al día.
 *
 * Ningún fichero se pisa con otro contenido, y la web no ve la versión nueva hasta el paso 6,
 * cuando todo lo que necesita ya está en el almacén. Repetirla sin cambios no escribe nada.
 */
export const publicar = Effect.fn("Publicacion.publicar")(function* (
  limites: LimitesDeBarrios,
  porLote: number = EMPLAZAMIENTOS_POR_LOTE,
) {
  const consulta = yield* QueryRunner.QueryRunner;
  const mutacion = yield* MutationRunner.MutationRunner;
  const almacen = yield* AlmacenDeFicheros;

  const { version: fecha } = yield* consulta(refs.internal.datos.version);
  if (fecha === null) {
    return yield* new SinEmplazamientos();
  }
  const version = versionDeCapa(fecha);
  const previa = yield* vigenteDelAlmacen;
  if (Option.isSome(previa)) {
    if (previa.value.version === version) {
      yield* retirarTrasPublicar(version);
      return {
        version,
        tipo: "al-dia",
        emplazamientos: previa.value.emplazamientos,
        lotes: previa.value.lotes,
        escritos: 0,
        bytesCapa: 0,
        bytesLoteMayor: 0,
        bytesFichas: 0,
      } satisfies Publicada;
    }
    if (previa.value.fecha > fecha) {
      return yield* new VigentePosterior({ vigente: previa.value.version, datos: version });
    }
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
  const comprobarVersion = Effect.gen(function* () {
    const ahora = yield* consulta(refs.internal.datos.version);
    if (ahora.version !== fecha) {
      return yield* new InstantaneaMovida({ antes: fecha, despues: ahora.version });
    }
  });
  yield* comprobarVersion;

  const capa = generarCapa(fecha, emplazamientos, limites, porLote);
  const escritos = yield* Ref.make(0);
  const guardar = (fichero: string, contenido: string) =>
    Effect.tap(almacen.guardar(fichero, contenido), (nuevo) =>
      nuevo ? Ref.update(escritos, (n) => n + 1) : Effect.void,
    );

  const bytesLotes = yield* Effect.forEach(
    capa.lotes,
    (claves, lote) =>
      Effect.gen(function* () {
        const fichas: ReadonlyArray<Ficha> = yield* consulta(refs.internal.capas.fichas, {
          claves,
        });
        if (fichas.length !== claves.length) {
          return yield* new InstantaneaMovida({ antes: fecha, despues: null });
        }
        const generado = generarLote(version, lote, fichas);
        yield* guardar(generado.fichero, generado.contenido);
        return bytesDe(generado.contenido);
      }),
    { concurrency: A_LA_VEZ },
  );
  yield* comprobarVersion;

  const bytesCapa = bytesDe(capa.contenido);
  yield* guardar(capa.fichero, capa.contenido);
  yield* mutacion(refs.internal.capas.registrar, {
    version,
    fecha,
    url: almacen.url(capa.fichero),
    emplazamientos: capa.emplazamientos,
    bytes: bytesCapa,
    publicadaEn: yield* Clock.currentTimeMillis,
  });

  // Otra publicación puede haber terminado mientras tanto: solo se avanza, nunca se retrocede.
  const antes = yield* vigenteDelAlmacen;
  if (Option.isNone(antes) || antes.value.fecha < fecha) {
    yield* almacen.cambiarVigente(
      codificarVigente({
        version,
        fecha,
        emplazamientos: capa.emplazamientos,
        lotes: capa.lotes.length,
      }),
    );
    yield* Ref.update(escritos, (n) => n + 1);
  }
  // La vigente es esta o una posterior que ha dejado otra publicación.
  yield* retirarTrasPublicar(
    Option.isSome(antes) && antes.value.fecha > fecha ? antes.value.version : version,
  );

  return {
    version,
    tipo: "publicada",
    emplazamientos: capa.emplazamientos,
    lotes: capa.lotes.length,
    escritos: yield* Ref.get(escritos),
    bytesCapa,
    bytesLoteMayor: Math.max(0, ...bytesLotes),
    bytesFichas: bytesLotes.reduce((suma, b) => suma + b, 0),
  } satisfies Publicada;
});

const describirFallo = (fallo: FalloPublicacion): string => {
  switch (fallo._tag) {
    case "FicheroInmutable":
      return `${fallo.fichero} ya existe con otro contenido`;
    case "AlmacenNoDisponible":
      return `el almacén no responde: ${fallo.motivo}`;
    case "SinEmplazamientos":
      return "no hay emplazamientos";
    case "InstantaneaMovida":
      return "los datos han cambiado mientras se publicaba";
    case "VigentePosterior":
      return `el almacén ya tiene ${fallo.vigente}, posterior a ${fallo.datos}`;
    case "VigenteIlegible":
      return `vigente.json no se entiende: ${fallo.motivo}`;
    case "SchemaError":
      return `Convex ha respondido algo inesperado: ${fallo.message}`;
  }
};

/**
 * Publica, y convierte un fallo en un resultado que lo cuenta. La usan la acción de publicar y
 * las pruebas: una publicación fallida no deshace la ingesta, y la siguiente la repite.
 */
export const publicarYContar = (limites: LimitesDeBarrios, porLote?: number) =>
  publicar(limites, porLote).pipe(
    Effect.catch((fallo) =>
      Effect.succeed<ResultadoPublicacion>({ tipo: "fallida", motivo: describirFallo(fallo) }),
    ),
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
