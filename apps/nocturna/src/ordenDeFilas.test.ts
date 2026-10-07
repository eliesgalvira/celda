// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { leerCapaDeProvincia, leerLoteDeProvincia, leerResumen } from "@celda/dominio/provincias";
import { archivar } from "@celda/ingesta/archivo";
import { INTERRUPTOR_POR_DEFECTO } from "@celda/ingesta/ejecucion";
import type { Registro } from "@celda/ingesta/extractor";
import { huellaDeFicha, ObservacionGuardada } from "@celda/ingesta/guardado";
import { datosDeHecho } from "@celda/ingesta/hecho";
import { conFilasRotadas } from "@celda/ingesta/pruebas/ficha";
import { leerMuestra, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import {
  bandasDeFilas,
  leerFicha,
  medidasDeFilas,
} from "@celda/ingesta/registro-oficial/normalizar";
import { decodificarLatin1 } from "@celda/ingesta/texto";
import { sha256DeBytes } from "@celda/publicacion/almacenes/firma";
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

import { archivoNocturno } from "./archivo.ts";
import { BaseNocturna, baseNocturna, ESQUEMA } from "./base.ts";
import { corregirOrdenDeFilas, huellaEnElOrdenDeLaPagina } from "./ordenDeFilas.ts";
import {
  comprobarHistorial,
  conEntorno,
  contenidoDe,
  type Entorno,
  unaNoche,
} from "./pruebas/entorno.ts";
import { fichasGrabadas, geoportal, latin1 } from "./pruebas/geoportal.ts";

/** El punto de partida, de antes de la relectura de toda España. */
const PARTIDA = Date.UTC(2026, 8, 30, 2, 15);
/** La noche que dejó el hecho falso, el 07/10/2026. */
const NOCHE = Date.UTC(2026, 9, 7, 15, 0);
const DIA = 86_400_000;

/** El registro al que el registro le dio las filas en otro orden. */
const FALSA = "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942";
/** El registro con un cambio de verdad en su ficha. */
const DE_VERDAD = "ORANGE ESPAGNE, S.A.U. - CATR0510J";

const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));
const decodificarObservacion = Schema.decodeEffect(Schema.fromJsonString(ObservacionGuardada));

const leida = (html: string) => {
  const ficha = leerFicha(html);
  if (Result.isFailure(ficha)) return assert.fail(ficha.failure);
  return { ...ficha.success, cruda: ficha.success.cruda ?? assert.fail("sin filas") };
};

/** Lo que guardaba una noche de antes de la versión 11 al leer una ficha: todo en su orden. */
const enElOrdenDeLaPagina = (html: string) => {
  const { cruda } = leida(html);
  return {
    bandas: Result.getOrThrow(bandasDeFilas(cruda.caracteristicas)),
    medidasDeExposicion: Result.getOrThrow(medidasDeFilas(cruda.niveles)),
  };
};

/** Las fichas de la prueba: la de antes, la misma con las filas en otro orden y una cambiada. */
const paginas = Effect.gen(function* () {
  const telefonica = decodificarLatin1(
    new Uint8Array(yield* leerMuestra("detalle-telefonica-0802878.iso-8859-1.html")),
  );
  const orange = decodificarLatin1(
    new Uint8Array(yield* leerMuestra("detalle-orange-CATR0228A.iso-8859-1.html")),
  );
  const rotada = conFilasRotadas(telefonica);
  const cambiada = orange.replace("0.98806", "0.5");
  assert.notStrictEqual(cambiada, orange);
  return {
    telefonica,
    rotada,
    orange,
    cambiada,
    huellaRotada: yield* sha256DeBytes(latin1(rotada)),
    huellaCambiada: yield* sha256DeBytes(latin1(cambiada)),
  };
});
type Paginas = Effect.Success<typeof paginas>;

const conLaBase = <A, E, R>(fichero: string, efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(SqliteClient.layer({ filename: fichero })));

/** Archiva en el archivo del entorno las fichas de la noche del hecho falso. */
const archivarPaginas = (entorno: Entorno, p: Paginas) =>
  Effect.gen(function* () {
    for (const [clave, html] of [
      [FALSA, p.rotada],
      [DE_VERDAD, p.cambiada],
    ] as const) {
      yield* archivar({
        tipo: "ficha",
        url: `https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?clave=${clave}`,
        clave,
        cuerpo: latin1(html),
        resultado: "leida",
      });
    }
  }).pipe(Effect.provide(archivoNocturno(entorno.archivo)));

/**
 * Una base como la dejó la noche del 07/10/2026 a las 15:00 en la versión 10: dos registros con su
 * punto de partida del 30/09, uno con un hecho de ficha con `cambia` porque el registro dio sus
 * filas en otro orden y otro con un cambio de verdad. Las dos observaciones guardan las bandas y
 * las medidas en el orden de su página y la huella que no miraba el orden.
 */
const sembrar = (entorno: Entorno, p: Paginas) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const registros = new Map(
      (yield* muestraCampusNord).listado.registros.map((r): [string, Registro] => [r.clave, r]),
    );
    const antes = new Map([
      [FALSA, enElOrdenDeLaPagina(p.telefonica)],
      [DE_VERDAD, enElOrdenDeLaPagina(p.orange)],
    ]);
    yield* fs.makeDirectory(path.dirname(entorno.base), { recursive: true });
    yield* conLaBase(
      entorno.base,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (const sentencia of ESQUEMA.slice(0, 7).flat()) yield* sql.unsafe(sentencia);
        yield* sql.unsafe("PRAGMA user_version = 7");
        for (const [clave, ficha] of antes) {
          const registro = registros.get(clave) ?? assert.fail(`${clave} no está en la muestra`);
          yield* sql`INSERT INTO observaciones ${sql.insert({
            fuente: "registro-oficial",
            clave,
            ficha_leida_en: PARTIDA,
            retirada_en: null,
            cuadro: "2,41",
            vista_en: PARTIDA,
            datos: yield* codificarObservacion({
              ...registro,
              ...ficha,
              fuente: "registro-oficial",
              afirma: "presente",
              fecha: PARTIDA,
              fichaLeidaEn: PARTIDA,
              ausencias: 0,
              retiradaEn: null,
            }),
          })}`;
        }
      }),
    );
    // La versión 8 escribe el punto de partida.
    yield* Effect.asVoid(BaseNocturna).pipe(
      Effect.provide(
        baseNocturna({ fichero: entorno.base, interruptores: INTERRUPTOR_POR_DEFECTO }),
      ),
    );
    // Lo que escribió la noche: un hecho de ficha con `cambia` en cada uno y la observación con
    // la fecha de esa noche.
    yield* conLaBase(
      entorno.base,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (const [clave, html, pagina] of [
          [FALSA, p.rotada, p.huellaRotada],
          [DE_VERDAD, p.cambiada, p.huellaCambiada],
        ] as const) {
          yield* sql`INSERT INTO hechos (fuente, clave, version, tipo, fecha, datos)
            VALUES ('registro-oficial', ${clave}, 2, 'ficha', ${NOCHE}, ${datosDeHecho({
              tipo: "ficha",
              ficha: { pagina },
              cambia: true,
              antes: PARTIDA,
            })})`;
          const [fila] = yield* sql<{ readonly datos: string }>`SELECT datos FROM observaciones
            WHERE clave = ${clave}`;
          const previa = yield* decodificarObservacion(
            fila?.datos ?? assert.fail("sin observación"),
          );
          yield* sql`UPDATE observaciones SET ficha_leida_en = ${NOCHE}, datos = ${yield* codificarObservacion(
            {
              ...previa,
              ...enElOrdenDeLaPagina(html),
              fecha: NOCHE,
              fichaLeidaEn: NOCHE,
              huellaDeFicha: huellaEnElOrdenDeLaPagina(leida(html).cruda),
            },
          )} WHERE clave = ${clave}`;
        }
        yield* sql.unsafe("PRAGMA user_version = 10");
      }),
    );
  });

/** Lo que importa de cada registro en la base. */
const estadoDe = (fichero: string) =>
  conLaBase(
    fichero,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [version] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
      const hechos = yield* sql<{
        readonly clave: string;
        readonly version: number;
        readonly tipo: string;
        readonly fecha: number;
        readonly cambia: number | null;
      }>`SELECT clave, version, tipo, fecha, json_extract(datos, '$.cambia') AS cambia
        FROM hechos ORDER BY clave, version`;
      const observaciones = yield* sql<{
        readonly clave: string;
        readonly fecha: number;
        readonly huella: string | null;
      }>`SELECT clave, json_extract(datos, '$.fecha') AS fecha,
          json_extract(datos, '$.huellaDeFicha') AS huella
        FROM observaciones ORDER BY clave`;
      return {
        version: version?.user_version,
        hechos: hechos.map((h) => [h.clave, h.version, h.tipo, h.fecha, h.cambia]),
        observaciones: observaciones.map((o) => [o.clave, o.fecha, o.huella]),
        todo: {
          hechos: yield* sql`SELECT * FROM hechos ORDER BY secuencia`,
          observaciones: yield* sql`SELECT * FROM observaciones ORDER BY id`,
        },
      };
    }),
  );

/** El historial publicado de un registro en la versión vigente del almacén, y su fecha. */
const publicado = (entorno: Entorno, clave: string) =>
  Effect.gen(function* () {
    const almacen = yield* contenidoDe(entorno.almacen);
    const vigente = Result.getOrThrow(decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? ""));
    const resumen = Result.getOrThrow(
      leerResumen(almacen.get(vigente.resumen ?? "") ?? "", vigente.version),
    );
    for (const provincia of resumen.provincias) {
      if (provincia.fichero === undefined) continue;
      const capa = Result.getOrThrow(
        leerCapaDeProvincia(almacen.get(provincia.fichero) ?? "", provincia.codigo),
      );
      for (const lote of capa.lotes) {
        const fichas = Result.getOrThrow(
          leerLoteDeProvincia(almacen.get(lote) ?? "", provincia.codigo),
        );
        const origen = fichas
          .flatMap((f) => f.estaciones)
          .flatMap((e) => e.origenes)
          .find((o) => o.clave === clave);
        if (origen !== undefined) return { fecha: origen.fecha, historial: origen.historial };
      }
    }
    return assert.fail(`${clave} no está publicado`);
  });

describe("versión 11 de la base: hechos de ficha que solo cambian el orden de las filas (ADR 0027)", () => {
  it.effect(
    "con el archivo, corrige el hecho falso, devuelve su fecha a la observación, deja el cambio de verdad y la noche siguiente lo publica",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const p = yield* paginas;
          yield* sembrar(entorno, p);
          yield* archivarPaginas(entorno, p);
          const antes = yield* estadoDe(entorno.base);
          assert.strictEqual(antes.version, 10);

          yield* Effect.asVoid(BaseNocturna).pipe(
            Effect.provide(
              baseNocturna({
                fichero: entorno.base,
                interruptores: INTERRUPTOR_POR_DEFECTO,
                archivo: entorno.archivo,
              }),
            ),
          );
          const despues = yield* estadoDe(entorno.base);
          assert.strictEqual(despues.version, ESQUEMA.length);
          assert.deepStrictEqual(despues.hechos, [
            [DE_VERDAD, 1, "conocido-antes", PARTIDA, null],
            [DE_VERDAD, 2, "ficha", NOCHE, 1],
            [FALSA, 1, "conocido-antes", PARTIDA, null],
            [FALSA, 2, "ficha", NOCHE, 0],
          ]);
          // Las dos huellas pasan a la que no mira el orden de las filas.
          assert.deepStrictEqual(despues.observaciones, [
            [DE_VERDAD, NOCHE, huellaDeFicha(leida(p.cambiada).cruda)],
            [FALSA, PARTIDA, huellaDeFicha(leida(p.telefonica).cruda)],
          ]);
          assert.deepStrictEqual(yield* comprobarHistorial(entorno), {
            comprobadas: 2,
            distintas: 0,
            primeras: [],
          });

          // Corregir otra vez no cambia nada.
          const otraVez = yield* conLaBase(
            entorno.base,
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              return yield* sql.withTransaction(corregirOrdenDeFilas(sql, entorno.archivo));
            }).pipe(Effect.scoped),
          );
          assert.deepStrictEqual(otraVez, {
            conArchivo: true,
            hechos: 0,
            fechas: 0,
            huellas: 0,
            sinComparar: [],
          });
          assert.deepStrictEqual((yield* estadoDe(entorno.base)).todo, despues.todo);

          // La noche siguiente relee las dos fichas, la una con las filas en otro orden otra
          // vez, y publica sin el cambio de ficha falso.
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make((codigo: string) => {
            switch (codigo) {
              case "0800942":
                return latin1(conFilasRotadas(p.telefonica, 2));
              case "CATR0510J":
                return latin1(p.cambiada);
              default:
                return grabadas.fichas(codigo);
            }
          });
          const registro = yield* geoportal(fichas);
          yield* TestClock.setTime(NOCHE + DIA);
          yield* unaNoche(entorno, yield* registro.extractor);
          const trasLaNoche = yield* estadoDe(entorno.base);
          assert.deepStrictEqual(
            trasLaNoche.hechos.filter(([clave, , tipo]) => clave === FALSA && tipo === "ficha"),
            [[FALSA, 2, "ficha", NOCHE, 0]],
          );
          assert.deepStrictEqual(yield* publicado(entorno, FALSA), {
            fecha: PARTIDA,
            historial: [{ tipo: "en-el-registro-antes", fecha: PARTIDA }],
          });
          assert.deepStrictEqual(yield* publicado(entorno, DE_VERDAD), {
            fecha: NOCHE,
            historial: [
              { tipo: "en-el-registro-antes", fecha: PARTIDA },
              { tipo: "cambio-de-ficha", fecha: NOCHE, antes: PARTIDA },
            ],
          });
          assert.strictEqual((yield* comprobarHistorial(entorno)).distintas, 0);
        }),
      ),
    60_000,
  );

  it.effect(
    "sin el archivo, corrige con lo que guarda la base, no crea el archivo y deja las huellas",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const p = yield* paginas;
          yield* sembrar(entorno, p);
          const antes = yield* estadoDe(entorno.base);
          yield* Effect.asVoid(BaseNocturna).pipe(
            Effect.provide(
              baseNocturna({
                fichero: entorno.base,
                interruptores: INTERRUPTOR_POR_DEFECTO,
                archivo: entorno.archivo,
              }),
            ),
          );
          assert.isFalse(yield* fs.exists(entorno.archivo));
          const despues = yield* estadoDe(entorno.base);
          assert.deepStrictEqual(despues.hechos, [
            [DE_VERDAD, 1, "conocido-antes", PARTIDA, null],
            [DE_VERDAD, 2, "ficha", NOCHE, 1],
            [FALSA, 1, "conocido-antes", PARTIDA, null],
            [FALSA, 2, "ficha", NOCHE, 0],
          ]);
          // Las huellas se quedan como estaban: la siguiente lectura de cada ficha deja un hecho
          // sin cambio.
          assert.deepStrictEqual(despues.observaciones, [
            [DE_VERDAD, NOCHE, antes.observaciones[0]?.[2]],
            [FALSA, PARTIDA, antes.observaciones[1]?.[2]],
          ]);
          // Con el archivo de vuelta, el historial da lo de la tabla.
          yield* archivarPaginas(entorno, p);
          assert.strictEqual((yield* comprobarHistorial(entorno)).distintas, 0);
        }),
      ),
    60_000,
  );
});
