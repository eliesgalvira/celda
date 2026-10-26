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
  EN_RONDAS,
  type Entorno,
  unaNoche,
} from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;
const HORA = 3_600_000;
/** El primer sábado de noviembre de 2026, a las 00:30 de Madrid, y el domingo siguiente. */
const SABADO = Date.UTC(2026, 10, 6, 23, 30);
const DOMINGO = SABADO + DIA;
/** El primer sábado de diciembre, a la misma hora, y el de enero. */
const DICIEMBRE = Date.UTC(2026, 11, 4, 23, 30);
const ENERO = Date.UTC(2027, 0, 1, 23, 30);
/** Lo que espera una ficha que falla, hasta la ronda siguiente. */
const ESPERA = 36 * HORA;

const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));
const decodificarObservacion = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ObservacionGuardada),
);

/** Una fuente que ya no está en `Fuente`, como la web de antenas que retiró el ADR 0019. */
const RETIRADA = "fuente-retirada";

/** Las opciones de una ejecución que es una ronda nueva, con otras de fichas. */
const conFichas = (fichas: Partial<OpcionesFichas>) => ({
  proceso: { ...CATALUNA_CADA_NOCHE, fichas: { ...OPCIONES_FICHAS, ...fichas } },
});

/** Las de una ejecución con las rondas de producción, con otras de fichas. */
const enRonda = (fichas: Partial<OpcionesFichas> = {}) => ({
  proceso: { ...EN_RONDAS, fichas: { ...OPCIONES_FICHAS, ...fichas } },
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

describe("fichas en cada ronda (base SQLite y registro grabado)", () => {
  it.effect(
    "el sábado cierra la ventana con fichas pendientes y publica a mitad; el domingo lee solo las que quedan, sin barrer, y una ronda pide cada ficha una vez",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          const hasta = yield* Ref.make<number | undefined>(undefined);
          const extractor = conFichasApuntadas(grabada, pedidas, {
            tarda: { cuanto: Duration.seconds(3), hasta },
          });
          // El sábado, un minuto de ventana: no da para todas.
          yield* TestClock.setTime(SABADO);
          const sabado = yield* hastaQueAcabe(
            yield* Effect.forkChild(
              unaNoche(entorno, extractor, enRonda({ ventana: Duration.minutes(1) })),
            ),
            hasta,
          );
          const delSabado = yield* Ref.getAndSet(pedidas, []);
          const trasElSabado = yield* leidasEn(entorno);
          assert.isAbove(delSabado.length, 5);
          assert.isBelow(delSabado.length, 40);
          assert.strictEqual(trasElSabado.leidas.length, delSabado.length);
          const ejecucion = yield* ultimaDe(entorno);
          assert.strictEqual(ejecucion?.cambios.fichas.leidas, delSabado.length);
          assert.deepStrictEqual(ejecucion?.errores, []);
          const registro = sabado.ejecuciones.find((e) => e.fuente === "registro-oficial");
          assert.deepStrictEqual(registro?.porLeer, { zonas: [], fichas: 40 - delSabado.length });

          // A mitad se ha publicado una versión, y al cerrar la ventana, otra posterior.
          const escritos = yield* entorno.escritos;
          const manifiestos = escritos.filter((f) => f.startsWith("ficheros@"));
          assert.strictEqual(manifiestos.length, 2);
          assert.strictEqual(escritos.filter((f) => f === FICHERO_VIGENTE).length, 2);
          assert.strictEqual(sabado.publicacion.tipo, "publicada");
          if (sabado.publicacion.tipo === "publicada") {
            assert.strictEqual(ficheroDeManifiesto(sabado.publicacion.version), manifiestos.at(-1));
          }

          // El domingo no barre: Cataluña ya tiene su barrido de la ronda. Lee las que quedan, y
          // ninguna de las del sábado.
          yield* TestClock.setTime(DOMINGO);
          const domingo = yield* hastaQueAcabe(
            yield* Effect.forkChild(unaNoche(entorno, extractor, enRonda())),
            hasta,
          );
          const delDomingo = yield* Ref.getAndSet(pedidas, []);
          const delRegistro = domingo.ejecuciones.find((e) => e.fuente === "registro-oficial");
          assert.deepStrictEqual(delRegistro?.zonas, []);
          assert.strictEqual(delDomingo.length, 40 - delSabado.length);
          assert.isFalse(delDomingo.some((clave) => delSabado.includes(clave)));
          assert.strictEqual(new Set([...delSabado, ...delDomingo]).size, 40);
          assert.deepStrictEqual(delRegistro?.porLeer, { zonas: [], fichas: 0 });
          assert.lengthOf((yield* leidasEn(entorno)).leidas, 40);

          // Otra ejecución ese fin de semana no pide nada al registro.
          yield* TestClock.setTime(DOMINGO + HORA);
          const otra = yield* unaNoche(entorno, extractor, enRonda());
          assert.deepStrictEqual(yield* Ref.get(pedidas), []);
          assert.deepStrictEqual(
            otra.ejecuciones.find((e) => e.fuente === "registro-oficial")?.zonas,
            [],
          );
        }),
      ),
    30_000,
  );

  it.effect(
    "la ronda del mes siguiente barre otra vez y relee todas las fichas, de la leída hace más tiempo a la más reciente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          const extractor = conFichasApuntadas(grabada, pedidas);

          // El sábado solo da tiempo a 25; el domingo, a las 15 que quedan.
          yield* TestClock.setTime(SABADO);
          yield* unaNoche(entorno, extractor, enRonda({ maximo: 25 }));
          const delSabado = yield* Ref.getAndSet(pedidas, []);
          yield* TestClock.setTime(DOMINGO);
          yield* unaNoche(entorno, extractor, enRonda());
          const delDomingo = yield* Ref.getAndSet(pedidas, []);
          assert.lengthOf(delSabado, 25);
          assert.lengthOf(delDomingo, 15);

          // En diciembre van primero las del sábado, que se leyeron antes, y luego las del domingo.
          yield* TestClock.setTime(DICIEMBRE);
          const diciembre = yield* unaNoche(entorno, extractor, enRonda());
          assert.deepStrictEqual(
            diciembre.ejecuciones
              .find((e) => e.fuente === "registro-oficial")
              ?.zonas.map((z) => [z.zona, z.estado]),
            [["cataluna", "completado"]],
          );
          assert.deepStrictEqual(yield* Ref.get(pedidas), [...delSabado, ...delDomingo]);
        }),
      ),
  );

  it.effect(
    "un bloqueo para las fichas sin insistir y queda en la ejecución; el domingo lo intenta otra vez, y si vuelve a parar, lo que queda espera a la ronda del mes siguiente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          // El geoportal da un 403 a la tercera ficha que se le pide y a la quinta.
          const bloqueado = conFichasApuntadas(grabada, pedidas, {
            falla: (registro, vez) =>
              vez === 3 || vez === 5
                ? new FuenteBloqueada({ url: registro.url, motivo: "HTTP 403" })
                : undefined,
          });
          yield* TestClock.setTime(SABADO);
          const sabado = yield* unaNoche(entorno, bloqueado, enRonda());
          assert.strictEqual((yield* Ref.get(pedidas)).length, 3);
          assert.deepStrictEqual(
            sabado.ejecuciones.map((e) => [e.fuente, e.estado]),
            [["registro-oficial", "completada"]],
          );
          assert.strictEqual(sabado.publicacion.tipo, "publicada");
          const ejecucion = yield* ultimaDe(entorno);
          assert.strictEqual(ejecucion?.cambios.fichas.leidas, 2);
          assert.lengthOf(ejecucion?.errores ?? [], 1);
          assert.include(ejecucion?.errores[0] ?? "", "Fichas paradas: FuenteBloqueada: HTTP 403");
          // El bloqueo no hace esperar a la ficha: el domingo se pide la primera.
          assert.deepStrictEqual((yield* leidasEn(entorno)).fallidas, []);
          assert.deepStrictEqual(sabado.ejecuciones[0]?.porLeer, { zonas: [], fichas: 38 });

          // El domingo empieza por la que se bloqueó y vuelve a parar en la segunda.
          yield* TestClock.setTime(DOMINGO);
          const domingo = yield* unaNoche(entorno, bloqueado, enRonda());
          const todas = yield* Ref.get(pedidas);
          assert.lengthOf(todas, 5);
          assert.strictEqual(todas[3], todas[2]);
          assert.deepStrictEqual(domingo.ejecuciones[0]?.porLeer, { zonas: [], fichas: 37 });
          assert.lengthOf((yield* leidasEn(entorno)).leidas, 3);
        }),
      ),
  );

  it.effect(
    "una ficha que falla espera a la ronda siguiente: el domingo no la pide y la del mes siguiente sí",
    () =>
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

          yield* TestClock.setTime(SABADO);
          yield* unaNoche(entorno, invalida, enRonda());
          const trasElSabado = yield* leidasEn(entorno);
          assert.strictEqual(trasElSabado.leidas.length, 39);
          assert.deepStrictEqual(trasElSabado.fallidas, [
            {
              clave: primera.clave,
              fallos: 1,
              espera: SABADO + ESPERA,
              error:
                "RespuestaInesperada: La ficha no tiene la tabla de características técnicas " +
                `(${primera.url})`,
            },
          ]);

          // El domingo no la pide: daría lo mismo. No queda nada más de la ronda.
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(DOMINGO);
          const domingo = yield* unaNoche(entorno, invalida, enRonda());
          assert.deepStrictEqual(yield* Ref.get(pedidas), []);
          assert.deepStrictEqual(domingo.ejecuciones[0]?.porLeer, { zonas: [], fichas: 0 });

          // La ronda de diciembre la pide la primera, porque nunca se ha leído, y al leerla se
          // borran sus fallos.
          yield* TestClock.setTime(DICIEMBRE);
          yield* unaNoche(entorno, conFichasApuntadas(grabada, pedidas), enRonda());
          assert.strictEqual((yield* Ref.get(pedidas))[0], primera.clave);
          const trasLeerla = yield* leidasEn(entorno);
          assert.strictEqual(trasLeerla.leidas.length, 40);
          assert.deepStrictEqual(trasLeerla.fallidas, []);
        }),
      ),
  );

  it.effect(
    "una estación base sin ficha en el registro se publica con la marca y su fecha, se vuelve a pedir en la ronda siguiente y una lectura buena quita la marca",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          // Una estación base de un emplazamiento compartido, con una sola observación y una ficha
          // con bandas cuando el registro la tiene.
          const conBandas = (e: EstacionBase) =>
            e.observaciones.length === 1 &&
            (grabada.fichas.get(e.observaciones[0]?.clave ?? "")?.bandas.length ?? 0) > 0;
          const compartido = fusionar(
            grabada.listado.registros.map((r) => ({
              ...r,
              fuente: "registro-oficial" as const,
              bandas: [],
              fecha: SABADO,
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

          // El sábado de noviembre el registro no tiene su ficha.
          yield* TestClock.setTime(SABADO);
          yield* unaNoche(entorno, conFichasApuntadas(sinFicha, pedidas), enRonda());
          const primera = yield* observacionEn(entorno, clave);
          assert.strictEqual(primera.datos.sinFichaEnRegistro, SABADO);
          assert.deepStrictEqual(primera.datos.bandas, []);
          assert.strictEqual(primera.fallos, 1);
          assert.strictEqual(primera.espera, SABADO + ESPERA);

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
              e.compania === afectada.compania ? SABADO : undefined,
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
              Effect.flatMap(BaseNocturna, (base) => base.resumen(SABADO)),
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
              "intento 2 desde 2026-11-08 11:30:00 UTC",
          );

          // El domingo no se pide. En diciembre sí, y sigue sin ficha: espera a la ronda
          // siguiente, y la fecha de la comprobación es la de esa ejecución.
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(DOMINGO);
          yield* unaNoche(entorno, conFichasApuntadas(sinFicha, pedidas), enRonda());
          assert.deepStrictEqual(yield* Ref.get(pedidas), []);
          yield* TestClock.setTime(DICIEMBRE);
          yield* unaNoche(entorno, conFichasApuntadas(sinFicha, pedidas), enRonda());
          assert.include(yield* Ref.get(pedidas), clave);
          const trasDiciembre = yield* observacionEn(entorno, clave);
          assert.strictEqual(trasDiciembre.datos.sinFichaEnRegistro, DICIEMBRE);
          assert.strictEqual(trasDiciembre.fallos, 2);
          assert.strictEqual(trasDiciembre.espera, DICIEMBRE + ESPERA);

          // El ministerio lo arregla: la ronda de enero quita la marca y la publica.
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(ENERO);
          yield* unaNoche(entorno, conFichasApuntadas(grabada, pedidas), enRonda());
          assert.include(yield* Ref.get(pedidas), clave);
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
    "la ficha publicada dice qué bandas están sin leer, y una ficha leída sin bandas deja de estarlo (#41)",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          // Una estación base con una sola observación, para que ninguna otra le dé bandas.
          const clave = fusionar(
            grabada.listado.registros.map((r) => ({
              ...r,
              fuente: "registro-oficial" as const,
              bandas: [],
              fecha: NOCHE,
              afirma: "presente" as const,
            })),
          )
            .flatMap((e) => e.estaciones)
            .find((e) => e.observaciones.length === 1)?.observaciones[0]?.clave;
          assert.isDefined(clave);
          // El registro lista la estación base, pero su ficha no publica ninguna banda.
          const fichas = new Map(grabada.fichas);
          fichas.set(clave, { bandas: [], medidasDeExposicion: [] });
          const sinBandas = { ...grabada, fichas };
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          const deLaClave = (publicadas: ReadonlyArray<Ficha>) =>
            publicadas
              .flatMap((f) => f.estaciones)
              .find((e) => e.origenes.some((o) => o.clave === clave));

          // Primera ejecución, solo el listado: ninguna ficha leída.
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(
            entorno,
            conFichasApuntadas(sinBandas, pedidas),
            conFichas({ maximo: 0 }),
          );
          const antes = yield* fichasPublicadas(entorno);
          assert.isAbove(antes.length, 0);
          assert.isTrue(antes.every((f) => f.estaciones.every((e) => e.bandasSinLeer)));

          // Segunda, con las fichas: ninguna queda sin leer, y la de la clave, sin bandas.
          yield* TestClock.setTime(NOCHE + DIA);
          yield* unaNoche(entorno, conFichasApuntadas(sinBandas, pedidas));
          const despues = yield* fichasPublicadas(entorno);
          assert.isTrue(despues.every((f) => f.estaciones.every((e) => !e.bandasSinLeer)));
          const estacion = deLaClave(despues);
          assert.isDefined(estacion);
          assert.isFalse(estacion.bandasSinLeer);
          assert.deepStrictEqual(estacion.bandas, []);
          assert.isUndefined(estacion.sinFichaEnRegistro);
        }),
      ),
    30_000,
  );

  it.effect(
    "veinte fichas seguidas sin ficha en el registro paran la ejecución y ninguna queda marcada",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const todas = new Set(grabada.listado.registros.map((r) => r.clave));
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          yield* TestClock.setTime(SABADO);
          yield* unaNoche(
            entorno,
            conFichasApuntadas({ ...grabada, sinFicha: todas }, pedidas),
            enRonda(),
          );
          const pedidasEnLaEjecucion = yield* Ref.get(pedidas);
          assert.lengthOf(pedidasEnLaEjecucion, SIN_FICHA_SEGUIDAS);
          for (const clave of pedidasEnLaEjecucion) {
            const guardada = yield* observacionEn(entorno, clave);
            // Esperan como cualquier fallo, pero sin la marca pública.
            assert.notProperty(guardada.datos, "sinFichaEnRegistro");
            assert.strictEqual(guardada.fallos, 1);
            assert.strictEqual(guardada.espera, SABADO + ESPERA);
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
    "las fichas leídas con una versión anterior de la lectura se releen en la misma ronda, y sus medidas de exposición se guardan y se publican",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const pedidas = yield* Ref.make<ReadonlyArray<string>>([]);
          yield* TestClock.setTime(SABADO);
          yield* unaNoche(entorno, conFichasApuntadas(grabada, pedidas), enRonda());
          assert.lengthOf(yield* Ref.get(pedidas), 40);

          // Cinco fichas con medidas como las dejaba la lectura de antes, que no las sacaba.
          const viejas = grabada.listado.registros
            .filter((r) => (grabada.fichas.get(r.clave)?.medidasDeExposicion.length ?? 0) > 0)
            .slice(0, 5)
            .map((r) => r.clave);
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE observaciones SET ficha_leida_con = 1,
                datos = json_remove(datos, '$.medidasDeExposicion')
              WHERE clave IN ${sql.in(viejas)}`;
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          const resumen = yield* conBase(
            entorno.base,
            Effect.flatMap(BaseNocturna, (base) => base.resumen(SABADO)),
          );
          assert.strictEqual(
            resumen.fuentes.find((f) => f.fuente === "registro-oficial")?.porReleer,
            5,
          );

          // El domingo se piden solo esas cinco, aunque se leyeron en la ronda. Una de ellas
          // publica ahora otras medidas que las de la muestra, y son las que se guardan.
          const [cambia = "", ...igualesQueAntes] = viejas;
          const otras = [{ distanciaMetros: 12, acimutGrados: 300, microvatiosPorCm2: 0.02 }];
          const fichas = new Map(grabada.fichas);
          const antes = grabada.fichas.get(cambia);
          assert.isDefined(antes);
          // Sin las tablas en crudo de la muestra, que dirían las medidas de antes.
          fichas.set(cambia, { bandas: antes?.bandas ?? [], medidasDeExposicion: otras });
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(DOMINGO);
          yield* unaNoche(entorno, conFichasApuntadas({ ...grabada, fichas }, pedidas), enRonda());
          assert.deepStrictEqual(new Set(yield* Ref.get(pedidas)), new Set(viejas));
          const cambiada = yield* observacionEn(entorno, cambia);
          assert.deepStrictEqual(cambiada.datos.medidasDeExposicion, otras);
          // Son las primeras medidas que lee de ellas: el registro ya las publicaba, así que la
          // fecha de la observación no se mueve.
          assert.strictEqual(cambiada.datos.fecha, SABADO);
          for (const clave of igualesQueAntes) {
            const releida = yield* observacionEn(entorno, clave);
            assert.strictEqual(releida.datos.fecha, SABADO);
            assert.deepStrictEqual(
              releida.datos.medidasDeExposicion,
              grabada.fichas.get(clave)?.medidasDeExposicion,
            );
          }
          const publicada = (yield* fichasPublicadas(entorno))
            .flatMap((f) => f.estaciones)
            .find((e) => e.origenes.some((o) => o.clave === cambia));
          assert.deepStrictEqual(publicada?.medidasDeExposicion, otras);

          // Ya están leídas con la lectura de hoy: otra ejecución ese domingo no pide ninguna.
          yield* Ref.set(pedidas, []);
          yield* TestClock.setTime(DOMINGO + HORA);
          yield* unaNoche(entorno, conFichasApuntadas({ ...grabada, fichas }, pedidas), enRonda());
          assert.deepStrictEqual(yield* Ref.get(pedidas), []);
        }),
      ),
    30_000,
  );

  it.effect(
    "una base de la versión 3 se pone al día, pierde lo de las fuentes retiradas y su cola sigue donde estaba, con las leídas al final",
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

          // La ejecución pide primero las 30 sin leer, y la que falla queda esperando. Luego relee
          // las 10 leídas, que se leyeron sin las medidas de exposición.
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
          assert.strictEqual(pedidasEnLaNoche.length, 40);
          assert.isFalse(pedidasEnLaNoche.slice(0, 30).some((clave) => leidas.has(clave)));
          assert.deepStrictEqual(new Set(pedidasEnLaNoche.slice(30)), leidas);
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
