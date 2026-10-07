// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { zonaDeBarrido } from "@celda/dominio/barrido";
import {
  BaseDeBarrido,
  CambioMasivo,
  esCambioMasivo,
  type OpcionesBarrido,
} from "@celda/ingesta/barrido";
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
import { comprobarNoche, type Noche } from "./programa.ts";

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
          let parada1: Noche | undefined;
          for (const noche of [1, 2]) {
            yield* TestClock.setTime(NOCHE + noche * DIA);
            const parada = yield* unaNoche(entorno, yield* registro.extractor, {
              proceso: CON_LIMITE,
            });
            parada1 ??= parada;
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

          // Basta con esa noche: con el límite de siempre, la siguiente no vuelve a contar las que
          // ya faltaban, y las retira.
          yield* TestClock.setTime(NOCHE + 4 * DIA);
          const siguiente = yield* unaNoche(entorno, yield* registro.extractor, {
            proceso: CON_LIMITE,
          });
          assert.deepStrictEqual(
            siguiente.ejecuciones.map((e) => [e.estado, e.detenida]),
            [["completada", undefined]],
          );
          const retiradas = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM observaciones
              WHERE clave LIKE 'ORANGE ESPAGNE%' AND retirada_en IS NOT NULL`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          assert.strictEqual(retiradas[0]?.n, 10);
          yield* comprobarNoche(siguiente);
          if (parada1 === undefined) return assert.fail("sin noche parada");
          const fallo = yield* Effect.flip(comprobarNoche(parada1));
          assert.strictEqual(fallo._tag, "NocheDetenida");
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

  it.effect(
    "si una razón social se escribe de otra forma, salta aunque sea una parte pequeña del cuadro",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const listado = yield* Ref.make(
            (elementos: ReadonlyArray<ElementoDelListado>) => elementos,
          );
          const registro = yield* geoportal(yield* Ref.make(grabadas.fichas), listado);
          // La mitad del cuadro: los 15 registros de «VODAFONE ESPAÑA, S.A.U.» son menos.
          const limite = { ...CATALUNA_CADA_NOCHE, cambioMasivo: { fraccion: 0.5, minimo: 5 } };
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, yield* registro.extractor, { proceso: limite });
          // El registro pasa a escribirlos todos con «S.A.»: sus claves cambian todas.
          yield* Ref.set(listado, (elementos) =>
            elementos.map((e) =>
              e.id.startsWith("VODAFONE ESPAÑA, S.A.U.")
                ? { ...e, id: e.id.replace("S.A.U.", "S.A.") }
                : e,
            ),
          );
          yield* TestClock.setTime(NOCHE + DIA);
          const parada = yield* unaNoche(entorno, yield* registro.extractor, { proceso: limite });
          assert.strictEqual(parada.publicacion.tipo, "detenida");
          assert.include(
            parada.publicacion.tipo === "detenida" ? parada.publicacion.motivo : "",
            "de VODAFONE ESPAÑA, S.A.U.",
          );
        }),
      ),
  );

  it.effect(
    "si salta al cerrar una zona, su barrido falla y la noche siguiente vuelve a pedir sus cuadros",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const registro = yield* geoportal(yield* Ref.make(grabadas.fichas));
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, yield* registro.extractor, { proceso: CON_LIMITE });
          // Una noche en la que salta al cerrar la zona.
          yield* TestClock.setTime(NOCHE + DIA);
          const parada = yield* unaNoche(entorno, yield* registro.extractor, {
            proceso: CON_LIMITE,
            envolverBase: (base) => ({
              ...base,
              cerrarBarrido: () =>
                Effect.fail(
                  new CambioMasivo({
                    donde: "zona cataluna",
                    cambios: 30,
                    vigentes: 40,
                    desconocidos: 0,
                  }),
                ),
            }),
          });
          assert.strictEqual(parada.publicacion.tipo, "detenida");
          const estados = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ readonly estado: string }>`SELECT estado FROM barridos
              ORDER BY id`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          assert.deepStrictEqual(
            estados.map((e) => e.estado),
            ["completado", "fallido"],
          );
          // La siguiente empieza otro barrido, pide los cuadros y lee las fichas.
          const antes = (yield* Ref.get(registro.peticiones)).length;
          yield* TestClock.setTime(NOCHE + 2 * DIA);
          const siguiente = yield* unaNoche(entorno, yield* registro.extractor, {
            proceso: CON_LIMITE,
          });
          const pedidas = (yield* Ref.get(registro.peticiones)).slice(antes);
          assert.isAbove(pedidas.filter((p) => p.ruta.includes("infoantenasGeoJSON")).length, 0);
          assert.deepStrictEqual(
            siguiente.ejecuciones.map((e) => [e.estado, e.detenida]),
            [["completada", undefined]],
          );
        }),
      ),
  );
});
