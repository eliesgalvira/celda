// Cada prueba monta su almacén sobre una IndexedDB en memoria nueva.
// @effect-diagnostics strictEffectProvide:off
import type { Aportacion, ContenidoAportacion } from "@celda/dominio/aportacion";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import { IDBFactory } from "fake-indexeddb";

import { criptoDePrueba } from "../lib/cripto.ts";
import { AlmacenLocal, almacenEnIndexedDb } from "./almacen.ts";

const EN_EL_MAPA: ContenidoAportacion = {
  tipo: "punto-elegido",
  esquema: 1,
  origen: "mapa",
  posicion: { longitud: 2.1128, latitud: 41.3903 },
};
const BUSCADO: ContenidoAportacion = {
  ...EN_EL_MAPA,
  origen: "busqueda",
  posicion: { longitud: 2.1744, latitud: 41.4036 },
};

const MEDIODIA = Date.UTC(2026, 8, 26, 12);

/** El almacén real sobre la fábrica dada, que hace de IndexedDB del navegador. */
const almacen = (fabrica: IDBFactory | undefined) =>
  almacenEnIndexedDb(fabrica).pipe(Layer.provide(criptoDePrueba));

/** Una aportación con un número de esquema cualquiera. */
type FilaDeOtraVersion = Omit<Aportacion, "esquema"> & { readonly esquema: number };

/** Escribe una fila tal cual, sin pasar por el almacén: como la dejaría otra versión de Celda. */
const escribirFila = (fabrica: IDBFactory, fila: FilaDeOtraVersion) =>
  Effect.callback<void>((reanudar) => {
    const apertura = fabrica.open("celda");
    apertura.addEventListener("success", () => {
      const tx = apertura.result.transaction("aportaciones", "readwrite");
      tx.objectStore("aportaciones").put(fila);
      tx.addEventListener("complete", () => {
        apertura.result.close();
        reanudar(Effect.void);
      });
    });
  });

describe("AlmacenLocal en IndexedDB", () => {
  it.effect("guarda el punto elegido con identificador, fecha, versión del esquema y origen", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(MEDIODIA);
      const aportaciones = yield* AlmacenLocal;
      const guardada = yield* aportaciones.sustituir(BUSCADO);
      assert.deepStrictEqual(guardada, {
        ...BUSCADO,
        id: "00000001-0000-4000-8000-000000000000",
        creada: MEDIODIA,
      });
      assert.deepStrictEqual(yield* aportaciones.leer("punto-elegido"), [guardada]);
    }).pipe(Effect.provide(almacen(new IDBFactory()))),
  );

  it.effect("elegir otro punto sustituye al anterior", () =>
    Effect.gen(function* () {
      const aportaciones = yield* AlmacenLocal;
      yield* aportaciones.sustituir(EN_EL_MAPA);
      const segundo = yield* aportaciones.sustituir(BUSCADO);
      assert.deepStrictEqual(yield* aportaciones.leer("punto-elegido"), [segundo]);
    }).pipe(Effect.provide(almacen(new IDBFactory()))),
  );

  it.effect("quitar el punto lo borra del dispositivo", () =>
    Effect.gen(function* () {
      const aportaciones = yield* AlmacenLocal;
      yield* aportaciones.sustituir(EN_EL_MAPA);
      yield* aportaciones.borrar("punto-elegido");
      assert.deepStrictEqual(yield* aportaciones.leer("punto-elegido"), []);
    }).pipe(Effect.provide(almacen(new IDBFactory()))),
  );

  it.effect("lo guardado sigue ahí al volver a abrir Celda", () =>
    Effect.gen(function* () {
      const fabrica = new IDBFactory();
      const guardada = yield* Effect.flatMap(AlmacenLocal, (a) => a.sustituir(EN_EL_MAPA)).pipe(
        Effect.provide(almacen(fabrica)),
      );
      const leidas = yield* Effect.flatMap(AlmacenLocal, (a) => a.leer("punto-elegido")).pipe(
        Effect.provide(almacen(fabrica)),
      );
      assert.deepStrictEqual(leidas, [guardada]);
    }),
  );

  it.effect("una fila con un formato que no conoce se deja estar, sin romper la lectura", () =>
    Effect.gen(function* () {
      const fabrica = new IDBFactory();
      const buena = yield* Effect.flatMap(AlmacenLocal, (a) => a.sustituir(EN_EL_MAPA)).pipe(
        Effect.provide(almacen(fabrica)),
      );
      yield* escribirFila(fabrica, {
        ...EN_EL_MAPA,
        id: "0f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
        creada: MEDIODIA,
        esquema: 2,
      });
      const leidas = yield* Effect.flatMap(AlmacenLocal, (a) => a.leer("punto-elegido")).pipe(
        Effect.provide(almacen(fabrica)),
      );
      assert.deepStrictEqual(leidas, [buena]);
    }),
  );

  it.effect("sin IndexedDB, cada operación dice que el dispositivo no deja guardar", () =>
    Effect.gen(function* () {
      const aportaciones = yield* AlmacenLocal;
      const error = yield* Effect.flip(aportaciones.sustituir(EN_EL_MAPA));
      assert.strictEqual(error._tag, "AlmacenNoDisponible");
      assert.match(error.motivo, /IndexedDB/u);
      yield* Effect.flip(aportaciones.leer("punto-elegido"));
    }).pipe(Effect.provide(almacen(undefined))),
  );
});
