import {
  Aportacion,
  type ContenidoAportacion,
  type TipoAportacion,
} from "@celda/dominio/aportacion";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** El dispositivo no deja guardar ni leer aportaciones: sin IndexedDB, sin espacio o bloqueado. */
export class AlmacenNoDisponible extends Schema.TaggedError<AlmacenNoDisponible>()(
  "AlmacenNoDisponible",
  { motivo: Schema.String },
) {}

/**
 * Las aportaciones guardadas en el dispositivo, sin cuenta (ADR 0007), con su formato definitivo
 * (`nuevaAportacion` les pone el identificador y la fecha). Borrar es borrar de verdad: no queda
 * copia en ninguna parte.
 */
export class AlmacenLocal extends Context.Service<
  AlmacenLocal,
  {
    /** Las aportaciones de un tipo, de la más antigua a la más reciente. */
    readonly leer: (
      tipo: TipoAportacion,
    ) => Effect.Effect<ReadonlyArray<Aportacion>, AlmacenNoDisponible>;
    /** Guarda una aportación en lugar de las que hubiera de su tipo, todo de una vez. */
    readonly sustituir: (aportacion: Aportacion) => Effect.Effect<void, AlmacenNoDisponible>;
    /** Borra todas las aportaciones de un tipo. */
    readonly borrar: (tipo: TipoAportacion) => Effect.Effect<void, AlmacenNoDisponible>;
  }
>()("@celda/web/ubicacion/almacen/AlmacenLocal") {}

const BASE = "celda";
const VERSION_BASE = 1;
const APORTACIONES = "aportaciones";
const POR_TIPO = "tipo";

const leerAportacion = Schema.decodeUnknownOption(Aportacion);

/**
 * Una aportación nueva con su identificador y su fecha de creación. Sin números aleatorios
 * seguros no se crea nada: es un defecto del navegador, no algo que se pueda arreglar aquí.
 */
export const nuevaAportacion = Effect.fn("AlmacenLocal.nuevaAportacion")(function* (
  contenido: ContenidoAportacion,
) {
  const crypto = yield* Crypto.Crypto;
  const id = yield* Effect.orDie(crypto.randomUUIDv4);
  const creada = yield* Clock.currentTimeMillis;
  return { ...contenido, id, creada } satisfies Aportacion;
});

/** Las aportaciones leídas que este código entiende. Las demás (de otra versión) se dejan estar. */
const entendidas = Effect.fn("AlmacenLocal.entendidas")(function* (filas: ReadonlyArray<unknown>) {
  const leidas = filas.flatMap((fila) => Option.toArray(leerAportacion(fila)));
  if (leidas.length < filas.length) {
    yield* Effect.logWarning(
      `${filas.length - leidas.length} aportaciones guardadas no tienen un formato conocido`,
    );
  }
  return leidas.sort((a, b) => a.creada - b.creada);
});

const fallo = (error: DOMException | null, porDefecto: string) =>
  new AlmacenNoDisponible({ motivo: error?.message ?? porDefecto });

/** Abre la base de datos, y la crea o la sube de versión si hace falta. */
const abrir = (fabrica: IDBFactory): Effect.Effect<IDBDatabase, AlmacenNoDisponible> =>
  Effect.callback<IDBDatabase, AlmacenNoDisponible>((reanudar) => {
    const peticion = fabrica.open(BASE, VERSION_BASE);
    peticion.addEventListener("upgradeneeded", () => {
      const base = peticion.result;
      if (!base.objectStoreNames.contains(APORTACIONES)) {
        base.createObjectStore(APORTACIONES, { keyPath: "id" }).createIndex(POR_TIPO, "tipo");
      }
    });
    peticion.addEventListener("success", () => reanudar(Effect.succeed(peticion.result)));
    peticion.addEventListener("error", () =>
      reanudar(Effect.fail(fallo(peticion.error, "No se ha podido abrir IndexedDB"))),
    );
    peticion.addEventListener("blocked", () =>
      reanudar(
        Effect.fail(fallo(null, "Otra pestaña de Celda tiene abierta una versión anterior")),
      ),
    );
  });

/**
 * Una transacción sobre las aportaciones. `hacer` pone las peticiones y devuelve cómo leer su
 * resultado cuando la transacción termina bien.
 */
const transaccion = <A>(
  base: IDBDatabase,
  modo: IDBTransactionMode,
  hacer: (almacen: IDBObjectStore) => () => A,
): Effect.Effect<A, AlmacenNoDisponible> =>
  Effect.callback<A, AlmacenNoDisponible>((reanudar) => {
    const tx = base.transaction(APORTACIONES, modo);
    const resultado = hacer(tx.objectStore(APORTACIONES));
    tx.addEventListener("complete", () => reanudar(Effect.sync(resultado)));
    tx.addEventListener("error", () =>
      reanudar(Effect.fail(fallo(tx.error, "IndexedDB ha rechazado la operación"))),
    );
    tx.addEventListener("abort", () =>
      reanudar(Effect.fail(fallo(tx.error, "IndexedDB ha cancelado la operación"))),
    );
  });

/** Borra las del tipo y, si hay una nueva, la pone, dentro de la transacción ya abierta. */
const reemplazar = (almacen: IDBObjectStore, tipo: TipoAportacion, nueva?: Aportacion) => {
  const claves = almacen.index(POR_TIPO).getAllKeys(tipo);
  claves.addEventListener("success", () => {
    for (const clave of claves.result) almacen.delete(clave);
    if (nueva !== undefined) almacen.put(nueva);
  });
};

/**
 * El almacén en IndexedDB, en la base `celda`. Recibe la fábrica para poder probarlo con una en
 * memoria; sin ella (un navegador sin IndexedDB) cada operación lo dice.
 */
export const almacenEnIndexedDb = (fabrica: IDBFactory | undefined): Layer.Layer<AlmacenLocal> =>
  Layer.effect(
    AlmacenLocal,
    Effect.gen(function* () {
      const base = yield* Effect.cached(
        fabrica === undefined
          ? Effect.fail(new AlmacenNoDisponible({ motivo: "Este navegador no tiene IndexedDB" }))
          : abrir(fabrica),
      );

      const leer = Effect.fn("AlmacenLocal.leer")(function* (tipo: TipoAportacion) {
        const abierta = yield* base;
        const filas = yield* transaccion(abierta, "readonly", (almacen) => {
          const peticion = almacen.index(POR_TIPO).getAll(tipo);
          return (): ReadonlyArray<unknown> => peticion.result;
        });
        return yield* entendidas(filas);
      });

      const sustituir = Effect.fn("AlmacenLocal.sustituir")(function* (nueva: Aportacion) {
        const abierta = yield* base;
        yield* transaccion(abierta, "readwrite", (almacen) => {
          reemplazar(almacen, nueva.tipo, nueva);
          return () => undefined;
        });
      });

      const borrar = Effect.fn("AlmacenLocal.borrar")(function* (tipo: TipoAportacion) {
        const abierta = yield* base;
        yield* transaccion(abierta, "readwrite", (almacen) => {
          reemplazar(almacen, tipo);
          return () => undefined;
        });
      });

      return AlmacenLocal.of({ leer, sustituir, borrar });
    }),
  );
