// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { Extractor, FuenteNoDisponible, type Registro } from "@celda/ingesta/extractor";
import { capaGrabada, type FuenteGrabada, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import refs from "../confect/_generated/refs";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import crons from "../confect/crons";
import { SIN_CAMBIOS } from "../confect/tables/ejecuciones";
import { ejecutar, instantanea, sinSistema } from "./ayudas";
import * as TestConfect from "./TestConfect";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

/** Un Convex en memoria nuevo para cada prueba, y el sistema de ficheros para las muestras. */
const conConvex = <A, E, R>(efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(Layer.merge(TestConfect.layer, NodeServices.layer)));

const registroOficial = (grabada: FuenteGrabada) => capaGrabada("registro-oficial", grabada);

/** La muestra con el listado cambiado por `cambiar`. */
const conListado = (
  grabada: FuenteGrabada,
  cambiar: (registros: ReadonlyArray<Registro>) => ReadonlyArray<Registro>,
): FuenteGrabada => ({
  ...grabada,
  listado: { ...grabada.listado, registros: cambiar(grabada.listado.registros) },
});

const MOVIDO = "ORANGE ESPAGNE, S.A.U. - CATR0508Z";
const QUITADO = "VODAFONE ESPAÑA, S.A.U. - 079808";
const NUEVO: Registro = {
  clave: "DS MOBILE NETWORKS, S.L. - 0800143",
  compania: "digi",
  codigo: "0800143",
  posicion: { longitud: 2.096728, latitud: 41.36731 },
  direccion: "VP Esplugues, 28. HOSPITALET DE LLOBREGAT (L), BARCELONA",
  municipio: "HOSPITALET DE LLOBREGAT (L)",
  url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0800143",
};

/** Un día después: una estación se mueve 200 m, otra desaparece y aparece una de Digi. */
const unDiaDespues = (grabada: FuenteGrabada): FuenteGrabada => {
  const cambiada = conListado(grabada, (registros) => [
    ...registros
      .filter((r) => r.clave !== QUITADO)
      .map((r) =>
        r.clave === MOVIDO
          ? { ...r, posicion: { ...r.posicion, latitud: r.posicion.latitud + 0.0018 } }
          : r,
      ),
    NUEVO,
  ]);
  return { ...cambiada, fichas: new Map([...grabada.fichas, [NUEVO.clave, []]]) };
};

describe("ingesta del registro oficial (API de Convex en memoria)", () => {
  it.effect(
    "la primera ejecución lo crea todo y la segunda, con la misma fuente, no escribe nada",
    () =>
      conConvex(
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          const primera = yield* ejecutar(registroOficial(grabada));
          assert.strictEqual(primera.estado, "completada");
          assert.strictEqual(primera.registros, 40);
          assert.deepStrictEqual(primera.cambios.observaciones, {
            creados: 40,
            cambiados: 0,
            retirados: 0,
          });
          assert.strictEqual(primera.cambios.fichas.leidas, 40);
          assert.isAbove(primera.cambios.emplazamientos.creados, 0);
          const antes = yield* instantanea;

          yield* TestClock.adjust(DIA);
          const segunda = yield* ejecutar(registroOficial(grabada));
          assert.strictEqual(segunda.estado, "completada");
          assert.deepStrictEqual(segunda.cambios, SIN_CAMBIOS);
          // Con el reloj un día más tarde, cualquier escritura habría cambiado una fecha.
          assert.deepStrictEqual(yield* instantanea, antes);
        }),
      ),
  );

  it.effect("solo escribe lo que cambia, y una baja cuenta tras dos barridos sin verla", () =>
    conConvex(
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(registroOficial(grabada));
        const antes = yield* instantanea;

        yield* TestClock.adjust(DIA);
        const segunda = yield* ejecutar(registroOficial(unDiaDespues(grabada)));
        assert.deepStrictEqual(segunda.cambios.observaciones, {
          creados: 1,
          cambiados: 1,
          retirados: 0,
        });
        assert.deepStrictEqual(segunda.cambios.fichas, { leidas: 2, cambiadas: 0 });
        const despues = yield* instantanea;
        const fechaDe = (clave: string) =>
          despues.observaciones.find((o) => o.clave === clave)?.fecha;
        assert.strictEqual(fechaDe(MOVIDO), NOCHE + DIA);
        assert.strictEqual(fechaDe(NUEVO.clave), NOCHE + DIA);
        assert.strictEqual(fechaDe("ORANGE ESPAGNE, S.A.U. - CATR0228A"), NOCHE);
        // La que falta sigue vigente tras un solo barrido sin ella.
        const quitada = despues.observaciones.find((o) => o.clave === QUITADO);
        assert.strictEqual(quitada?.ausencias, 1);
        assert.isNull(quitada?.retiradaEn ?? null);
        // Los emplazamientos que no tocan los cambios conservan su versión.
        const intactos = despues.emplazamientos.filter((e) => e.version === NOCHE);
        assert.isAbove(intactos.length, antes.emplazamientos.length - 5);

        yield* TestClock.adjust(DIA);
        const tercera = yield* ejecutar(registroOficial(unDiaDespues(grabada)));
        assert.deepStrictEqual(tercera.cambios.observaciones, {
          creados: 0,
          cambiados: 0,
          retirados: 1,
        });
        const final = yield* instantanea;
        assert.strictEqual(
          final.observaciones.find((o) => o.clave === QUITADO)?.retiradaEn,
          NOCHE + 2 * DIA,
        );
      }),
    ),
  );

  it.effect("con el interruptor apagado la ejecución queda omitida y no toca los datos", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(registroOficial(grabada));
        const antes = yield* instantanea;

        yield* convex.mutation(refs.internal.ingesta.cambiarInterruptor, {
          fuente: "registro-oficial",
          activo: false,
          motivo: "la fuente ha cambiado de formato",
        });
        const llamadas = yield* Ref.make(0);
        const vigilado = Layer.effect(
          Extractor,
          Effect.gen(function* () {
            const real = yield* Extractor;
            return Extractor.of({
              ...real,
              listado: Effect.andThen(
                Ref.update(llamadas, (n) => n + 1),
                real.listado,
              ),
            });
          }),
        ).pipe(Layer.provide(registroOficial(unDiaDespues(grabada))));
        yield* TestClock.adjust(DIA);
        const omitida = yield* ejecutar(vigilado);

        assert.strictEqual(omitida.estado, "omitida");
        assert.deepStrictEqual(omitida.errores, [
          "Interruptor apagado: la fuente ha cambiado de formato",
        ]);
        assert.strictEqual(yield* Ref.get(llamadas), 0);
        assert.deepStrictEqual(yield* instantanea, antes);

        const [estado] = yield* convex.query(refs.public.ingesta.estado);
        assert.strictEqual(estado?.activo, false);
        assert.deepStrictEqual(
          estado?.ejecuciones.map((e) => e.estado),
          ["omitida", "completada"],
        );
      }),
    ),
  );

  it.effect("repetir una ejecución cortada deja lo mismo que una ejecución completa", () =>
    Effect.gen(function* () {
      const grabada = yield* muestraCampusNord.pipe(Effect.provide(NodeServices.layer));
      // Se corta en la quinta ficha, con el listado ya guardado y cuatro fichas leídas.
      const cortado = Layer.effect(
        Extractor,
        Effect.gen(function* () {
          const leidas = yield* Ref.make(0);
          const real = yield* Extractor;
          return Extractor.of({
            ...real,
            ficha: (registro) =>
              Effect.flatMap(
                Ref.updateAndGet(leidas, (n) => n + 1),
                (n) =>
                  n === 5 ? Effect.die("la acción se ha quedado sin tiempo") : real.ficha(registro),
              ),
          });
        }),
      ).pipe(Layer.provide(registroOficial(grabada)));
      yield* TestClock.setTime(NOCHE);

      const repetida = yield* Effect.gen(function* () {
        const salida = yield* Effect.exit(ejecutar(cortado));
        assert.strictEqual(salida._tag, "Failure");
        const final = yield* ejecutar(registroOficial(grabada));
        const convex = yield* TestConfect.TestConfect;
        const [estado] = yield* convex.query(refs.public.ingesta.estado);
        assert.deepStrictEqual(
          estado?.ejecuciones.map((e) => e.estado),
          ["completada", "interrumpida"],
        );
        return { final, datos: yield* instantanea };
      }).pipe(Effect.provide(TestConfect.layer));

      const completa = yield* Effect.gen(function* () {
        const final = yield* ejecutar(registroOficial(grabada));
        return { final, datos: yield* instantanea };
      }).pipe(Effect.provide(TestConfect.layer));

      const { datos: a } = repetida;
      const { datos: b } = completa;
      assert.deepStrictEqual(sinSistema(a.observaciones), sinSistema(b.observaciones));
      assert.deepStrictEqual(sinSistema(a.emplazamientos), sinSistema(b.emplazamientos));
      assert.deepStrictEqual(sinSistema(a.estaciones), sinSistema(b.estaciones));
      assert.deepStrictEqual(
        repetida.final.cambios.emplazamientos,
        completa.final.cambios.emplazamientos,
      );
    }),
  );

  it.effect(
    "si el listado falla, la ejecución queda fallida con su error y sin tocar los datos",
    () =>
      conConvex(
        Effect.gen(function* () {
          const convex = yield* TestConfect.TestConfect;
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* ejecutar(registroOficial(grabada));
          const antes = yield* instantanea;

          const caido = Layer.succeed(
            Extractor,
            Extractor.of({
              fuente: "registro-oficial",
              listado: Effect.fail(
                new FuenteNoDisponible({
                  url: "https://geoportal.minetur.gob.es/robots.txt",
                  motivo: "HTTP 503",
                }),
              ),
              ficha: () => Effect.succeed([]),
            }),
          );
          yield* TestClock.adjust(DIA);
          const fallida = yield* ejecutar(caido);
          assert.strictEqual(fallida.estado, "fallida");
          assert.deepStrictEqual(fallida.errores, [
            "FuenteNoDisponible: HTTP 503 (https://geoportal.minetur.gob.es/robots.txt)",
          ]);
          assert.strictEqual(fallida.fin, NOCHE + DIA);
          assert.deepStrictEqual(yield* instantanea, antes);

          const [estado] = yield* convex.query(refs.public.ingesta.estado);
          assert.deepStrictEqual(
            estado?.ejecuciones.map((e) => [e.estado, e.inicio]),
            [
              ["fallida", NOCHE + DIA],
              ["completada", NOCHE],
            ],
          );
        }),
      ),
  );

  it.effect("expone la versión de los datos y la fecha de cada emplazamiento", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* muestraCampusNord;
        assert.deepStrictEqual(yield* convex.query(refs.public.datos.version), {
          version: null,
          consultas: [],
        });

        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(registroOficial(grabada));
        assert.deepStrictEqual(yield* convex.query(refs.public.datos.version), {
          version: NOCHE,
          consultas: [{ fuente: "registro-oficial", consultadoEl: NOCHE }],
        });

        yield* TestClock.adjust(DIA);
        yield* ejecutar(registroOficial(unDiaDespues(grabada)));
        assert.deepStrictEqual(yield* convex.query(refs.public.datos.version), {
          version: NOCHE + DIA,
          consultas: [{ fuente: "registro-oficial", consultadoEl: NOCHE + DIA }],
        });

        // Al tercer día solo se retira una estación base, y su emplazamiento desaparece: la
        // versión también avanza, porque de ella sale el nombre de la capa.
        yield* TestClock.adjust(DIA);
        const tercera = yield* ejecutar(registroOficial(unDiaDespues(grabada)));
        assert.deepStrictEqual(tercera.cambios.emplazamientos, {
          creados: 0,
          cambiados: 0,
          retirados: 1,
        });
        assert.strictEqual(
          (yield* convex.query(refs.public.datos.version)).version,
          NOCHE + 2 * DIA,
        );

        // Campus Nord no ha cambiado: su ficha sigue con la versión y la fecha de la primera noche.
        const campusNord = yield* convex.query(refs.public.datos.ficha, {
          clave: "movistar-0802532",
        });
        assert.isTrue(Option.isSome(campusNord));
        if (Option.isSome(campusNord)) {
          const { version, datosDel, estaciones } = campusNord.value;
          assert.strictEqual(version, NOCHE);
          assert.strictEqual(datosDel, NOCHE);
          assert.deepStrictEqual(
            estaciones.map((e) => e.compania),
            ["movistar", "orange", "vodafone"],
          );
          assert.isTrue(
            estaciones
              .flatMap((e) => e.origenes)
              .every(
                (o) => o.fecha === NOCHE && o.url.startsWith("https://geoportal.minetur.gob.es/"),
              ),
          );
        }
        // La de Digi es nueva: su versión es la de la segunda noche.
        const digi = yield* convex.query(refs.public.datos.ficha, { clave: "digi-0800143" });
        assert.strictEqual(Option.map(digi, (f) => f.version).pipe(Option.getOrNull), NOCHE + DIA);
        assert.isTrue(
          Option.isNone(yield* convex.query(refs.public.datos.ficha, { clave: "no-existe" })),
        );
      }),
    ),
  );

  it.effect("la fusión deja una sola copia de cada emplazamiento y de cada estación base", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(registroOficial(grabada));
        // Copias como las que dejó una versión anterior con claves repetidas.
        yield* convex.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const emplazamiento = yield* reader
              .table("emplazamientos")
              .index("por_clave", (q) => q.eq("clave", "movistar-0802532"))
              .collect();
            const estaciones = yield* reader
              .table("estacionesBase")
              .index("por_emplazamiento", (q) => q.eq("emplazamiento", "movistar-0802532"))
              .collect();
            for (const { _id, _creationTime, ...copia } of emplazamiento) {
              yield* writer.table("emplazamientos").insert(copia);
            }
            for (const { _id, _creationTime, ...copia } of estaciones) {
              yield* writer.table("estacionesBase").insert(copia);
            }
          }).pipe(Effect.orDie),
        );
        yield* TestClock.adjust(DIA);
        yield* ejecutar(registroOficial(grabada));
        const { emplazamientos, estaciones } = yield* instantanea;
        const claves = emplazamientos.map((e) => e.clave);
        assert.strictEqual(new Set(claves).size, claves.length);
        const pares = estaciones.map((e) => `${e.emplazamiento}/${e.compania}`);
        assert.strictEqual(new Set(pares).size, pares.length);
      }),
    ),
  );

  it("un cron de Convex lanza la ingesta del registro oficial cada noche", () => {
    assert.deepStrictEqual(crons.convexCronJobs.crons["ingesta del registro oficial"], {
      name: "ingesta:registroOficial",
      args: [{}],
      schedule: { type: "cron", cron: "15 2 * * *" },
    });
  });
});
