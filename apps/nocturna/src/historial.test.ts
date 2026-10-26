// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { desdeDelOrigen, type Ficha } from "@celda/dominio/ficha";
import { leerCapaDeProvincia, leerLoteDeProvincia, leerResumen } from "@celda/dominio/provincias";
import { ObservacionGuardada } from "@celda/ingesta/guardado";
import { muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BaseNocturna, ESQUEMA } from "./base.ts";
import {
  comprobarHistorial,
  conBase,
  conEntorno,
  contenidoDe,
  type Entorno,
  unaNoche,
} from "./pruebas/entorno.ts";
import { type ElementoDelListado, fichasGrabadas, geoportal } from "./pruebas/geoportal.ts";

const NOCHE = Date.UTC(2026, 9, 7, 2, 15);
const DIA = 86_400_000;

const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));

/** Los hechos de la base, en orden, sin lo que guarda cada uno. */
const hechosDe = (fichero: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql<{
      readonly secuencia: number;
      readonly clave: string;
      readonly version: number;
      readonly tipo: string;
      readonly fecha: number;
      readonly cambia: number | null;
      readonly antes: number | null;
      readonly pagina: string | null;
    }>`SELECT secuencia, clave, version, tipo, fecha,
        json_extract(datos, '$.cambia') AS cambia, json_extract(datos, '$.antes') AS antes,
        json_extract(datos, '$.ficha.pagina') AS pagina
      FROM hechos ORDER BY secuencia`;
  }).pipe(Effect.provide(SqliteClient.layer({ filename: fichero })));

/** Repite el historial de la base y lo compara con la tabla de observaciones. */
const comprobar = (entorno: Entorno) => comprobarHistorial(entorno);

/** Las fichas de la versión vigente del almacén, como las leería la web. */
const fichasPublicadas = (entorno: Entorno) =>
  Effect.gen(function* () {
    const almacen = yield* contenidoDe(entorno.almacen);
    const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
    if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
    const resumen = leerResumen(
      almacen.get(vigente.success.resumen) ?? "",
      vigente.success.version,
    );
    if (Result.isFailure(resumen)) return assert.fail(resumen.failure.message);
    const fichas: Array<Ficha> = [];
    for (const provincia of resumen.success.provincias) {
      if (provincia.fichero === undefined) continue;
      const capa = leerCapaDeProvincia(almacen.get(provincia.fichero) ?? "", provincia.codigo);
      if (Result.isFailure(capa)) return assert.fail(capa.failure.message);
      for (const lote of capa.success.lotes) {
        const leidas = leerLoteDeProvincia(almacen.get(lote) ?? "", provincia.codigo);
        if (Result.isFailure(leidas)) return assert.fail(leidas.failure.message);
        fichas.push(...leidas.success);
      }
    }
    return fichas;
  });

/** El origen publicado de un registro, con su historial. */
const origenPublicado = (fichas: ReadonlyArray<Ficha>, clave: string) =>
  fichas
    .flatMap((f) => f.estaciones)
    .flatMap((e) => e.origenes)
    .find((o) => o.clave === clave);

const CAMBIA_DE_FICHA = "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942";
const CAMBIA_DE_DIRECCION = "ORANGE ESPAGNE, S.A.U. - CATR0510J";
const DESAPARECE = "VODAFONE ESPAÑA, S.A.U. - 054846";

describe("historial de cada registro (ADR 0027)", () => {
  it.effect(
    "una base de la versión 7 se pone al día con un hecho «conocido antes» por observación, con su fecha",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const registros = (yield* muestraCampusNord).listado.registros.slice(0, 3);
          const [leida, retirada, vista] = registros;
          yield* fs.makeDirectory(path.dirname(entorno.base), { recursive: true });
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            for (const sentencia of ESQUEMA.slice(0, 7).flat()) yield* sql.unsafe(sentencia);
            yield* sql.unsafe("PRAGMA user_version = 7");
            const fechas = new Map([
              // La fecha de la observación es de cuando cambió su ficha, después de leerse.
              [leida?.clave, { fecha: NOCHE - DIA, ficha: NOCHE - 9 * DIA, vista: NOCHE - DIA }],
              [retirada?.clave, { fecha: NOCHE - 5 * DIA, ficha: null, vista: NOCHE - 4 * DIA }],
              [vista?.clave, { fecha: NOCHE - 2 * DIA, ficha: null, vista: NOCHE - 2 * DIA }],
            ]);
            for (const r of registros) {
              const { crudo: _crudo, ...deAntes } = r;
              const f = fechas.get(r.clave);
              const retiradaEn = r === retirada ? NOCHE - DIA : null;
              yield* sql`INSERT INTO observaciones ${sql.insert({
                fuente: "registro-oficial",
                clave: r.clave,
                ficha_leida_en: f?.ficha ?? null,
                retirada_en: retiradaEn,
                cuadro: "2,41",
                vista_en: f?.vista ?? null,
                datos: yield* codificarObservacion({
                  ...deAntes,
                  fuente: "registro-oficial",
                  afirma: "presente",
                  bandas: [],
                  fecha: f?.fecha ?? NOCHE,
                  fichaLeidaEn: f?.ficha ?? null,
                  ausencias: retiradaEn === null ? 0 : 2,
                  retiradaEn,
                }),
              })}`;
            }
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

          // Se abre dos veces: la segunda no repite nada.
          yield* conBase(entorno.base, Effect.asVoid(BaseNocturna));
          yield* conBase(entorno.base, Effect.asVoid(BaseNocturna));
          const hechos = yield* hechosDe(entorno.base);
          assert.deepStrictEqual(
            hechos.map((h) => [h.clave, h.version, h.tipo, h.fecha]),
            [
              // La fecha de la observación, desde la que dice lo que dice, aunque su ficha se leyera
              // antes: lo de antes de esa fecha pudo ser otra cosa.
              [leida?.clave, 1, "conocido-antes", NOCHE - DIA],
              [retirada?.clave, 1, "conocido-antes", NOCHE - 5 * DIA],
              [vista?.clave, 1, "conocido-antes", NOCHE - 2 * DIA],
            ],
          );
          // Un hecho repetido con la misma fecha y el mismo tipo no se escribe dos veces.
          const repetido = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* Effect.flip(
              sql`INSERT INTO hechos (fuente, clave, version, tipo, fecha, datos)
                VALUES ('registro-oficial', ${leida?.clave ?? ""}, 2, 'conocido-antes',
                  ${NOCHE - DIA}, '{}')`,
            );
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          assert.strictEqual(repetido._tag, "SqlError");
          assert.lengthOf(
            (yield* hechosDe(entorno.base)).filter((h) => h.clave === leida?.clave),
            1,
          );
          assert.deepStrictEqual(yield* comprobar(entorno), {
            comprobadas: 3,
            distintas: 0,
            primeras: [],
          });
        }),
      ),
  );

  it.effect(
    "cada noche apunta lo que cambia en el registro, lo publica en la ficha y repetirlo da lo mismo que la tabla",
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
          yield* unaNoche(entorno, yield* registro.extractor);

          // La primera noche es la primera vez que se pide el cuadro: todo son altas sin cota, que
          // la web dice «en el registro antes del…».
          const primera = yield* hechosDe(entorno.base);
          assert.lengthOf(
            primera.filter((h) => h.tipo === "alta"),
            40,
          );
          assert.isTrue(primera.filter((h) => h.tipo === "alta").every((h) => h.antes === null));
          const leidaPrimera = primera.find(
            (h) => h.clave === CAMBIA_DE_FICHA && h.tipo === "ficha",
          );
          // La ficha cita su página del archivo por su SHA-256.
          assert.match(leidaPrimera?.pagina ?? "", /^[0-9a-f]{64}$/u);
          const publicadas = yield* fichasPublicadas(entorno);
          const deAlta = origenPublicado(publicadas, CAMBIA_DE_FICHA);
          // En una base nueva ningún titular se ha visto antes: lo que trae es lo que ya había.
          assert.deepStrictEqual(deAlta?.historial, [
            { tipo: "en-el-registro-antes", fecha: NOCHE },
          ]);
          assert.deepStrictEqual(desdeDelOrigen(deAlta ?? { fecha: 0, historial: [] }), {
            tipo: "antes-del",
            fecha: NOCHE,
          });

          // A los 31 días: otra ficha para una, otra dirección para otra y una que ya no sale.
          yield* Ref.set(fichas, (codigo) =>
            codigo === "0800942" ? grabadas.orange : grabadas.fichas(codigo),
          );
          yield* Ref.set(listado, (elementos) =>
            elementos
              .filter((e) => e.id !== DESAPARECE)
              .map((e) =>
                e.id === CAMBIA_DE_DIRECCION
                  ? {
                      ...e,
                      properties: {
                        Gis_ID: "CATR0510J",
                        Dirección: "CL DIAGONAL, 1. BARCELONA, BARCELONA",
                      },
                    }
                  : e,
              ),
          );
          for (const noche of [31, 32, 33]) {
            yield* TestClock.setTime(NOCHE + noche * DIA);
            yield* unaNoche(entorno, yield* registro.extractor);
          }
          const hechos = yield* hechosDe(entorno.base);
          const de = (clave: string) =>
            hechos
              .filter((h) => h.clave === clave)
              .map((h) => [h.version, h.tipo, h.fecha, h.cambia, h.antes]);
          assert.deepStrictEqual(de(CAMBIA_DE_FICHA), [
            [1, "alta", NOCHE, null, null],
            [2, "ficha", NOCHE, 0, null],
            [3, "ficha", NOCHE + 31 * DIA, 1, NOCHE],
          ]);
          // Su ficha se vuelve a leer esa misma noche, pero dice lo mismo: no es otro hecho.
          assert.deepStrictEqual(de(CAMBIA_DE_DIRECCION).slice(2), [
            [3, "listado", NOCHE + 31 * DIA, 1, NOCHE],
          ]);
          // Retirada tras dos barridos sin verla, con la última vez que se vio.
          assert.deepStrictEqual(de(DESAPARECE).at(-1), [
            3,
            "retirada",
            NOCHE + 32 * DIA,
            null,
            NOCHE,
          ]);

          const publicadasDespues = yield* fichasPublicadas(entorno);
          const cambiada = origenPublicado(publicadasDespues, CAMBIA_DE_FICHA);
          assert.deepStrictEqual(cambiada?.historial, [
            { tipo: "en-el-registro-antes", fecha: NOCHE },
            { tipo: "cambio-de-ficha", fecha: NOCHE + 31 * DIA, antes: NOCHE },
          ]);
          assert.deepStrictEqual(desdeDelOrigen(cambiada ?? { fecha: 0, historial: [] }), {
            tipo: "desde",
            fecha: NOCHE + 31 * DIA,
            antes: NOCHE,
          });
          assert.strictEqual(cambiada?.fecha, NOCHE + 31 * DIA);
          assert.isUndefined(origenPublicado(publicadasDespues, DESAPARECE));

          assert.deepStrictEqual(yield* comprobar(entorno), {
            comprobadas: 40,
            distintas: 0,
            primeras: [],
          });

          // Repetir una noche con la misma fecha no escribe ningún hecho dos veces.
          const antes = (yield* hechosDe(entorno.base)).length;
          yield* unaNoche(entorno, yield* registro.extractor);
          assert.strictEqual((yield* hechosDe(entorno.base)).length, antes);
        }),
      ),
    30_000,
  );

  it.effect(
    "un cambio de la limpieza no es un hecho ni mueve fechas, y llega a lo publicado en la fusión siguiente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const registro = yield* geoportal(fichas);
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, yield* registro.extractor);
          // Lo que habría dejado una limpieza anterior: otra dirección guardada para el mismo crudo.
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE observaciones
              SET datos = json_set(datos, '$.direccion', 'VP Eusebi Guell 6')
              WHERE clave = ${CAMBIA_DE_FICHA}`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          const antes = (yield* hechosDe(entorno.base)).length;
          yield* TestClock.setTime(NOCHE + DIA);
          const hecha = yield* unaNoche(entorno, yield* registro.extractor);
          // Solo la ficha sin ficha en el registro, que se vuelve a pedir al día siguiente.
          assert.strictEqual((yield* hechosDe(entorno.base)).length, antes + 1);
          assert.deepStrictEqual(
            hecha.ejecuciones.map((e) => e.estado),
            ["completada"],
          );
          const publicada = (yield* fichasPublicadas(entorno)).find((f) =>
            f.estaciones.some((e) => e.origenes.some((o) => o.clave === CAMBIA_DE_FICHA)),
          );
          assert.strictEqual(publicada?.direccion, "VP Eusebi Güell, 6. BARCELONA, BARCELONA");
          assert.strictEqual(
            origenPublicado([publicada ?? assert.fail("")], CAMBIA_DE_FICHA)?.fecha,
            NOCHE,
          );
          assert.strictEqual((yield* comprobar(entorno)).distintas, 0);
        }),
      ),
  );

  it.effect(
    "el alta de un titular que Celda empieza a reconocer, o de uno que ya salía como de otro titular, estaba en el registro antes",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const listado = yield* Ref.make(
            (elementos: ReadonlyArray<ElementoDelListado>): ReadonlyArray<ElementoDelListado> =>
              elementos,
          );
          const registro = yield* geoportal(fichas, listado);
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, yield* registro.extractor);
          // Una que salía como de otro titular antes de que Celda reconociera el suyo.
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO otros_titulares ${sql.insert({
              clave: "VODAFONE ESPAÑA, S.A.U. - 999",
              titular: "VODAFONE ESPAÑA, S.A.U.",
              local: 0,
              crudo: "{}",
              visto_desde: NOCHE - 5 * DIA,
              vista_en: NOCHE,
            })}`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          const elemento = (id: string, codigo: string): ElementoDelListado => ({
            type: "Feature",
            id,
            geometry: { type: "Point", coordinates: [2.1151, 41.3871] },
            properties: { Gis_ID: codigo, Dirección: "CL Jordi Girona, 31. BARCELONA, BARCELONA" },
          });
          yield* Ref.set(listado, (elementos) => [
            ...elementos,
            elemento("RETEVISION MOVIL SA - 300123", "300123"),
            elemento("VODAFONE ESPAÑA, S.A.U. - 999", "999"),
            elemento("TELEFONICA MOVILES ESPAÑA, S.A.U. - 0809999", "0809999"),
          ]);
          yield* TestClock.setTime(NOCHE + DIA);
          yield* unaNoche(entorno, yield* registro.extractor);
          const publicadas = yield* fichasPublicadas(entorno);
          const historial = (clave: string) => origenPublicado(publicadas, clave)?.historial;
          assert.deepStrictEqual(historial("RETEVISION MOVIL SA - 300123"), [
            { tipo: "en-el-registro-antes", fecha: NOCHE + DIA },
          ]);
          assert.deepStrictEqual(historial("VODAFONE ESPAÑA, S.A.U. - 999"), [
            { tipo: "en-el-registro-antes", fecha: NOCHE - 5 * DIA },
          ]);
          // Una estación base nueva de un titular de siempre es un alta, desde esta noche.
          assert.deepStrictEqual(historial("TELEFONICA MOVILES ESPAÑA, S.A.U. - 0809999"), [
            { tipo: "alta", fecha: NOCHE + DIA, antes: NOCHE },
          ]);
        }),
      ),
  );
});
