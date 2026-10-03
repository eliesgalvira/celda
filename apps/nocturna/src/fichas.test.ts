// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import type { EstacionBase } from "@celda/dominio/emplazamiento";
import type { Ficha } from "@celda/dominio/ficha";
import { fusionar } from "@celda/dominio/fusion";
import {
  ficheroDeManifiesto,
  leerCapaDeProvincia,
  leerLoteDeProvincia,
  leerResumen,
} from "@celda/dominio/provincias";
import {
  ExtractorPorCajas,
  FuenteBloqueada,
  type Registro,
  RespuestaInesperada,
} from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS, type OpcionesFichas, SIN_FICHA_SEGUIDAS } from "@celda/ingesta/fichas";
import { ObservacionGuardada } from "@celda/ingesta/guardado";
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
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";

import { BaseNocturna, ESQUEMA } from "./base.ts";
import { describirResumen } from "./estado.ts";
import {
  CATALUNA_CADA_NOCHE,
  conBase,
  conEntorno,
  contenidoDe,
  type Entorno,
  unaNoche,
} from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));
const decodificarObservacion = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ObservacionGuardada),
);

/** Una fuente que ya no está en `Fuente`, como la web de antenas que retiró el ADR 0019. */
const RETIRADA = "fuente-retirada";

/** Las opciones de la noche con otras de fichas. */
const conFichas = (fichas: Partial<OpcionesFichas>) => ({
  proceso: { ...CATALUNA_CADA_NOCHE, fichas: { ...OPCIONES_FICHAS, ...fichas } },
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

/** Las fichas de la versión vigente del almacén, como las leería la web. */
const fichasPublicadas = (entorno: Entorno) =>
  Effect.gen(function* () {
    const almacen = yield* contenidoDe(entorno.almacen);
    const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
    if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
    const resumen = leerResumen(
      almacen.get(vigente.success.resumen ?? "") ?? "",
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

/** Lo que guarda la base de una observación del registro, con su cola de fichas. */
const observacionEn = (entorno: Entorno, clave: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [fila] = yield* sql<{
      readonly datos: string;
      readonly fallos: number;
      readonly espera: number | null;
    }>`SELECT datos, ficha_fallos AS fallos, ficha_espera_hasta AS espera
      FROM observaciones WHERE fuente = 'registro-oficial' AND clave = ${clave}`;
    assert.isDefined(fila);
    const datos = yield* decodificarObservacion(fila.datos);
    return { datos, fallos: fila.fallos, espera: fila.espera };
  }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

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
            [["registro-oficial", "completada"]],
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
                  motivo: "La ficha no tiene la tabla de características técnicas",
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
              "RespuestaInesperada: La ficha no tiene la tabla de características técnicas " +
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
    "una estación base sin ficha en el registro se publica con la marca y su fecha, se vuelve a pedir con la espera de siempre y una lectura buena quita la marca",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          // Una estación base de un emplazamiento compartido, con una sola observación y una ficha
          // con bandas cuando el registro la tiene.
          const conBandas = (e: EstacionBase) =>
            e.observaciones.length === 1 &&
            (grabada.fichas.get(e.observaciones[0]?.clave ?? "")?.length ?? 0) > 0;
          const compartido = fusionar(
            grabada.listado.registros.map((r) => ({
              ...r,
              fuente: "registro-oficial" as const,
              bandas: [],
              fecha: NOCHE,
              afirma: "presente" as const,
            })),
          ).find((e) => e.estaciones.length > 1 && e.estaciones.some(conBandas));
          const afectada = compartido?.estaciones.find(conBandas);
          const clave = afectada?.observaciones[0]?.clave;
          assert.isDefined(compartido);
          assert.isDefined(afectada);
          assert.isDefined(clave);
          const sinFicha = { ...grabada, sinFicha: new Set([clave]) };
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);

          // Primera noche: el registro no tiene su ficha.
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, conFichasApuntadas(sinFicha, pedidas));
          const primera = yield* observacionEn(entorno, clave);
          assert.strictEqual(primera.datos.sinFichaEnRegistro, NOCHE);
          assert.deepStrictEqual(primera.datos.bandas, []);
          assert.strictEqual(primera.fallos, 1);
          assert.strictEqual(primera.espera, NOCHE + DIA);

          // La ficha publicada lo dice solo de esa compañía, y conserva lo del listado.
          const publicada = (yield* fichasPublicadas(entorno)).find(
            (f) => f.clave === compartido.clave,
          );
          assert.isDefined(publicada);
          assert.deepStrictEqual(publicada.posicion, compartido.posicion);
          assert.strictEqual(publicada.direccion, compartido.direccion);
          assert.deepStrictEqual(
            publicada.estaciones.map((e) => [e.compania, e.sinFichaEnRegistro]),
            compartido.estaciones.map((e) => [
              e.compania,
              e.compania === afectada.compania ? NOCHE : undefined,
            ]),
          );
          const estacion = publicada.estaciones.find((e) => e.compania === afectada.compania);
          assert.deepStrictEqual(estacion?.bandas, []);
          assert.deepStrictEqual(
            estacion?.origenes.map((o) => o.clave),
            [clave],
          );

          // La orden `estado` la enseña esperando, con su motivo y su próximo intento.
          const estado = describirResumen(
            entorno.base,
            yield* conBase(
              entorno.base,
              Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)),
            ),
          );
          assert.include(
            estado,
            "  Fichas esperando tras un fallo: 1, por orden de su próximo intento:",
          );
          assert.include(
            estado,
            `    - ${clave}: SinFichaEnElRegistro: La ficha dice «Código de emplazamiento no válido» ` +
              `(${grabada.listado.registros.find((r) => r.clave === clave)?.url ?? ""}); ` +
              "intento 2 desde 2026-09-27 02:15:00 UTC",
          );

          // Antes del día de espera no se pide. Después sí, y sigue sin ficha: dos días más, y la
          // fecha de la comprobación es la de esta noche.
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(NOCHE + DIA - 60_000);
          yield* unaNoche(entorno, conFichasApuntadas(sinFicha, pedidas));
          assert.deepStrictEqual(yield* Ref.get(pedidas), []);
          const segunda = NOCHE + DIA + 60_000;
          yield* TestClock.setTime(segunda);
          yield* unaNoche(entorno, conFichasApuntadas(sinFicha, pedidas));
          assert.deepStrictEqual(yield* Ref.get(pedidas), [clave]);
          const trasLaSegunda = yield* observacionEn(entorno, clave);
          assert.strictEqual(trasLaSegunda.datos.sinFichaEnRegistro, segunda);
          assert.strictEqual(trasLaSegunda.fallos, 2);
          assert.strictEqual(trasLaSegunda.espera, segunda + 2 * DIA);

          // El ministerio lo arregla: la siguiente lectura buena quita la marca y la publica.
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(segunda + 2 * DIA + 60_000);
          yield* unaNoche(entorno, conFichasApuntadas(grabada, pedidas));
          assert.deepStrictEqual(yield* Ref.get(pedidas), [clave]);
          const arreglada = yield* observacionEn(entorno, clave);
          assert.notProperty(arreglada.datos, "sinFichaEnRegistro");
          assert.strictEqual(arreglada.fallos, 0);
          assert.isNull(arreglada.espera);
          assert.isAbove(arreglada.datos.bandas.length, 0);
          const sinMarca = (yield* fichasPublicadas(entorno)).find(
            (f) => f.clave === compartido.clave,
          );
          assert.isTrue(sinMarca?.estaciones.every((e) => e.sinFichaEnRegistro === undefined));
          assert.isAbove(
            sinMarca?.estaciones.find((e) => e.compania === afectada.compania)?.bandas.length ?? 0,
            0,
          );
        }),
      ),
    30_000,
  );

  it.effect(
    "veinte fichas seguidas sin ficha en el registro paran la noche y ninguna queda marcada",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const todas = new Set(grabada.listado.registros.map((r) => r.clave));
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, conFichasApuntadas({ ...grabada, sinFicha: todas }, pedidas));
          const pedidasEnLaNoche = yield* Ref.get(pedidas);
          assert.lengthOf(pedidasEnLaNoche, SIN_FICHA_SEGUIDAS);
          for (const clave of pedidasEnLaNoche) {
            const guardada = yield* observacionEn(entorno, clave);
            // Esperan como cualquier fallo, pero sin la marca pública.
            assert.notProperty(guardada.datos, "sinFichaEnRegistro");
            assert.strictEqual(guardada.fallos, 1);
            assert.strictEqual(guardada.espera, NOCHE + DIA);
          }
          assert.isTrue(
            (yield* fichasPublicadas(entorno)).every((f) =>
              f.estaciones.every((e) => e.sinFichaEnRegistro === undefined),
            ),
          );
          const ejecucion = yield* ultimaDe(entorno);
          assert.include(ejecucion?.errores.at(-1) ?? "", "puede que haya cambiado la URL");
        }),
      ),
    30_000,
  );

  it.effect(
    "una base de la versión 3 se pone al día, pierde lo de las fuentes retiradas y su cola sigue donde estaba",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const grabada = yield* muestraCampusNord;
          const registros = grabada.listado.registros;
          const leidas = new Set(registros.slice(0, 10).map((r) => r.clave));
          // Una base como la deja la versión 3 tras una noche: las 40 observaciones del Campus
          // Nord, las 10 primeras con su ficha leída, y un punto, una observación y una ejecución
          // omitida de una fuente que ya no está en `Fuente` (ADR 0019).
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
              fuente: RETIRADA,
              clave: "CATR0228A",
              cuadro: "2,41",
              prioridad: 0,
              detalle_leido_en: null,
              vista_en: NOCHE - DIA,
              retirado_en: null,
              datos: "{}",
            })}`;
            yield* sql`INSERT INTO observaciones ${sql.insert({
              fuente: RETIRADA,
              clave: "orange - CATR0228A",
              ficha_leida_en: NOCHE - DIA,
              retirada_en: null,
              cuadro: "2,41",
              vista_en: NOCHE - DIA,
              datos: "{}",
            })}`;
            yield* sql`INSERT INTO ejecuciones ${sql.insert({
              fuente: RETIRADA,
              inicio: NOCHE - DIA,
              fin: NOCHE - DIA,
              estado: "omitida",
              registros: null,
              cambios: "{}",
              errores: "[]",
              publicacion: null,
              zonas: null,
            })}`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

          yield* conBase(entorno.base, Effect.asVoid(BaseNocturna));
          const alDia = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const [version] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
            const [fallos] = yield* sql<{ readonly n: number }>`SELECT sum(ficha_fallos) AS n
              FROM observaciones`;
            const tablas = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
              WHERE type = 'table' AND name = 'puntos'`;
            const [retiradas] = yield* sql<{ readonly n: number }>`SELECT
              (SELECT count(*) FROM observaciones WHERE fuente = ${RETIRADA}) +
              (SELECT count(*) FROM ejecuciones WHERE fuente = ${RETIRADA}) AS n`;
            const [vigentes] = yield* sql<{ readonly n: number }>`SELECT count(*) AS n
              FROM observaciones`;
            return {
              version: version?.user_version,
              fallos: fallos?.n,
              puntos: tablas.length,
              retiradas: retiradas?.n,
              vigentes: vigentes?.n,
            };
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          assert.deepStrictEqual(alDia, {
            version: ESQUEMA.length,
            fallos: 0,
            puntos: 0,
            retiradas: 0,
            vigentes: 40,
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
