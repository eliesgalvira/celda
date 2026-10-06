import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Ya hay un fichero con ese nombre y otro contenido. */
export class FicheroInmutable extends Schema.TaggedError<FicheroInmutable>()("FicheroInmutable", {
  fichero: Schema.String,
}) {}

/** No se ha podido leer o escribir en el almacén. */
export class AlmacenNoDisponible extends Schema.TaggedError<AlmacenNoDisponible>()(
  "AlmacenNoDisponible",
  { motivo: Schema.String },
) {}

/**
 * El almacén de ficheros donde se publica: una carpeta servida por un origen estático, o el cubo
 * privado de R2 del que el build de Vercel monta las capas (ADR 0018). Todo fichero es inmutable
 * menos `vigente.json`.
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
>()("@celda/publicacion/almacen/AlmacenDeFicheros") {}

/**
 * Dónde van, fuera de la máquina de la ingesta, las copias de seguridad de su base: un prefijo
 * propio del cubo de R2 (ADR 0018). Cada copia es un fichero nuevo con la fecha en el nombre.
 */
export class AlmacenDeCopias extends Context.Service<
  AlmacenDeCopias,
  {
    /** Sube una copia. Si ya hay una con ese nombre, la sustituye. */
    readonly guardar: (
      nombre: string,
      contenido: Uint8Array<ArrayBuffer>,
    ) => Effect.Effect<void, AlmacenNoDisponible>;
    /** Los nombres de las copias guardadas, sin el prefijo. */
    readonly listar: Effect.Effect<ReadonlyArray<string>, AlmacenNoDisponible>;
    /** Borra una copia. Si ya no está, no hace nada. */
    readonly borrar: (nombre: string) => Effect.Effect<void, AlmacenNoDisponible>;
  }
>()("@celda/publicacion/almacen/AlmacenDeCopias") {}

/**
 * Dónde va, fuera de la máquina de la ingesta, el archivo de páginas del registro oficial: otro
 * prefijo propio del cubo de R2 (ADR 0027). Cada paquete del archivo se sube una vez y no se borra
 * nunca, así que no tiene `borrar`.
 */
export class AlmacenDelArchivo extends Context.Service<
  AlmacenDelArchivo,
  {
    /** Sube un paquete. Si ya hay uno con ese nombre, lo sustituye. */
    readonly guardar: (
      nombre: string,
      contenido: Uint8Array<ArrayBuffer>,
    ) => Effect.Effect<void, AlmacenNoDisponible>;
    /** Los nombres de los paquetes subidos, sin el prefijo. */
    readonly listar: Effect.Effect<ReadonlyArray<string>, AlmacenNoDisponible>;
  }
>()("@celda/publicacion/almacen/AlmacenDelArchivo") {}
