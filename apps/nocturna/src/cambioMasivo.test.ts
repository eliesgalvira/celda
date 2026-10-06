// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { zonaDeBarrido } from "@celda/dominio/barrido";
import { BaseDeBarrido, esCambioMasivo, type OpcionesBarrido } from "@celda/ingesta/barrido";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  CATALUNA_CADA_NOCHE,
  conBase,
  conEntorno,
  contenidoDe,
  type Entorno,
  unaNoche,
} from "./pruebas/entorno.ts";
import { type ElementoDelListado, fichasGrabadas, geoportal } from "./pruebas/geoportal.ts";

const NOCHE = Date.UTC(2026, 9, 7, 2, 15);
const DIA = 86_400_000;

/** La muestra del Campus Nord son 40 registros: el límite de las pruebas es de 5 y un 20 %. */
const CON_LIMITE: OpcionesBarrido = {
  ...CATALUNA_CADA_NOCHE,
  cambioMasivo: { fraccion: 0.2, minimo: 5 },
};

/** Lo que importa de la base para ver que una noche parada no ha tocado nada. */
const estadoDe = (entorno: Entorno) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      observaciones: yield* sql`SELECT clave, retirada_en, datos FROM observaciones
        ORDER BY clave`,
      ausencias: yield* sql`SELECT sum(json_extract(datos, '$.ausencias')) AS n
        FROM observaciones`,
      hechos: yield* sql`SELECT count(*) AS n FROM hechos`,
      emplazamientos: yield* sql`SELECT clave, version FROM emplazamientos ORDER BY clave`,
    };
  }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

describe("cambio masivo en el registro (ADR 0027)", () => {
  it("solo pasa del límite con más del mínimo y más de la parte de las vigentes", () => {
    const limite = { fraccion: 0.2, minimo: 50 };
    assert.isFalse(esCambioMasivo(50, 100, limite));
    assert.isTrue(esCambioMasivo(51, 100, limite));
    assert.isFalse(esCambioMasivo(200, 1000, limite));
    assert.isTrue(esCambioMasivo(201, 1000, limite));
    // Un cuadro que se pide por primera vez no tiene nada que comparar.
    assert.isFalse(esCambioMasivo(1000, 0, limite));
  });

  it.effect(
    "si el registro deja de escribir la razón social de Orange, la noche se para sin guardar, retirar ni publicar nada",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const listado = yield* Ref.make(
            (elementos: ReadonlyArray<ElementoDelListado>) => elementos,
          );
          const registro = yield* geoportal(fichas, listado);
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, yield* registro.extractor, { proceso: CON_LIMITE });
          const antes = yield* estadoDe(entorno);
          const publicadoAntes = yield* contenidoDe(entorno.almacen);

          // «ORANGE ESPAGNE» pasa a «ORANGE ESPANA TELECOM»: Celda no reconoce el titular y las
          // diez de Orange desaparecen del listado.
          yield* Ref.set(listado, (elementos) =>
            elementos.map((e) =>
              e.id.startsWith("ORANGE ESPAGNE")
                ? { ...e, id: e.id.replace("ORANGE ESPAGNE", "MASORANGE TELECOM") }
                : e,
            ),
          );
          for (const noche of [1, 2]) {
            yield* TestClock.setTime(NOCHE + noche * DIA);
            const parada = yield* unaNoche(entorno, yield* registro.extractor, {
              proceso: CON_LIMITE,
            });
            assert.deepStrictEqual(
              parada.ejecuciones.map((e) => [e.estado, e.detenida !== undefined]),
              [["fallida", true]],
            );
            assert.strictEqual(parada.publicacion.tipo, "detenida");
            assert.include(
              parada.publicacion.tipo === "detenida" ? parada.publicacion.motivo : "",
              "10 registros de titulares desconocidos",
            );
          }
          // Nada ha cambiado: ni una ausencia, ni un hecho, ni un emplazamiento, ni lo publicado.
          assert.deepStrictEqual(yield* estadoDe(entorno), antes);
          assert.deepStrictEqual(yield* contenidoDe(entorno.almacen), publicadoAntes);

          // Con el límite subido una noche, porque el cambio es de verdad, la noche sigue.
          yield* TestClock.setTime(NOCHE + 3 * DIA);
          const aceptada = yield* unaNoche(entorno, yield* registro.extractor, {
            proceso: { ...CON_LIMITE, cambioMasivo: { fraccion: 1, minimo: 5 } },
          });
          assert.deepStrictEqual(
            aceptada.ejecuciones.map((e) => [e.estado, e.detenida]),
            [["completada", undefined]],
          );
          assert.notStrictEqual(aceptada.publicacion.tipo, "detenida");
        }),
      ),
  );

  it.effect("cerrar un barrido al que le falta más de lo normal no cuenta ninguna ausencia", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabadas = yield* fichasGrabadas;
        const registro = yield* geoportal(yield* Ref.make(grabadas.fichas));
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, yield* registro.extractor, { proceso: CON_LIMITE });
        const antes = yield* estadoDe(entorno);
        const cataluna = zonaDeBarrido("cataluna");
        if (cataluna === undefined) return assert.fail("sin Cataluña");
        // Un barrido que no ha visto ningún cuadro: le faltan las 40.
        const fallo = yield* conBase(
          entorno.base,
          Effect.gen(function* () {
            const base = yield* BaseDeBarrido;
            const abierto = yield* base.abrirBarrido(
              "1",
              "registro-oficial",
              cataluna,
              NOCHE + DIA,
            );
            return yield* Effect.flip(
              base.cerrarBarrido(abierto.barrido, NOCHE + DIA, NOCHE + DIA, {
                fraccion: 0.2,
                minimo: 5,
              }),
            );
          }),
        );
        assert.strictEqual(
          fallo.message,
          "zona cataluna: 40 cambios de 40 observaciones vigentes, muchos más de lo normal",
        );
        assert.deepStrictEqual(yield* estadoDe(entorno), antes);
      }),
    ),
  );
});
