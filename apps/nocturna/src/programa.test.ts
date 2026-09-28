// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  decodificarVigente,
  FICHERO_VIGENTE,
  ficheroDeLote,
  leerCapa,
  versionDeCapa,
} from "@celda/dominio/capa";
import { leerLote } from "@celda/dominio/loteDeFichas";
import { INTERRUPTOR_POR_DEFECTO, SIN_CAMBIOS } from "@celda/ingesta/ejecucion";
import { ExtractorPorCajas } from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS, Provincias } from "@celda/ingesta/fichas";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { AlmacenDeFicheros, AlmacenNoDisponible } from "@celda/publicacion/almacen";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
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
import { configuracion, COPIAS_CONSERVADAS } from "./configuracion.ts";
import { describirResumen } from "./estado.ts";
import { estado, provinciasDe } from "./programa.ts";
import {
  conBase,
  conEntorno,
  contenidoDe,
  type Entorno,
  OPCIONES_BARRIDO,
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

/** El resumen de la base del entorno, como lo ve la orden `estado`. */
const resumenDe = (entorno: Entorno) =>
  conBase(
    entorno.base,
    Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)),
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
      yield* TestClock.withLive(Effect.sleep("5 millis"));
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

describe("ingesta nocturna (base SQLite, almacén en carpeta, registro oficial grabado)", () => {
  it.effect("una noche lee el listado y las fichas, fusiona y publica la capa y sus fichas", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        const hecha = yield* unaNoche(entorno, registroOficial(yield* muestraCampusNord));

        assert.deepStrictEqual(
          hecha.ejecuciones.map((e) => [e.fuente, e.estado]),
          [
            ["registro-oficial", "completada"],
            // antenasmoviles.es empieza apagado.
            ["antenasmoviles", "omitida"],
          ],
        );
        assert.strictEqual(hecha.publicacion.tipo, "publicada");
        // Los lotes, la capa y, al final, vigente.json.
        const escritos = yield* entorno.escritos;
        assert.strictEqual(escritos.at(-2), `${VERSION}.json`);
        assert.strictEqual(escritos.at(-1), FICHERO_VIGENTE);

        const almacen = yield* contenidoDe(entorno.almacen);
        const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
        assert.isTrue(Result.isSuccess(vigente));
        const capa = leerCapa(almacen.get(`${VERSION}.json`) ?? "", VERSION);
        if (Result.isFailure(capa)) return assert.fail(capa.failure.message);
        for (const emplazamiento of capa.success.emplazamientos) {
          const lote = leerLote(
            almacen.get(ficheroDeLote(VERSION, emplazamiento.lote ?? -1)) ?? "",
            VERSION,
            emplazamiento.lote ?? -1,
          );
          if (Result.isFailure(lote)) return assert.fail(lote.failure.message);
          assert.isTrue(lote.success.fichas.some((f) => f.clave === emplazamiento.clave));
        }

        const fuente = yield* registroDe(entorno);
        assert.strictEqual(fuente.ultima?.estado, "completada");
        assert.strictEqual(fuente.ultima?.registros, 40);
        assert.strictEqual(fuente.ultima?.cambios.fichas.leidas, 40);
        assert.strictEqual(fuente.ultima?.publicacion?.tipo, "publicada");
        assert.strictEqual(fuente.vigentes, 40);
        assert.strictEqual(fuente.sinLeer, 0);
        assert.isDefined(hecha.copia);
      }),
    ),
  );

  it.effect("repetir la noche sin cambios no escribe nada en el almacén", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, registroOficial(grabada));
        const antes = yield* entorno.escritos;
        const almacenAntes = yield* contenidoDe(entorno.almacen);

        yield* TestClock.adjust(DIA);
        const segunda = yield* unaNoche(entorno, registroOficial(grabada));
        assert.strictEqual(segunda.publicacion.tipo, "al-dia");
        assert.deepStrictEqual(yield* entorno.escritos, antes);
        assert.deepStrictEqual(yield* contenidoDe(entorno.almacen), almacenAntes);
        const fuente = yield* registroDe(entorno);
        assert.deepStrictEqual(fuente.ultima?.cambios, SIN_CAMBIOS);
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
        const almacen = yield* contenidoDe(entorno.almacen);
        const version = versionDeCapa(NOCHE + 2 * DIA);
        const lotes = [...almacen]
          .filter(([fichero]) => fichero.startsWith(`fichas@${version.slice("sitios@".length)}/`))
          .map(([, contenido]) => contenido);
        assert.isAbove(lotes.length, 0);
        assert.isFalse(lotes.some((lote) => lote.includes(QUITADO)));
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
          let ultima: string | undefined;
          for (let noche = 0; noche < COPIAS_CONSERVADAS + 2; noche++) {
            ultima = (yield* unaNoche(entorno, registroOficial(grabada))).copia;
            yield* TestClock.adjust(DIA);
          }
          const copias = (yield* fs.readDirectory(entorno.copias)).toSorted();
          assert.strictEqual(copias.length, COPIAS_CONSERVADAS);
          assert.isDefined(ultima);
          assert.strictEqual(path.join(entorno.copias, copias.at(-1) ?? ""), ultima);
          // Las dos primeras noches ya no tienen copia.
          assert.isFalse(copias.some((copia) => copia.includes("2026-09-26")));

          const original = yield* resumenDe(entorno);
          const copiada = yield* conBase(
            ultima ?? "",
            Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)),
          );
          assert.deepStrictEqual(copiada, original);

          // Se pierde la base y se restaura la última copia.
          yield* fs.remove(path.dirname(entorno.base), { recursive: true });
          yield* fs.makeDirectory(path.dirname(entorno.base), { recursive: true });
          yield* fs.copyFile(ultima ?? "", entorno.base);
          const tras = yield* unaNoche(entorno, registroOficial(grabada));
          assert.strictEqual(tras.publicacion.tipo, "al-dia");
          const fuente = yield* registroDe(entorno);
          assert.deepStrictEqual(fuente.ultima?.cambios.observaciones, SIN_CAMBIOS.observaciones);
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
          ["omitida", "omitida"],
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
    "el estado dice la última ejecución, las fichas que quedan en la cola y los errores",
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
          yield* unaNoche(entorno, registroOficial(sinFichas));

          const provincias = provinciasDe((yield* zonasDePublicacion).municipios);
          const { resumen, cola } = yield* conBase(
            entorno.base,
            estado(OPCIONES_BARRIDO).pipe(Effect.provideService(Provincias, provincias)),
          );
          const fuente = resumen.fuentes.find((f) => f.fuente === "registro-oficial");
          assert.strictEqual(fuente?.sinLeer, 40);
          assert.strictEqual(fuente?.ultima?.errores.length, 4);
          // Las tres que han fallado esperan un día; las demás siguen en la cola.
          assert.deepStrictEqual(cola, [
            {
              grupo: { tipo: "provincia", provincia: "08" },
              nuevas: 37,
              porReleer: 0,
              enEspera: 3,
            },
          ]);
          const texto = describirResumen(entorno.base, resumen, cola, provincias.nombreDe);
          assert.include(texto, "registro-oficial: encendida");
          assert.include(texto, "2026-09-26 02:15:00 UTC, completada, 40 registros en el listado");
          assert.include(texto, "fichas pendientes: 40 sin leer");
          assert.include(
            texto,
            "provincia 08 (Barcelona): 37 sin leer, 0 por releer, 3 esperando tras fallar",
          );
          assert.include(texto, "Errores (4):");
          assert.include(texto, "Fichas paradas hasta la próxima noche: 3 fallos seguidos");
          assert.include(texto, `Última versión publicada: ${VERSION}`);
          assert.include(texto, "antenasmoviles: apagada");
        }),
      ),
  );

  it.effect("la configuración trae los valores de hoy y se cambia desde fuera", () =>
    Effect.gen(function* () {
      const porDefecto = yield* configuracion.parse(ConfigProvider.fromEnv({ env: {} }));
      assert.strictEqual(porDefecto.base, "datos/ingesta.sqlite");
      assert.deepStrictEqual(porDefecto.noche.proceso.fichas, OPCIONES_FICHAS);
      // Las fichas van a su ritmo, con un tope que nunca corta antes que la ventana.
      assert.strictEqual(Duration.toSeconds(porDefecto.fichasDelRegistro.pausa), 3);
      assert.strictEqual(porDefecto.fichasDelRegistro.maxPeticiones, 7200);
      assert.strictEqual(Duration.toMinutes(porDefecto.noche.reintento), 60);
      assert.deepStrictEqual(porDefecto.noche.copias, { carpeta: "datos/copias", conservar: 14 });
      assert.strictEqual(Duration.toSeconds(porDefecto.registroOficial.pausa), 3);
      assert.strictEqual(porDefecto.registroOficial.maxPeticiones, 300);
      assert.strictEqual(porDefecto.registroOficial.reintentos, 3);
      assert.strictEqual(
        porDefecto.registroOficial.userAgent,
        "Celda (ingesta; contacto en celda.elies.site)",
      );
      assert.deepStrictEqual(porDefecto.interruptores, INTERRUPTOR_POR_DEFECTO);
      assert.deepStrictEqual(
        porDefecto.noche.proceso.zonas.cadaNoche.map((zona) => zona.nombre),
        ["cataluna"],
      );
      assert.deepStrictEqual(porDefecto.noche.proceso.zonas.enTurno, []);
      assert.strictEqual(porDefecto.noche.proceso.zonas.porNoche, 1);

      const cambiada = yield* configuracion.parse(
        ConfigProvider.fromEnv({
          env: {
            CELDA_INGESTA_BASE: "/var/lib/celda/ingesta.sqlite",
            CELDA_INGESTA_MAX_FICHAS: "5",
            CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS: "5",
            CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS: "120",
            CELDA_REGISTRO_FICHAS_RELECTURA_DIAS: "14",
            CELDA_REGISTRO_FICHAS_PRIORIDAD: "08, 17",
            CELDA_PUBLICAR_REINTENTO_MINUTOS: "30",
            CELDA_REGISTRO_PAUSA_SEGUNDOS: "1",
            CELDA_REGISTRO_USER_AGENT: "Celda (pruebas)",
            CELDA_REGISTRO_ACTIVO: "false",
            CELDA_REGISTRO_ZONAS: "ninguna",
            CELDA_REGISTRO_ZONAS_EN_TURNO: "cataluna, centro,andalucia",
            CELDA_REGISTRO_ZONAS_POR_NOCHE: "2",
          },
        }),
      );
      assert.strictEqual(cambiada.base, "/var/lib/celda/ingesta.sqlite");
      assert.strictEqual(cambiada.noche.proceso.fichas.maximo, 5);
      assert.strictEqual(Duration.toSeconds(cambiada.noche.proceso.fichas.ritmo), 5);
      assert.strictEqual(Duration.toMinutes(cambiada.noche.proceso.fichas.ventana), 120);
      assert.strictEqual(Duration.toDays(cambiada.noche.proceso.fichas.relectura), 14);
      assert.deepStrictEqual(cambiada.noche.proceso.fichas.prioridad, ["08", "17"]);
      assert.strictEqual(Duration.toSeconds(cambiada.fichasDelRegistro.pausa), 5);
      assert.strictEqual(cambiada.fichasDelRegistro.maxPeticiones, 2400);
      assert.strictEqual(Duration.toMinutes(cambiada.noche.reintento), 30);
      // Nunca por debajo de 3 s entre peticiones.
      assert.strictEqual(Duration.toSeconds(cambiada.registroOficial.pausa), 3);
      assert.strictEqual(cambiada.registroOficial.userAgent, "Celda (pruebas)");
      assert.isFalse(cambiada.interruptores["registro-oficial"].activo);
      assert.deepStrictEqual(cambiada.noche.proceso.zonas.cadaNoche, []);
      assert.deepStrictEqual(
        cambiada.noche.proceso.zonas.enTurno.map((zona) => zona.nombre),
        ["cataluna", "centro", "andalucia"],
      );
      assert.strictEqual(cambiada.noche.proceso.zonas.porNoche, 2);

      // Una zona que no existe es un error de configuración, no una zona vacía.
      const mal = yield* Effect.flip(
        configuracion.parse(ConfigProvider.fromEnv({ env: { CELDA_REGISTRO_ZONAS: "catalunya" } })),
      );
      assert.include(mal.message, "zonas de barrido desconocidas: catalunya");

      // El mínimo de 3 s entre fichas se mantiene, y una provincia se escribe con su código INE.
      const deprisa = yield* configuracion.parse(
        ConfigProvider.fromEnv({ env: { CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS: "1" } }),
      );
      assert.strictEqual(Duration.toSeconds(deprisa.noche.proceso.fichas.ritmo), 3);
      assert.strictEqual(Duration.toSeconds(deprisa.fichasDelRegistro.pausa), 3);
      const provincia = yield* Effect.flip(
        configuracion.parse(
          ConfigProvider.fromEnv({ env: { CELDA_REGISTRO_FICHAS_PRIORIDAD: "Barcelona" } }),
        ),
      );
      assert.include(provincia.message, "códigos de provincia que no son dos cifras del INE");
    }),
  );
});
