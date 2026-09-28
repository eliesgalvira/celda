// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type DetalleDePunto,
  ExtractorDePuntos,
  FuenteNoDisponible,
  type Punto,
} from "@celda/ingesta/extractor";
import {
  capaDePuntosGrabada,
  muestraAntenasMoviles,
  PUNTO_CAMPUS,
  PUNTO_TARRAGONA,
  PUNTO_URQUINAONA,
  type PuntosGrabados,
} from "@celda/ingesta/pruebas/antenasmoviles";
import { capaGrabada, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import refs from "../confect/_generated/refs";
import crons from "../confect/crons";
import { SIN_CAMBIOS } from "@celda/ingesta/ejecucion";
import { INTERRUPTOR_POR_DEFECTO } from "@celda/ingesta/ejecucion";
import { OPCIONES_PROCESO_DE_PUNTOS } from "../src/proceso";
import { ejecutar, ejecutarDePuntos, instantanea } from "./ayudas";
import * as TestConfect from "./TestConfect";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const HORA = 3_600_000;
const DIA = 86_400_000;

const conConvex = <A, E, R>(efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(Layer.merge(TestConfect.layer, NodeServices.layer)));

const SIN_PUNTOS = { creados: 0, cambiados: 0, retirados: 0 };

/** El registro oficial de Campus Nord a las 2:15 y antenasmoviles.es encendido. */
const conRegistroYFuenteEncendida = Effect.gen(function* () {
  const convex = yield* TestConfect.TestConfect;
  yield* TestClock.setTime(NOCHE);
  yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));
  yield* convex.mutation(refs.internal.ingesta.cambiarInterruptor, {
    fuente: "antenasmoviles",
    activo: true,
    motivo: "prueba",
  });
  yield* TestClock.adjust(HORA);
  return yield* muestraAntenasMoviles;
});

/** La muestra con los puntos cambiados por `cambiar` y los detalles de `detalles`. */
const conCambios = (
  grabada: PuntosGrabados,
  cambiar: (puntos: ReadonlyArray<Punto>) => ReadonlyArray<Punto>,
  detalles: ReadonlyArray<readonly [string, DetalleDePunto]> = [],
): PuntosGrabados => ({
  listado: { ...grabada.listado, puntos: cambiar(grabada.listado.puntos) },
  detalles: new Map([...grabada.detalles, ...detalles]),
});

describe("ingesta de antenasmoviles.es (API de Convex en memoria)", () => {
  it.effect(
    "empieza apagada: queda omitida sin pedir nada y el registro oficial sigue a lo suyo",
    () =>
      conConvex(
        Effect.gen(function* () {
          const convex = yield* TestConfect.TestConfect;
          yield* TestClock.setTime(NOCHE);
          const registro = yield* muestraCampusNord;
          yield* ejecutar(capaGrabada("registro-oficial", registro));
          const antes = yield* instantanea;

          const llamadas = yield* Ref.make(0);
          const vigilado = Layer.effect(
            ExtractorDePuntos,
            Effect.gen(function* () {
              const real = yield* ExtractorDePuntos;
              return ExtractorDePuntos.of({
                ...real,
                puntos: Effect.andThen(
                  Ref.update(llamadas, (n) => n + 1),
                  real.puntos,
                ),
              });
            }),
          ).pipe(Layer.provide(capaDePuntosGrabada(yield* muestraAntenasMoviles)));
          yield* TestClock.adjust(HORA);
          const omitida = yield* ejecutarDePuntos(vigilado);
          assert.strictEqual(omitida.estado, "omitida");
          assert.deepStrictEqual(omitida.errores, [
            `Interruptor apagado: ${INTERRUPTOR_POR_DEFECTO.antenasmoviles.motivo}`,
          ]);
          assert.strictEqual(yield* Ref.get(llamadas), 0);
          assert.deepStrictEqual(yield* instantanea, antes);

          const estados = yield* convex.query(refs.internal.ingesta.estado);
          assert.deepStrictEqual(
            estados.map((e) => [e.fuente, e.activo]),
            [
              ["registro-oficial", true],
              ["antenasmoviles", false],
              ["opencellid", false],
            ],
          );

          // El interruptor de antenasmoviles.es no toca el del registro oficial.
          yield* TestClock.adjust(DIA);
          const registroOtraNoche = yield* ejecutar(capaGrabada("registro-oficial", registro));
          assert.strictEqual(registroOtraNoche.estado, "completada");
        }),
      ),
  );

  it.effect(
    "encendida, guarda los puntos y las correcciones, y la segunda ejecución no escribe nada",
    () =>
      conConvex(
        Effect.gen(function* () {
          const convex = yield* TestConfect.TestConfect;
          const grabada = yield* conRegistroYFuenteEncendida;
          const primera = yield* ejecutarDePuntos(capaDePuntosGrabada(grabada));
          assert.strictEqual(primera.estado, "completada");
          assert.strictEqual(primera.registros, 43);
          assert.deepStrictEqual(primera.cambios.puntos, {
            creados: 43,
            cambiados: 0,
            retirados: 0,
          });
          assert.deepStrictEqual(primera.cambios.fichas, { leidas: 43, cambiadas: 3 });
          assert.deepStrictEqual(primera.cambios.observaciones, {
            creados: 3,
            cambiados: 0,
            retirados: 0,
          });
          // Campus Nord cambia de estado; las dos ER5 son emplazamientos nuevos.
          assert.deepStrictEqual(primera.cambios.emplazamientos, {
            creados: 2,
            cambiados: 1,
            retirados: 0,
          });

          const campus = yield* convex.query(refs.internal.datos.ficha, {
            clave: "movistar-0802532",
          });
          assert.isTrue(Option.isSome(campus));
          if (Option.isSome(campus)) {
            assert.strictEqual(campus.value.estado, "corregido");
            assert.strictEqual(campus.value.version, NOCHE + HORA);
            const vodafone = campus.value.estaciones.find((e) => e.compania === "vodafone");
            assert.deepStrictEqual(
              vodafone?.origenes.map((o) => [o.fuente, o.afirma, o.url.slice(0, 30)]),
              [
                ["registro-oficial", "presente", "https://geoportal.minetur.gob."],
                ["registro-oficial", "presente", "https://geoportal.minetur.gob."],
                ["antenasmoviles", "desmontada", "https://antenasmoviles.es/#19/"],
              ],
            );
          }
          const tarragona = yield* convex.query(refs.internal.datos.ficha, {
            clave: "movistar-MV-BCN-82383",
          });
          assert.strictEqual(
            Option.map(tarragona, (f) => f.estado).pipe(Option.getOrNull),
            "nuevo",
          );
          assert.deepStrictEqual((yield* convex.query(refs.internal.datos.version)).consultas, [
            { fuente: "registro-oficial", consultadoEl: NOCHE },
            { fuente: "antenasmoviles", consultadoEl: NOCHE + HORA },
          ]);
          const antes = yield* instantanea;

          yield* TestClock.adjust(DIA);
          const segunda = yield* ejecutarDePuntos(capaDePuntosGrabada(grabada));
          assert.strictEqual(segunda.estado, "completada");
          assert.deepStrictEqual(segunda.cambios, { ...SIN_CAMBIOS, puntos: SIN_PUNTOS });
          // Con el reloj un día más tarde, cualquier escritura habría cambiado una fecha.
          assert.deepStrictEqual(yield* instantanea, antes);
        }),
      ),
  );

  it.effect("solo relee el punto que cambia de huella, y retira la corrección que ya no sale", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* conRegistroYFuenteEncendida;
        yield* ejecutarDePuntos(capaDePuntosGrabada(grabada));
        const antes = yield* instantanea;

        // Al día siguiente la entrada del campus tiene otra fila en el listado y ya no hay
        // ninguna foto que la dé por desmontada.
        const cambiada = conCambios(
          grabada,
          (puntos) =>
            puntos.map((p) => (p.clave === PUNTO_CAMPUS ? { ...p, huella: "otra huella" } : p)),
          [[PUNTO_CAMPUS, { observaciones: [], avisos: [] }]],
        );
        yield* TestClock.adjust(DIA);
        const segunda = yield* ejecutarDePuntos(capaDePuntosGrabada(cambiada));
        assert.deepStrictEqual(segunda.cambios.puntos, {
          creados: 0,
          cambiados: 1,
          retirados: 0,
        });
        assert.deepStrictEqual(segunda.cambios.fichas, { leidas: 1, cambiadas: 1 });
        assert.deepStrictEqual(segunda.cambios.observaciones, {
          creados: 0,
          cambiados: 0,
          retirados: 1,
        });
        const campus = yield* convex.query(refs.internal.datos.ficha, {
          clave: "movistar-0802532",
        });
        assert.deepStrictEqual(
          Option.map(campus, (f) => [f.estado, f.version]).pipe(Option.getOrNull),
          ["verificado", NOCHE + HORA + DIA],
        );
        // Los demás emplazamientos conservan su versión.
        const despues = yield* instantanea;
        const version = (clave: string, de: typeof antes) =>
          de.emplazamientos.find((e) => e.clave === clave)?.version;
        assert.strictEqual(
          version("movistar-MV-BCN-82383", despues),
          version("movistar-MV-BCN-82383", antes),
        );
      }),
    ),
  );

  it.effect("un punto que falta en dos barridos seguidos se retira con sus observaciones", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* conRegistroYFuenteEncendida;
        yield* ejecutarDePuntos(capaDePuntosGrabada(grabada));
        const sinTarragona = conCambios(grabada, (puntos) =>
          puntos.filter((p) => p.clave !== PUNTO_TARRAGONA),
        );

        yield* TestClock.adjust(DIA);
        const segunda = yield* ejecutarDePuntos(capaDePuntosGrabada(sinTarragona));
        assert.deepStrictEqual(segunda.cambios.observaciones.retirados, 0);
        assert.isTrue(
          Option.isSome(
            yield* convex.query(refs.internal.datos.ficha, { clave: "movistar-MV-BCN-82383" }),
          ),
        );

        yield* TestClock.adjust(DIA);
        const tercera = yield* ejecutarDePuntos(capaDePuntosGrabada(sinTarragona));
        assert.deepStrictEqual(tercera.cambios.puntos, {
          creados: 0,
          cambiados: 0,
          retirados: 1,
        });
        assert.strictEqual(tercera.cambios.observaciones.retirados, 1);
        assert.strictEqual(tercera.cambios.emplazamientos.retirados, 1);
        assert.isTrue(
          Option.isNone(
            yield* convex.query(refs.internal.datos.ficha, { clave: "movistar-MV-BCN-82383" }),
          ),
        );
      }),
    ),
  );

  it.effect("lee como mucho `maxDetalles` detalles por noche, las ER5 primero", () =>
    conConvex(
      Effect.gen(function* () {
        const grabada = yield* conRegistroYFuenteEncendida;
        const leidos = yield* Ref.make<ReadonlyArray<string>>([]);
        const vigilado = Layer.effect(
          ExtractorDePuntos,
          Effect.gen(function* () {
            const real = yield* ExtractorDePuntos;
            return ExtractorDePuntos.of({
              ...real,
              detalle: (punto) =>
                Effect.andThen(
                  Ref.update(leidos, (l) => [...l, punto.clave]),
                  real.detalle(punto),
                ),
            });
          }),
        ).pipe(Layer.provide(capaDePuntosGrabada(grabada)));
        const opciones = { ...OPCIONES_PROCESO_DE_PUNTOS, maxDetalles: 2 };

        const primera = yield* ejecutarDePuntos(vigilado, opciones);
        assert.deepStrictEqual([...(yield* Ref.get(leidos))].sort(), [
          PUNTO_URQUINAONA,
          PUNTO_TARRAGONA,
        ]);
        assert.strictEqual(primera.cambios.observaciones.creados, 2);

        yield* TestClock.adjust(DIA);
        const segunda = yield* ejecutarDePuntos(vigilado, opciones);
        assert.strictEqual(segunda.cambios.fichas.leidas, 2);
        assert.strictEqual((yield* Ref.get(leidos)).length, 4);
      }),
    ),
  );

  it.effect(
    "si la fuente bloquea los detalles, apunta el error y deja el resto para otra noche",
    () =>
      conConvex(
        Effect.gen(function* () {
          const grabada = yield* conRegistroYFuenteEncendida;
          const bloqueada = Layer.effect(
            ExtractorDePuntos,
            Effect.gen(function* () {
              const real = yield* ExtractorDePuntos;
              return ExtractorDePuntos.of({
                ...real,
                detalle: () =>
                  Effect.fail(
                    new FuenteNoDisponible({
                      url: "https://antenasmoviles.es/v1/markers?id=MV-BCN-82383",
                      motivo: "HTTP 403: la fuente parece estar bloqueando a Celda",
                    }),
                  ),
              });
            }),
          ).pipe(Layer.provide(capaDePuntosGrabada(grabada)));
          const ejecucion = yield* ejecutarDePuntos(bloqueada);
          assert.strictEqual(ejecucion.estado, "completada");
          assert.strictEqual(ejecucion.cambios.fichas.leidas, 0);
          assert.deepStrictEqual(ejecucion.errores, [
            "FuenteNoDisponible: HTTP 403: la fuente parece estar bloqueando a Celda (https://antenasmoviles.es/v1/markers?id=MV-BCN-82383)",
            "Detalles pendientes para la próxima ejecución",
          ]);
          // Los puntos quedan guardados y pendientes: la próxima noche se leen.
          const { puntos } = yield* instantanea;
          assert.strictEqual(puntos.length, 43);
          assert.isTrue(puntos.every((p) => p.detalleLeidoEn === null));
        }),
      ),
  );

  it("un cron de Convex lanza la ingesta de antenasmoviles.es cada noche, tras la del registro", () => {
    assert.deepStrictEqual(crons.convexCronJobs.crons["ingesta de antenasmoviles.es"], {
      name: "ingesta:antenasMoviles",
      args: [{}],
      schedule: { type: "cron", cron: "15 3 * * *" },
    });
  });
});
