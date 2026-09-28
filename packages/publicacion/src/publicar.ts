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
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AlmacenDeFicheros, type AlmacenNoDisponible, type FicheroInmutable } from "./almacen.ts";
import { sha256 } from "./almacenes/firma.ts";

/** Lo que ha hecho una publicación. */
export const Publicada = Schema.Struct({
  version: Schema.String,
  /** `al-dia` si el almacén ya tenía esa versión como vigente y no se ha escrito nada. */
  tipo: Schema.Literals(["publicada", "al-dia"]),
  emplazamientos: Schema.Int,
  lotes: Schema.Int,
  /** Ficheros escritos ahora, contando `vigente.json`. Cero si no ha cambiado nada. */
  escritos: Schema.Int,
  /** Tamaño de la capa y del mayor lote de fichas, sin comprimir. */
  bytesCapa: Schema.Int,
  bytesLoteMayor: Schema.Int,
  /** Suma de los lotes de fichas, sin comprimir. */
  bytesFichas: Schema.Int,
});
export type Publicada = typeof Publicada.Type;

/** Lo que ha pasado al publicar tras una ingesta. Nunca es un fallo: la ingesta ya ha terminado. */
export const ResultadoPublicacion = Schema.Union([
  Publicada,
  /** No hay almacén de ficheros configurado: no se publica nada. */
  Schema.Struct({ tipo: Schema.Literal("sin-almacen") }),
  /** La publicación ha fallado; la próxima la vuelve a intentar. */
  Schema.Struct({ tipo: Schema.Literal("fallida"), motivo: Schema.String }),
]);
export type ResultadoPublicacion = typeof ResultadoPublicacion.Type;

/** Un fichero de una versión publicada, con su huella (SHA-256) y su tamaño sin comprimir. */
export const FicheroPublicado = Schema.Struct({
  fichero: Schema.String,
  huella: Schema.String,
  bytes: Schema.Int,
});
export type FicheroPublicado = typeof FicheroPublicado.Type;

/** Una versión recién publicada: la capa, dónde está y todos sus ficheros. */
export interface VersionPublicada {
  readonly version: string;
  /** Fecha de la instantánea, en milisegundos. */
  readonly fecha: number;
  readonly url: string;
  readonly emplazamientos: number;
  /** Tamaño de la capa sin comprimir. */
  readonly bytes: number;
  readonly publicadaEn: number;
  /** La capa y sus lotes de fichas, sin `vigente.json`. */
  readonly ficheros: ReadonlyArray<FicheroPublicado>;
}

/** La base de la que sale la instantánea no ha respondido o ha respondido algo inesperado. */
export class DatosNoDisponibles extends Schema.TaggedError<DatosNoDisponibles>()(
  "DatosNoDisponibles",
  { motivo: Schema.String },
) {}

/**
 * De dónde saca la publicación lo que publica: la base de la ingesta. La publicación no sabe si
 * es Convex o una base SQLite; solo le pide la versión de los datos, la instantánea y las fichas.
 */
export class DatosPublicables extends Context.Service<
  DatosPublicables,
  {
    /**
     * La fecha de la versión de los datos: la de la última ejecución que cambió o retiró algún
     * emplazamiento. `null` si no hay ninguno.
     */
    readonly version: Effect.Effect<number | null, DatosNoDisponibles>;
    /** Todos los emplazamientos de la instantánea, con lo que guarda la capa de cada uno. */
    readonly emplazamientos: Effect.Effect<ReadonlyArray<EmplazamientoDeCapa>, DatosNoDisponibles>;
    /** Las fichas de unos emplazamientos. Una clave sin emplazamiento no da ficha. */
    readonly fichas: (
      claves: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Ficha>, DatosNoDisponibles>;
    /** Apunta una versión publicada. Registrar otra vez la misma no la duplica. */
    readonly registrar: (publicada: VersionPublicada) => Effect.Effect<void, DatosNoDisponibles>;
  }
>()("@celda/publicacion/publicar/DatosPublicables") {}

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
 * El almacén ya tiene publicada una versión posterior a los datos: otra ingesta publica en el
 * mismo sitio, o se ha restaurado una copia antigua de la base. No se retrocede.
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
  | DatosNoDisponibles
  | FicheroInmutable
  | AlmacenNoDisponible
  | SinEmplazamientos
  | InstantaneaMovida
  | VigentePosterior
  | VigenteIlegible;

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

/** Un fichero generado, con su huella y su tamaño. */
const ficheroPublicado = (fichero: string, contenido: string) =>
  Effect.map(
    // Web Crypto no falla con un texto: si lo hace, es un defecto del entorno.
    Effect.orDie(sha256(contenido)),
    (huella): FicheroPublicado => ({ fichero, huella, bytes: bytesDe(contenido) }),
  );

/**
 * Publica la instantánea actual: la capa y las fichas de todos sus emplazamientos, de la misma
 * versión, y después `vigente.json` apuntando a ella.
 *
 * 1. Lee la versión de los datos. Si `vigente.json` ya apunta a ella, termina sin escribir nada.
 * 2. Lee todos los emplazamientos y comprueba que la versión no se ha movido.
 * 3. Genera la capa, con el barrio de cada emplazamiento según `limites` y su lote de fichas.
 * 4. Lee las fichas de cada lote y guarda el lote. Si falta alguna, los datos han cambiado.
 * 5. Vuelve a comprobar la versión, guarda la capa y la registra en la base.
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
  const datos = yield* DatosPublicables;
  const almacen = yield* AlmacenDeFicheros;

  const fecha = yield* datos.version;
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

  const emplazamientos = yield* datos.emplazamientos;
  const comprobarVersion = Effect.gen(function* () {
    const ahora = yield* datos.version;
    if (ahora !== fecha) {
      return yield* new InstantaneaMovida({ antes: fecha, despues: ahora });
    }
  });
  yield* comprobarVersion;

  const capa = generarCapa(fecha, emplazamientos, limites, porLote);
  const escritos = yield* Ref.make(0);
  const guardar = (fichero: string, contenido: string) =>
    Effect.tap(almacen.guardar(fichero, contenido), (nuevo) =>
      nuevo ? Ref.update(escritos, (n) => n + 1) : Effect.void,
    );

  const lotes = yield* Effect.forEach(
    capa.lotes,
    (claves, lote) =>
      Effect.gen(function* () {
        const fichas = yield* datos.fichas(claves);
        if (fichas.length !== claves.length) {
          return yield* new InstantaneaMovida({ antes: fecha, despues: null });
        }
        const generado = generarLote(version, lote, fichas);
        yield* guardar(generado.fichero, generado.contenido);
        return yield* ficheroPublicado(generado.fichero, generado.contenido);
      }),
    { concurrency: A_LA_VEZ },
  );
  yield* comprobarVersion;

  const fichaDeCapa = yield* ficheroPublicado(capa.fichero, capa.contenido);
  yield* guardar(capa.fichero, capa.contenido);
  yield* datos.registrar({
    version,
    fecha,
    url: almacen.url(capa.fichero),
    emplazamientos: capa.emplazamientos,
    bytes: fichaDeCapa.bytes,
    publicadaEn: yield* Clock.currentTimeMillis,
    ficheros: [fichaDeCapa, ...lotes],
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
    bytesCapa: fichaDeCapa.bytes,
    bytesLoteMayor: Math.max(0, ...lotes.map((l) => l.bytes)),
    bytesFichas: lotes.reduce((suma, l) => suma + l.bytes, 0),
  } satisfies Publicada;
});

/** Texto de un fallo de la publicación para el registro. */
export const describirFallo = (fallo: FalloPublicacion): string => {
  switch (fallo._tag) {
    case "DatosNoDisponibles":
      return `la base no responde: ${fallo.motivo}`;
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
  }
};

/**
 * Publica, y convierte un fallo en un resultado que lo cuenta. Una publicación fallida no deshace
 * la ingesta, y la siguiente la repite.
 */
export const publicarYContar = (limites: LimitesDeBarrios, porLote?: number) =>
  publicar(limites, porLote).pipe(
    Effect.catch((fallo) =>
      Effect.succeed<ResultadoPublicacion>({ tipo: "fallida", motivo: describirFallo(fallo) }),
    ),
  );
