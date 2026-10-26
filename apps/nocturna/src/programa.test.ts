// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  decodificarVigente,
  type EmplazamientoLeido,
  FICHERO_VIGENTE,
  versionDeCapa,
} from "@celda/dominio/capa";
import { leerCapaDeProvincia, leerLoteDeProvincia, leerResumen } from "@celda/dominio/provincias";
import { BaseDeBarrido } from "@celda/ingesta/barrido";
import { INTERRUPTOR_POR_DEFECTO, SIN_CAMBIOS } from "@celda/ingesta/ejecucion";
import { ExtractorPorCajas } from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS } from "@celda/ingesta/fichas";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import {
  AlmacenDeCopias,
  AlmacenDeFicheros,
  AlmacenNoDisponible,
} from "@celda/publicacion/almacen";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { BaseNocturna } from "./base.ts";
import { CALENDARIO } from "./calendario.ts";
import { configuracion, COPIAS_CONSERVADAS } from "./configuracion.ts";
import { describirResumen } from "./estado.ts";
import { estado } from "./programa.ts";
import {
  conBase,
  conEntorno,
  contenidoDe,
  EN_RONDAS,
  type Entorno,
  tablasDe,
  unaNoche,
} from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;
const HORA = 3_600_000;
const VERSION = versionDeCapa(NOCHE);

const registroOficial = (grabada: FuenteGrabada) =>
  capaGrabadaPorCajas("registro-oficial", grabada);

/** Una estación de Vodafone de la muestra que deja de salir en el listado. */
const QUITADO = "VODAFONE ESPAÑA, S.A.U. - 079808";

const sinQuitado = (grabada: FuenteGrabada): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.filter((r) => r.clave !== QUITADO),
  },
});

/**
 * Lo que la web leería del almacén: cada emplazamiento de la versión vigente con las claves de
 * las fichas de su lote.
 */
const publicadoEn = (almacen: ReadonlyMap<string, string>) => {
  const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
  if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
  const resumen = leerResumen(almacen.get(vigente.success.resumen) ?? "", vigente.success.version);
  if (Result.isFailure(resumen)) return assert.fail(resumen.failure.message);
  const emplazamientos: Array<{
    readonly emplazamiento: EmplazamientoLeido;
    readonly lote: ReadonlyArray<string>;
  }> = [];
  for (const provincia of resumen.success.provincias) {
    if (provincia.fichero === undefined) continue;
    const capa = leerCapaDeProvincia(almacen.get(provincia.fichero) ?? "", provincia.codigo);
    if (Result.isFailure(capa)) return assert.fail(capa.failure.message);
    for (const emplazamiento of capa.success.emplazamientos) {
      const fichas = leerLoteDeProvincia(
        almacen.get(capa.success.lotes[emplazamiento.lote] ?? "") ?? "",
        provincia.codigo,
      );
      if (Result.isFailure(fichas)) return assert.fail(fichas.failure.message);
      emplazamientos.push({ emplazamiento, lote: fichas.success.map((f) => f.clave) });
    }
  }
  return { vigente: vigente.success, resumen: resumen.success, emplazamientos };
};

/** El resumen de la base del entorno, como lo ve la orden `estado`. */
const resumenDe = (entorno: Entorno) =>
  conBase(
    entorno.base,
    Effect.flatMap(BaseNocturna, (base) => base.resumen),
  );

/** El registro oficial del resumen, que es la única fuente con extractor. */
const registroDe = (entorno: Entorno) =>
  Effect.map(resumenDe(entorno), (resumen) => {
    const fuente = resumen.fuentes.find((f) => f.fuente === "registro-oficial");
    assert.isDefined(fuente);
    return fuente;
  });

/** Espera, con el reloj de verdad, a que se cumpla una condición. */
const hasta = <E>(condicion: Effect.Effect<boolean, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.gen(function* () {
    for (let intento = 0; intento < 2000; intento++) {
      if (yield* Effect.orDie(condicion)) return;
      yield* TestClock.withLive(Effect.sleep("10 millis"));
    }
    assert.fail("la condición no se ha cumplido a tiempo");
  });

/** Adelanta el reloj de minuto en minuto, con pausas reales, hasta que la fibra acaba. */
const hastaQueAcabe = <A, E>(fibra: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let minuto = 0; minuto < 180 && fibra.pollUnsafe() === undefined; minuto++) {
      yield* TestClock.adjust("1 minute");
      // Con tiempo de sobra para que la publicación acabe dentro de su minuto, aun con la máquina
      // cargada.
      yield* TestClock.withLive(Effect.sleep("25 millis"));
    }
    return yield* Fiber.join(fibra);
  });

/** El almacén del entorno, que no responde mientras `caido` esté a `true`, como R2 en un bloqueo. */
const almacenCaido = (entorno: Entorno, caido: Ref.Ref<boolean>) =>
  Layer.effect(
    AlmacenDeFicheros,
    Effect.map(AlmacenDeFicheros, (real) => {
      const siResponde = <A, E, R>(
        efecto: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | AlmacenNoDisponible, R> =>
        Effect.flatMap(
          Ref.get(caido),
          (sinRespuesta): Effect.Effect<A, E | AlmacenNoDisponible, R> =>
            sinRespuesta
              ? Effect.fail(new AlmacenNoDisponible({ motivo: "ERR_CONNECTION_RESET" }))
              : efecto,
        );
      return AlmacenDeFicheros.of({
        ...real,
        guardar: (fichero, contenido) => siResponde(real.guardar(fichero, contenido)),
        leer: (fichero) => siResponde(real.leer(fichero)),
        cambiarVigente: (contenido) => siResponde(real.cambiarVigente(contenido)),
        listar: siResponde(real.listar),
      });
    }),
  ).pipe(Layer.provide(entorno.almacenVigilado));

/**
 * Un cubo de R2 de prueba para las copias de la base: las guarda en memoria, contesta en otra
 * tarea y puede dejar de contestar.
 */
const copiasDePrueba = Effect.gen(function* () {
  const guardadas = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map());
  const caido = yield* Ref.make(false);
  const siContesta = <A>(efecto: Effect.Effect<A>) =>
    Effect.andThen(
      Effect.yieldNow,
      Effect.flatMap(Ref.get(caido), (sinRed) =>
        sinRed ? Effect.fail(new AlmacenNoDisponible({ motivo: "R2 no contesta" })) : efecto,
      ),
    );
  const capa = Layer.succeed(
    AlmacenDeCopias,
    AlmacenDeCopias.of({
      guardar: (nombre, contenido) =>
        siContesta(Ref.update(guardadas, (g) => new Map([...g, [nombre, contenido]]))),
      listar: siContesta(Effect.map(Ref.get(guardadas), (g) => [...g.keys()])),
      borrar: (nombre) =>
        siContesta(
          Ref.update(guardadas, (g) => new Map([...g].filter(([guardada]) => guardada !== nombre))),
        ),
    }),
  );
  return { capa, guardadas: Ref.get(guardadas), caido };
});

/** Descomprime una copia subida a R2. */
const descomprimir = (comprimida: Uint8Array) =>
  Effect.promise(
    async () =>
      new Uint8Array(
        await new Response(
          new Blob([new Uint8Array(comprimida)])
            .stream()
            .pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      ),
  );

describe("ingesta nocturna (base SQLite, almacén en carpeta, registro oficial grabado)", () => {
  it.effect("una noche lee el listado y las fichas, fusiona y publica la capa y sus fichas", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        const hecha = yield* unaNoche(entorno, registroOficial(yield* muestraCampusNord));

        assert.deepStrictEqual(
          hecha.ejecuciones.map((e) => [e.fuente, e.estado]),
          [["registro-oficial", "completada"]],
        );
        assert.strictEqual(hecha.publicacion.tipo, "publicada");
        // Los lotes y las capas, el manifiesto, el resumen y, al final, vigente.json.
        const escritos = yield* entorno.escritos;
        const publicado = publicadoEn(yield* contenidoDe(entorno.almacen));
        assert.strictEqual(publicado.vigente.version, VERSION);
        assert.strictEqual(escritos.at(-2), publicado.vigente.resumen);
        assert.strictEqual(escritos.at(-1), FICHERO_VIGENTE);
        assert.lengthOf(publicado.emplazamientos, 19);
        for (const { emplazamiento, lote } of publicado.emplazamientos) {
          assert.include(lote, emplazamiento.clave);
          assert.strictEqual(emplazamiento.provincia, "08");
        }

        const fuente = yield* registroDe(entorno);
        assert.strictEqual(fuente.ultima?.estado, "completada");
        assert.strictEqual(fuente.ultima?.registros, 40);
        assert.strictEqual(fuente.ultima?.cambios.fichas.leidas, 40);
        assert.strictEqual(fuente.ultima?.publicacion?.tipo, "publicada");
        assert.strictEqual(fuente.vigentes, 40);
        assert.isDefined(hecha.copia);
      }),
    ),
  );

  it.effect(
    "repetir la ejecución sin cambios solo rehace el resumen con el barrido nuevo, y otra vez nada",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, registroOficial(grabada));
          const antes = yield* entorno.escritos;
          const almacenAntes = yield* contenidoDe(entorno.almacen);

          yield* TestClock.adjust(DIA);
          const segunda = yield* unaNoche(entorno, registroOficial(grabada));
          assert.strictEqual(segunda.publicacion.tipo, "barrido");
          const almacen = yield* contenidoDe(entorno.almacen);
          const publicado = publicadoEn(almacen);
          assert.deepStrictEqual(yield* entorno.escritos, [
            ...antes,
            publicado.vigente.resumen,
            FICHERO_VIGENTE,
          ]);
          assert.strictEqual(publicado.vigente.version, VERSION);
          assert.strictEqual(
            publicado.resumen.provincias.find((p) => p.codigo === "08")?.barrido,
            NOCHE + DIA,
          );
          // Las capas y los lotes son los mismos ficheros.
          for (const [fichero, contenido] of almacenAntes) {
            if (fichero !== FICHERO_VIGENTE) assert.strictEqual(almacen.get(fichero), contenido);
          }
          // La ronda nueva relee las 40 fichas, y ninguna cambia.
          const fuente = yield* registroDe(entorno);
          assert.deepStrictEqual(fuente.ultima?.cambios, {
            ...SIN_CAMBIOS,
            fichas: { leidas: 40, cambiadas: 0 },
          });

          // Publicar otra vez sin otra ejecución no escribe nada.
          const tras = yield* entorno.escritos;
          const apagada = yield* unaNoche(entorno, registroOficial(grabada), {
            interruptores: {
              ...INTERRUPTOR_POR_DEFECTO,
              "registro-oficial": { activo: false, motivo: "prueba" },
            },
          });
          assert.strictEqual(apagada.publicacion.tipo, "al-dia");
          assert.deepStrictEqual(yield* entorno.escritos, tras);
        }),
      ),
  );

  it.effect("una noche cortada a mitad se retoma y deja lo mismo que una completa", () =>
    Effect.gen(function* () {
      const grabada = yield* muestraCampusNord.pipe(Effect.provide(NodeServices.layer));
      // Se corta en la quinta ficha, con el listado guardado y cuatro fichas leídas.
      const cortado = Layer.effect(
        ExtractorPorCajas,
        Effect.gen(function* () {
          const leidas = yield* Ref.make(0);
          const real = yield* ExtractorPorCajas;
          return ExtractorPorCajas.of({
            ...real,
            ficha: (registro) =>
              Effect.flatMap(
                Ref.updateAndGet(leidas, (n) => n + 1),
                (n) => (n === 5 ? Effect.die("se ha ido la luz") : real.ficha(registro)),
              ),
          });
        }),
      ).pipe(Layer.provide(registroOficial(grabada)));
      yield* TestClock.setTime(NOCHE);

      const retomada = yield* conEntorno((entorno) =>
        Effect.gen(function* () {
          const salida = yield* Effect.exit(unaNoche(entorno, cortado));
          assert.isTrue(Exit.isFailure(salida));
          yield* unaNoche(entorno, registroOficial(grabada));
          const resumen = yield* resumenDe(entorno);
          return {
            almacen: yield* contenidoDe(entorno.almacen),
            tablas: yield* tablasDe(entorno.base),
            ultima: resumen.fuentes.find((f) => f.fuente === "registro-oficial")?.ultima,
          };
        }),
      );
      const completa = yield* conEntorno((entorno) =>
        Effect.gen(function* () {
          yield* unaNoche(entorno, registroOficial(grabada));
          return {
            almacen: yield* contenidoDe(entorno.almacen),
            tablas: yield* tablasDe(entorno.base),
          };
        }),
      );

      assert.isAbove(completa.almacen.size, 2);
      assert.deepStrictEqual(retomada.almacen, completa.almacen);
      assert.deepStrictEqual(retomada.tablas, completa.tablas);
      assert.strictEqual(retomada.ultima?.estado, "completada");
    }),
  );

  it.effect("una baja exige dos barridos seguidos sin verla", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, registroOficial(grabada));

        yield* TestClock.adjust(DIA);
        yield* unaNoche(entorno, registroOficial(sinQuitado(grabada)));
        const trasUna = yield* registroDe(entorno);
        assert.strictEqual(trasUna.vigentes, 40);
        assert.strictEqual(trasUna.ultima?.cambios.observaciones.retirados, 0);

        yield* TestClock.adjust(DIA);
        const tercera = yield* unaNoche(entorno, registroOficial(sinQuitado(grabada)));
        const trasDos = yield* registroDe(entorno);
        assert.strictEqual(trasDos.vigentes, 39);
        assert.strictEqual(trasDos.ultima?.cambios.observaciones.retirados, 1);
        // La capa de esa noche ya no la tiene.
        assert.strictEqual(tercera.publicacion.tipo, "publicada");
        const publicado = publicadoEn(yield* contenidoDe(entorno.almacen));
        assert.strictEqual(publicado.vigente.version, versionDeCapa(NOCHE + 2 * DIA));
        assert.isFalse(
          publicado.emplazamientos.some((e) => e.emplazamiento.clave === "vodafone-079808"),
        );
        assert.isFalse(publicado.emplazamientos.some((e) => e.lote.includes("vodafone-079808")));
      }),
    ),
  );

  it.effect(
    "copia la base al acabar; la copia se abre y se restaura, y solo quedan las catorce últimas",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          const r2 = yield* copiasDePrueba;
          let ultima: string | undefined;
          for (let noche = 0; noche < COPIAS_CONSERVADAS + 2; noche++) {
            const hecha = yield* unaNoche(entorno, registroOficial(grabada), {
              copiasEnR2: r2.capa,
            });
            ultima = hecha.copia;
            assert.deepStrictEqual(hecha.copiaEnR2, {
              tipo: "subida",
              nombre: `${path.basename(ultima ?? "")}.gz`,
              retiradas: noche < COPIAS_CONSERVADAS ? 0 : 1,
            });
            yield* TestClock.adjust(DIA);
          }
          const copias = (yield* fs.readDirectory(entorno.copias)).toSorted();
          assert.strictEqual(copias.length, COPIAS_CONSERVADAS);
          assert.isDefined(ultima);
          assert.strictEqual(path.join(entorno.copias, copias.at(-1) ?? ""), ultima);
          // Las dos primeras noches ya no tienen copia.
          assert.isFalse(copias.some((copia) => copia.includes("2026-09-26")));
          // En R2 quedan las mismas, comprimidas, y la última es la copia del disco.
          const enR2 = yield* r2.guardadas;
          assert.deepStrictEqual(
            [...enR2.keys()].toSorted(),
            copias.map((copia) => `${copia}.gz`),
          );
          assert.deepStrictEqual(
            [...(yield* descomprimir(enR2.get(`${copias.at(-1) ?? ""}.gz`) ?? new Uint8Array()))],
            [...(yield* fs.readFile(ultima ?? ""))],
          );

          const original = yield* resumenDe(entorno);
          const copiada = yield* conBase(
            ultima ?? "",
            Effect.flatMap(BaseNocturna, (base) => base.resumen),
          );
          assert.deepStrictEqual(copiada, original);

          // Se pierde la base y se restaura la última copia.
          yield* fs.remove(path.dirname(entorno.base), { recursive: true });
          yield* fs.makeDirectory(path.dirname(entorno.base), { recursive: true });
          yield* fs.copyFile(ultima ?? "", entorno.base);
          const tras = yield* unaNoche(entorno, registroOficial(grabada));
          // Los datos son los mismos; solo cambia la fecha del barrido.
          assert.strictEqual(tras.publicacion.tipo, "barrido");
          const fuente = yield* registroDe(entorno);
          assert.deepStrictEqual(fuente.ultima?.cambios.observaciones, SIN_CAMBIOS.observaciones);
        }),
      ),
  );

  it.effect("si la copia no llega a R2, la noche acaba bien y la sube la noche siguiente", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const r2 = yield* copiasDePrueba;
        yield* TestClock.setTime(NOCHE);
        yield* Ref.set(r2.caido, true);
        const primera = yield* unaNoche(entorno, registroOficial(grabada), {
          copiasEnR2: r2.capa,
        });
        assert.strictEqual(primera.publicacion.tipo, "publicada");
        assert.isDefined(primera.copia);
        assert.deepStrictEqual(primera.copiaEnR2, { tipo: "fallida", motivo: "R2 no contesta" });

        yield* Ref.set(r2.caido, false);
        yield* TestClock.adjust(DIA);
        const segunda = yield* unaNoche(entorno, registroOficial(grabada), {
          copiasEnR2: r2.capa,
        });
        assert.strictEqual(segunda.copiaEnR2.tipo, "subida");
        assert.lengthOf(yield* r2.guardadas, 1);

        // Sin cubo de R2, la copia se queda en el disco.
        yield* TestClock.adjust(DIA);
        const sinR2 = yield* unaNoche(entorno, registroOficial(grabada));
        assert.deepStrictEqual(sinR2.copiaEnR2, { tipo: "sin-subir" });
      }),
    ),
  );

  it.effect(
    "si publicar falla, los datos quedan en la base, se apunta y se reintenta al cabo de una hora",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const caido = yield* Ref.make(true);
          yield* TestClock.setTime(NOCHE);
          const fibra = yield* Effect.forkChild(
            unaNoche(entorno, registroOficial(yield* muestraCampusNord), {
              almacen: almacenCaido(entorno, caido),
            }),
          );
          yield* hasta(
            Effect.map(resumenDe(entorno), (r) => r.ultimoIntento?.resultado.tipo === "fallida"),
          );
          const caida = yield* resumenDe(entorno);
          assert.isAbove(caida.emplazamientos, 0);
          const ejecucion = caida.fuentes.find((f) => f.fuente === "registro-oficial")?.ultima;
          assert.strictEqual(ejecucion?.estado, "completada");
          assert.strictEqual(ejecucion?.publicacion?.tipo, "fallida");
          assert.deepStrictEqual(yield* entorno.escritos, []);

          yield* Ref.set(caido, false);
          const hecha = yield* hastaQueAcabe(fibra);
          assert.strictEqual(hecha.publicacion.tipo, "publicada");
          const final = yield* resumenDe(entorno);
          assert.strictEqual(final.publicada, VERSION);
          assert.isAtLeast(final.ultimoIntento?.fecha ?? 0, NOCHE + HORA);
          assert.isBelow(final.ultimoIntento?.fecha ?? 0, NOCHE + HORA + 10 * 60_000);
          const registro = final.fuentes.find((f) => f.fuente === "registro-oficial");
          assert.strictEqual(registro?.ultima?.publicacion?.tipo, "publicada");
        }),
      ),
  );

  it.effect("si al cabo de una hora sigue fallando, publica la noche siguiente", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const caido = yield* Ref.make(true);
        yield* TestClock.setTime(NOCHE);
        const fibra = yield* Effect.forkChild(
          unaNoche(entorno, registroOficial(grabada), { almacen: almacenCaido(entorno, caido) }),
        );
        yield* hasta(Effect.map(resumenDe(entorno), (r) => r.ultimoIntento !== undefined));
        const primera = yield* hastaQueAcabe(fibra);
        assert.strictEqual(primera.publicacion.tipo, "fallida");
        assert.deepStrictEqual(yield* entorno.escritos, []);

        yield* Ref.set(caido, false);
        yield* TestClock.setTime(NOCHE + DIA);
        const segunda = yield* unaNoche(entorno, registroOficial(grabada), {
          almacen: almacenCaido(entorno, caido),
        });
        // Los datos no han cambiado: se publica la versión de la noche anterior.
        assert.strictEqual(segunda.publicacion.tipo, "publicada");
        assert.strictEqual(
          segunda.publicacion.tipo === "publicada" ? segunda.publicacion.version : "",
          VERSION,
        );
      }),
    ),
  );

  it.effect("con el interruptor apagado la ejecución queda omitida y no pide nada", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, registroOficial(grabada));
        const almacenAntes = yield* contenidoDe(entorno.almacen);

        const llamadas = yield* Ref.make(0);
        const vigilado = Layer.effect(
          ExtractorPorCajas,
          Effect.map(ExtractorPorCajas, (real) =>
            ExtractorPorCajas.of({
              ...real,
              caja: (caja) =>
                Effect.andThen(
                  Ref.update(llamadas, (n) => n + 1),
                  real.caja(caja),
                ),
              ficha: (registro) =>
                Effect.andThen(
                  Ref.update(llamadas, (n) => n + 1),
                  real.ficha(registro),
                ),
            }),
          ),
        ).pipe(Layer.provide(registroOficial(sinQuitado(grabada))));
        yield* TestClock.adjust(DIA);
        const apagada = yield* unaNoche(entorno, vigilado, {
          interruptores: {
            ...INTERRUPTOR_POR_DEFECTO,
            "registro-oficial": { activo: false, motivo: "la fuente ha cambiado de formato" },
          },
        });

        assert.deepStrictEqual(
          apagada.ejecuciones.map((e) => e.estado),
          ["omitida"],
        );
        assert.strictEqual(yield* Ref.get(llamadas), 0);
        assert.strictEqual(apagada.publicacion.tipo, "al-dia");
        assert.deepStrictEqual(yield* contenidoDe(entorno.almacen), almacenAntes);
        const fuente = yield* registroDe(entorno);
        assert.strictEqual(fuente.ultima?.estado, "omitida");
        assert.deepStrictEqual(fuente.ultima?.errores, [
          "Interruptor apagado: la fuente ha cambiado de formato",
        ]);
        assert.strictEqual(fuente.vigentes, 40);
      }),
    ),
  );

  it.effect(
    "el estado dice la última ejecución, las fichas que le quedan a la ronda, también durante una ejecución, la próxima ejecución y los errores",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          // Tres fichas que la fuente no da: tres errores seguidos y las demás, pendientes.
          const sinFichas: FuenteGrabada = {
            ...grabada,
            fichas: new Map(
              [...grabada.fichas].filter(
                ([clave]) =>
                  !grabada.listado.registros
                    .slice(0, 3)
                    .some((registro) => registro.clave === clave),
              ),
            ),
          };
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, registroOficial(sinFichas), { proceso: EN_RONDAS });

          const { resumen, turno } = yield* conBase(entorno.base, estado(EN_RONDAS, CALENDARIO));
          const fuente = resumen.fuentes.find((f) => f.fuente === "registro-oficial");
          assert.strictEqual(fuente?.ultima?.errores.length, 4);
          // Las tres que han fallado esperan a la ronda siguiente; las demás siguen en la cola.
          assert.deepStrictEqual(turno.cola, { nuevas: 37, porReleer: 0, enEspera: 3 });
          const texto = describirResumen(entorno.base, resumen, turno);
          assert.include(texto, "registro-oficial: encendida");
          assert.include(texto, "2026-09-26 02:15:00 UTC, completada, 40 registros en el listado");
          assert.include(texto, "Observaciones vigentes: 40\n");
          assert.include(
            texto,
            "Fichas por leer en la ronda: 37 sin leer, 0 por releer, 3 esperando tras fallar",
          );
          assert.include(texto, "- cataluna: último barrido completado 2026-09-26 02:15:00 UTC");
          assert.include(
            texto,
            "fichas por leer: 37 sin leer, 0 por releer, 3 esperando tras fallar",
          );
          assert.include(texto, "Errores (4):");
          assert.include(texto, "Fichas paradas: 3 fallos seguidos");
          // El 26 de septiembre es el último sábado del mes: la próxima es la del primero de octubre.
          assert.include(
            texto,
            "Próxima ejecución: el sábado 3/10/2026 a las 00:30 (Europe/Madrid). Empieza otra " +
              "ronda, en la que barre su zona y lee todas las fichas",
          );
          assert.include(texto, `Última versión publicada: ${VERSION}`);
          // La comunidad no tiene interruptor: sale sin «encendida» ni «apagada».
          assert.include(texto, "\ncomunidad\n  Ninguna ejecución todavía");

          // Durante una ejecución, la orden dice cuántas fichas le quedan a la ronda.
          yield* conBase(
            entorno.base,
            Effect.flatMap(BaseDeBarrido, (base) => base.iniciar("registro-oficial", NOCHE + HORA)),
          );
          yield* TestClock.setTime(NOCHE + 2 * HORA);
          const enCurso = yield* conBase(entorno.base, estado(EN_RONDAS, CALENDARIO));
          assert.include(
            describirResumen(entorno.base, enCurso.resumen, enCurso.turno),
            "Última ejecución: 2026-09-26 03:15:00 UTC, en curso; le quedan 37 fichas por leer de la ronda",
          );
        }),
      ),
  );

  it.effect("la configuración trae los valores de producción y se cambia desde fuera", () =>
    Effect.gen(function* () {
      const porDefecto = yield* configuracion.parse(ConfigProvider.fromEnv({ env: {} }));
      assert.strictEqual(porDefecto.base, "datos/ingesta.sqlite");
      assert.deepStrictEqual(porDefecto.noche.proceso.fichas, OPCIONES_FICHAS);
      // Una ficha por segundo durante 22 horas, con un tope que nunca corta antes que la ventana.
      assert.strictEqual(Duration.toSeconds(porDefecto.noche.proceso.fichas.ritmo), 1);
      assert.strictEqual(Duration.toHours(porDefecto.noche.proceso.fichas.ventana), 22);
      assert.strictEqual(Duration.toSeconds(porDefecto.fichasDelRegistro.pausa), 1);
      assert.strictEqual(porDefecto.fichasDelRegistro.maxPeticiones, 79_200);
      // Lo leído hace menos de día y medio no se repite: el domingo solo lee lo que quedó.
      assert.strictEqual(Duration.toHours(porDefecto.noche.proceso.reciente), 36);
      assert.deepStrictEqual(porDefecto.noche.calendario, {
        minuto: 30,
        zonaHoraria: "Europe/Madrid",
      });
      assert.strictEqual(Duration.toMinutes(porDefecto.noche.reintento), 60);
      assert.deepStrictEqual(porDefecto.noche.copias, { carpeta: "datos/copias", conservar: 14 });
      assert.strictEqual(Duration.toSeconds(porDefecto.registroOficial.pausa), 3);
      assert.strictEqual(porDefecto.registroOficial.maxPeticiones, 400);
      assert.strictEqual(porDefecto.registroOficial.reintentos, 3);
      assert.strictEqual(
        porDefecto.registroOficial.userAgent,
        "Celda (ingesta; contacto en celda.elies.site)",
      );
      assert.deepStrictEqual(porDefecto.interruptores, INTERRUPTOR_POR_DEFECTO);
      // Toda España en cada ronda: las siete zonas, en su orden.
      assert.deepStrictEqual(
        porDefecto.noche.proceso.zonas.map((zona) => zona.nombre),
        ["cataluna", "centro", "andalucia", "levante", "norte", "ebro-y-duero", "oeste-y-canarias"],
      );

      const cambiada = yield* configuracion.parse(
        ConfigProvider.fromEnv({
          env: {
            CELDA_INGESTA_BASE: "/var/lib/celda/ingesta.sqlite",
            CELDA_INGESTA_MAX_FICHAS: "5",
            CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS: "5",
            CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS: "120",
            CELDA_PUBLICAR_REINTENTO_MINUTOS: "30",
            CELDA_REGISTRO_PAUSA_SEGUNDOS: "1",
            CELDA_REGISTRO_USER_AGENT: "Celda (pruebas)",
            CELDA_REGISTRO_ACTIVO: "false",
            CELDA_REGISTRO_ZONAS: "cataluna, centro,andalucia",
            CELDA_INGESTA_HORA: "01:15",
            CELDA_INGESTA_ZONA_HORARIA: "Atlantic/Canary",
          },
        }),
      );
      assert.strictEqual(cambiada.base, "/var/lib/celda/ingesta.sqlite");
      assert.strictEqual(cambiada.noche.proceso.fichas.maximo, 5);
      assert.strictEqual(Duration.toSeconds(cambiada.noche.proceso.fichas.ritmo), 5);
      assert.strictEqual(Duration.toMinutes(cambiada.noche.proceso.fichas.ventana), 120);
      assert.deepStrictEqual(cambiada.noche.calendario, {
        minuto: 75,
        zonaHoraria: "Atlantic/Canary",
      });
      assert.strictEqual(Duration.toSeconds(cambiada.fichasDelRegistro.pausa), 5);
      // Las que caben en 120 minutos a una cada 5 s.
      assert.strictEqual(cambiada.fichasDelRegistro.maxPeticiones, 1440);
      assert.strictEqual(Duration.toMinutes(cambiada.noche.reintento), 30);
      // Nunca por debajo de 3 s entre peticiones.
      assert.strictEqual(Duration.toSeconds(cambiada.registroOficial.pausa), 3);
      assert.strictEqual(cambiada.registroOficial.userAgent, "Celda (pruebas)");
      assert.isFalse(cambiada.interruptores["registro-oficial"]?.activo);
      assert.deepStrictEqual(
        cambiada.noche.proceso.zonas.map((zona) => zona.nombre),
        ["cataluna", "centro", "andalucia"],
      );

      // Una zona que no existe es un error de configuración, no una zona vacía.
      const mal = yield* Effect.flip(
        configuracion.parse(ConfigProvider.fromEnv({ env: { CELDA_REGISTRO_ZONAS: "catalunya" } })),
      );
      assert.include(mal.message, "zonas de barrido desconocidas: catalunya");

      // Las fichas pueden ir más despacio, pero nunca más deprisa que una por segundo.
      const despacio = yield* configuracion.parse(
        ConfigProvider.fromEnv({ env: { CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS: "3" } }),
      );
      assert.strictEqual(Duration.toSeconds(despacio.fichasDelRegistro.pausa), 3);
      assert.strictEqual(despacio.fichasDelRegistro.maxPeticiones, 26_400);
      const deprisa = yield* configuracion.parse(
        ConfigProvider.fromEnv({ env: { CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS: "0" } }),
      );
      assert.strictEqual(Duration.toSeconds(deprisa.noche.proceso.fichas.ritmo), 1);
      assert.strictEqual(Duration.toSeconds(deprisa.fichasDelRegistro.pausa), 1);

      // La hora va con dos cifras y la zona horaria es una de la IANA.
      const hora = yield* Effect.flip(
        configuracion.parse(ConfigProvider.fromEnv({ env: { CELDA_INGESTA_HORA: "0:30" } })),
      );
      assert.include(hora.message, "«0:30» no es una hora del día como 00:30");
      const zona = yield* Effect.flip(
        configuracion.parse(
          ConfigProvider.fromEnv({ env: { CELDA_INGESTA_ZONA_HORARIA: "Madrid" } }),
        ),
      );
      assert.include(
        zona.message,
        "«Madrid» no es una zona horaria de la base de datos de la IANA",
      );
    }),
  );
});
