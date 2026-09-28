// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import { ficheroDeManifiesto } from "@celda/dominio/provincias";
import { OPCIONES_BARRIDO } from "@celda/ingesta/barrido";
import {
  ExtractorPorCajas,
  FuenteBloqueada,
  type Registro,
  RespuestaInesperada,
} from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS, type OpcionesFichas } from "@celda/ingesta/fichas";
import { ObservacionGuardada, PuntoGuardado } from "@celda/ingesta/guardado";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";

import { BaseNocturna, ESQUEMA } from "./base.ts";
import { conBase, conEntorno, type Entorno, unaNoche } from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));
const codificarPunto = Schema.encodeEffect(Schema.fromJsonString(PuntoGuardado));

/** Las opciones de la noche con otras de fichas. */
const conFichas = (fichas: Partial<OpcionesFichas>) => ({
  proceso: { ...OPCIONES_BARRIDO, fichas: { ...OPCIONES_FICHAS, ...fichas } },
});

/**
 * El registro grabado, con cada ficha tardando `tarda.cuanto` en llegar, como el geoportal a su
 * ritmo, y con la hora a la que llega en `tarda.hasta` mientras tanto. Apunta qué fichas se
 * piden, y `falla` decide qué contestar en lugar de la ficha grabada.
 */
const conFichasApuntadas = (
  grabada: FuenteGrabada,
  pedidas: Ref.Ref<ReadonlyArray<string>>,
  opciones: {
    readonly tarda?: {
      readonly cuanto: Duration.Duration;
      readonly hasta: Ref.Ref<number | undefined>;
    };
    readonly falla?: (
      registro: Registro,
      vez: number,
    ) => FuenteBloqueada | RespuestaInesperada | undefined;
  } = {},
) =>
  Layer.effect(
    ExtractorPorCajas,
    Effect.map(ExtractorPorCajas, (real) =>
      ExtractorPorCajas.of({
        ...real,
        ficha: (registro) =>
          Effect.gen(function* () {
            const antes = yield* Ref.getAndUpdate(pedidas, (p) => [...p, registro.clave]);
            const { tarda } = opciones;
            if (tarda !== undefined) {
              // Espera hasta una hora fija, aunque el reloj se adelante antes de dormirse.
              const hasta = (yield* Clock.currentTimeMillis) + Duration.toMillis(tarda.cuanto);
              yield* Ref.set(tarda.hasta, hasta);
              for (let ahora = yield* Clock.currentTimeMillis; ahora < hasta;) {
                yield* Effect.sleep(Duration.millis(hasta - ahora));
                ahora = yield* Clock.currentTimeMillis;
              }
              yield* Ref.set(tarda.hasta, undefined);
            }
            const fallo = opciones.falla?.(registro, antes.length + 1);
            if (fallo !== undefined) return yield* fallo;
            return yield* real.ficha(registro);
          }),
      }),
    ),
  ).pipe(Layer.provide(capaGrabadaPorCajas("registro-oficial", grabada)));

/**
 * Lleva el reloj justo a la hora en que despierta la ficha que espera, y si no espera ninguna,
 * deja pasar tiempo real, hasta que la fibra acaba. Así el reloj solo avanza lo que tardan las
 * fichas, y no mientras la noche barre, fusiona o publica en disco.
 */
const hastaQueAcabe = <A, E>(fibra: Fiber.Fiber<A, E>, hasta: Ref.Ref<number | undefined>) =>
  Effect.gen(function* () {
    for (let paso = 0; paso < 100_000 && fibra.pollUnsafe() === undefined; paso++) {
      const despierta = yield* Ref.get(hasta);
      const ahora = yield* Clock.currentTimeMillis;
      if (despierta !== undefined && despierta > ahora) yield* TestClock.adjust(despierta - ahora);
      else yield* TestClock.withLive(Effect.sleep("1 millis"));
    }
    return yield* Fiber.join(fibra);
  });

/** Cuántas fichas se han leído ya, según la base. */
const leidasEn = (entorno: Entorno) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const filas = yield* sql<{
      readonly clave: string;
      readonly fallos: number;
      readonly espera: number | null;
    }>`SELECT clave, ficha_fallos AS fallos, ficha_espera_hasta AS espera
      FROM observaciones WHERE ficha_leida_en IS NOT NULL ORDER BY clave`;
    const fallidas = yield* sql<{
      readonly clave: string;
      readonly fallos: number;
      readonly espera: number | null;
      readonly error: string | null;
    }>`SELECT clave, ficha_fallos AS fallos, ficha_espera_hasta AS espera, ficha_error AS error
      FROM observaciones WHERE ficha_fallos > 0 ORDER BY clave`;
    return { leidas: filas.map((f) => f.clave), fallidas };
  }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

/** La última ejecución del registro oficial, según la orden de estado. */
const ultimaDe = (entorno: Entorno) =>
  conBase(
    entorno.base,
    Effect.map(
      Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)),
      (resumen) => resumen.fuentes.find((f) => f.fuente === "registro-oficial")?.ultima,
    ),
  );

/** Registros de la muestra movidos a Girona (provincia 17), dentro del cuadro de Barcelona. */
const conGirona = (grabada: FuenteGrabada, cuantos: number): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.map((r, i) =>
      i >= grabada.listado.registros.length - cuantos
        ? { ...r, posicion: { longitud: r.posicion.longitud + 0.7, latitud: 41.98 } }
        : r,
    ),
  },
});

describe("fichas en la ventana de la noche (base SQLite y registro grabado)", () => {
  it.effect(
    "la ventana se cierra con fichas pendientes, se publica a mitad, y la noche siguiente sigue por donde iba",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          const hasta = yield* Ref.make<number | undefined>(undefined);
          const extractor = conFichasApuntadas(grabada, pedidas, {
            tarda: { cuanto: Duration.seconds(3), hasta },
          });
          const opciones = conFichas({ ventana: Duration.minutes(1) });

          yield* TestClock.setTime(NOCHE);
          const primera = yield* hastaQueAcabe(
            yield* Effect.forkChild(unaNoche(entorno, extractor, opciones)),
            hasta,
          );
          const deLaPrimera = yield* Ref.getAndSet(pedidas, []);
          const trasLaPrimera = yield* leidasEn(entorno);
          assert.isAbove(deLaPrimera.length, 5);
          assert.isBelow(deLaPrimera.length, 40);
          assert.strictEqual(trasLaPrimera.leidas.length, deLaPrimera.length);
          const ejecucion = yield* ultimaDe(entorno);
          assert.strictEqual(ejecucion?.cambios.fichas.leidas, deLaPrimera.length);
          assert.deepStrictEqual(ejecucion?.errores, []);

          // A mitad se ha publicado una versión, y al cerrar la ventana, otra posterior.
          const escritos = yield* entorno.escritos;
          const manifiestos = escritos.filter((f) => f.startsWith("ficheros@"));
          assert.strictEqual(manifiestos.length, 2);
          assert.strictEqual(escritos.filter((f) => f === FICHERO_VIGENTE).length, 2);
          assert.strictEqual(primera.publicacion.tipo, "publicada");
          if (primera.publicacion.tipo === "publicada") {
            assert.strictEqual(
              ficheroDeManifiesto(primera.publicacion.version),
              manifiestos.at(-1),
            );
          }

          // La noche siguiente no repite ninguna y sigue por la cola.
          yield* TestClock.setTime(NOCHE + DIA);
          yield* hastaQueAcabe(
            yield* Effect.forkChild(unaNoche(entorno, extractor, opciones)),
            hasta,
          );
          const deLaSegunda = yield* Ref.get(pedidas);
          assert.isAbove(deLaSegunda.length, 5);
          assert.isFalse(deLaSegunda.some((clave) => deLaPrimera.includes(clave)));
          const trasLaSegunda = yield* leidasEn(entorno);
          assert.strictEqual(
            trasLaSegunda.leidas.length,
            Math.min(40, deLaPrimera.length + deLaSegunda.length),
          );
        }),
      ),
    30_000,
  );

  it.effect("la provincia con prioridad se lee antes que el resto de su zona", () =>
    Effect.gen(function* () {
      // Las cinco últimas de la muestra, movidas a Girona, siguen en el cuadro de Barcelona.
      const grabada = conGirona(yield* muestraCampusNord, 5);
      const girona = grabada.listado.registros.slice(-5).map((r) => r.clave);
      const leerCon = (fichas: Partial<OpcionesFichas>) =>
        conEntorno((entorno) =>
          Effect.gen(function* () {
            const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
            yield* TestClock.setTime(NOCHE);
            yield* unaNoche(entorno, conFichasApuntadas(grabada, pedidas), conFichas(fichas));
            return yield* Ref.get(pedidas);
          }),
        );

      // Girona primero: sus cinco, en el orden en que llegaron.
      assert.deepStrictEqual(yield* leerCon({ prioridad: ["17"], maximo: 5 }), girona);
      // Barcelona primero, como por defecto: las de Girona, al final, con el resto de Cataluña.
      const porDefecto = yield* leerCon({});
      assert.strictEqual(porDefecto.length, 40);
      assert.deepStrictEqual(porDefecto.slice(-5).toSorted(), girona.toSorted());
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "un bloqueo para las fichas sin insistir, queda en la ejecución y la noche publica",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          yield* TestClock.setTime(NOCHE);
          const hecha = yield* unaNoche(
            entorno,
            conFichasApuntadas(grabada, pedidas, {
              falla: (registro, vez) =>
                vez === 3
                  ? new FuenteBloqueada({ url: registro.url, motivo: "HTTP 403" })
                  : undefined,
            }),
          );
          assert.strictEqual((yield* Ref.get(pedidas)).length, 3);
          assert.deepStrictEqual(
            hecha.ejecuciones.map((e) => [e.fuente, e.estado]),
            [
              ["registro-oficial", "completada"],
              ["antenasmoviles", "omitida"],
            ],
          );
          assert.strictEqual(hecha.publicacion.tipo, "publicada");
          const ejecucion = yield* ultimaDe(entorno);
          assert.strictEqual(ejecucion?.cambios.fichas.leidas, 2);
          assert.lengthOf(ejecucion?.errores ?? [], 1);
          assert.include(
            ejecucion?.errores[0] ?? "",
            "Fichas paradas hasta la próxima noche: FuenteBloqueada: HTTP 403",
          );
          // El bloqueo no hace esperar a la ficha: la noche siguiente se pide la primera.
          assert.deepStrictEqual((yield* leidasEn(entorno)).fallidas, []);
        }),
      ),
  );

  it.effect("una ficha que falla espera un día y se vuelve a pedir después", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const primera = grabada.listado.registros[0];
        assert.isDefined(primera);
        const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
        const invalida = conFichasApuntadas(grabada, pedidas, {
          falla: (registro) =>
            registro.clave === primera.clave
              ? new RespuestaInesperada({
                  url: registro.url,
                  motivo: "La ficha dice «Código de emplazamiento no válido»",
                })
              : undefined,
        });

        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, invalida);
        const trasLaPrimera = yield* leidasEn(entorno);
        assert.strictEqual(trasLaPrimera.leidas.length, 39);
        assert.deepStrictEqual(trasLaPrimera.fallidas, [
          {
            clave: primera.clave,
            fallos: 1,
            espera: NOCHE + DIA,
            error:
              "RespuestaInesperada: La ficha dice «Código de emplazamiento no válido» " +
              `(${primera.url})`,
          },
        ]);

        // Antes de que pase el día no se pide; después sí, y al leerla se borran sus fallos.
        yield* Ref.set(pedidas, []);
        yield* TestClock.setTime(NOCHE + DIA - 60_000);
        yield* unaNoche(entorno, invalida);
        assert.deepStrictEqual(yield* Ref.get(pedidas), []);

        yield* TestClock.setTime(NOCHE + DIA + 60_000);
        yield* unaNoche(entorno, conFichasApuntadas(grabada, pedidas));
        assert.deepStrictEqual(yield* Ref.get(pedidas), [primera.clave]);
        const trasLeerla = yield* leidasEn(entorno);
        assert.strictEqual(trasLeerla.leidas.length, 40);
        assert.deepStrictEqual(trasLeerla.fallidas, []);
      }),
    ),
  );

  it.effect(
    "una base de la versión 3 se pone al día, conserva sus puntos y su cola sigue donde estaba",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const grabada = yield* muestraCampusNord;
          const registros = grabada.listado.registros;
          const leidas = new Set(registros.slice(0, 10).map((r) => r.clave));
          // Una base como la deja la versión 3 tras una noche: las 40 observaciones del Campus
          // Nord, las 10 primeras con su ficha leída, y un punto de antenasmoviles.es.
          yield* fs.makeDirectory(path.dirname(entorno.base), { recursive: true });
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            for (const sentencia of ESQUEMA.slice(0, 3).flat()) yield* sql.unsafe(sentencia);
            yield* sql.unsafe("PRAGMA user_version = 3");
            for (const r of registros) {
              const leida = leidas.has(r.clave) ? NOCHE - DIA : null;
              yield* sql`INSERT INTO observaciones ${sql.insert({
                fuente: "registro-oficial",
                clave: r.clave,
                ficha_leida_en: leida,
                retirada_en: null,
                cuadro: "2,41",
                vista_en: NOCHE - DIA,
                datos: yield* codificarObservacion({
                  ...r,
                  fuente: "registro-oficial",
                  afirma: "presente",
                  bandas: [],
                  fecha: NOCHE - DIA,
                  fichaLeidaEn: leida,
                  ausencias: 0,
                  retiradaEn: null,
                }),
              })}`;
            }
            yield* sql`INSERT INTO puntos ${sql.insert({
              fuente: "antenasmoviles",
              clave: "CATR0228A",
              cuadro: "2,41",
              prioridad: 0,
              detalle_leido_en: null,
              vista_en: NOCHE - DIA,
              retirado_en: null,
              datos: yield* codificarPunto({
                clave: "CATR0228A",
                codigos: ["CATR0228A"],
                posicion: { longitud: 2.113628, latitud: 41.388344 },
                huella: "abc",
                prioridad: 0,
                detalleLeidoEn: null,
                observaciones: [],
                ausencias: 0,
                retiradoEn: null,
              }),
            })}`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

          yield* conBase(entorno.base, Effect.asVoid(BaseNocturna));
          const alDia = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const [version] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
            const [fallos] = yield* sql<{ readonly n: number }>`SELECT sum(ficha_fallos) AS n
              FROM observaciones`;
            const puntos = yield* sql<{ readonly clave: string }>`SELECT clave FROM puntos`;
            return { version: version?.user_version, fallos: fallos?.n, puntos };
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          assert.deepStrictEqual(alDia, {
            version: ESQUEMA.length,
            fallos: 0,
            puntos: [{ clave: "CATR0228A" }],
          });

          // La noche pide solo las 30 sin leer, y la que falla queda esperando.
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          const ultima = registros.at(-1);
          assert.isDefined(ultima);
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(
            entorno,
            conFichasApuntadas(grabada, pedidas, {
              falla: (registro) =>
                registro.clave === ultima.clave
                  ? new RespuestaInesperada({ url: registro.url, motivo: "ilegible" })
                  : undefined,
            }),
          );
          const pedidasEnLaNoche = yield* Ref.get(pedidas);
          assert.strictEqual(pedidasEnLaNoche.length, 30);
          assert.isFalse(pedidasEnLaNoche.some((clave) => leidas.has(clave)));
          const trasLaNoche = yield* leidasEn(entorno);
          assert.strictEqual(trasLaNoche.leidas.length, 39);
          assert.deepStrictEqual(
            trasLaNoche.fallidas.map((f) => [f.clave, f.fallos]),
            [[ultima.clave, 1]],
          );
        }),
      ),
  );
});
