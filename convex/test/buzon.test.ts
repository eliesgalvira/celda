// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import { DAY, HOUR } from "@convex-dev/rate-limiter";
import { assert, describe, it } from "@effect/vitest";
import { makeFunctionReference } from "convex/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import refs from "../confect/_generated/refs";
import { DatabaseReader, MutationCtx } from "../confect/_generated/services";
import { LimiteAlcanzado } from "../confect/buzon.spec";
import { DISPERSION_MAXIMA_MS, limitador, type NombreDeLimite } from "../src/limites";
import {
  avanzar,
  corroboracion,
  correccion,
  identidadDesde,
  medida,
  prepararBuzon,
  tablas,
} from "./ayudas";
import * as TestConfect from "./TestConfect";

const IP = "203.0.113.7";
const OTRA_IP = "198.51.100.23";

const buzon = refs.public.buzon;

prepararBuzon();

/** La huella de IP con la que se guardó una aportación. */
const huellaDe = (id: string) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    const huella = yield* Ref.make<string | null>(null);
    yield* convex.run(
      Effect.gen(function* () {
        const reader = yield* DatabaseReader;
        const fila = yield* reader
          .table("aportaciones")
          .index("por_id", (q) => q.eq("id", id))
          .first();
        yield* Ref.set(
          huella,
          Option.match(fila, { onNone: () => null, onSome: (f) => f.huellaIp }),
        );
      }).pipe(Effect.orDie),
    );
    const leida = yield* Ref.get(huella);
    assert.isNotNull(leida);
    return leida ?? "";
  });

/**
 * Gasta `cuantas` fichas de un límite de una vez, sin pasar por las funciones: llenar un cubo de
 * cientos de fichas con envíos uno a uno tarda demasiado en convex-test.
 */
const gastarDeGolpe = (limite: NombreDeLimite, cuantas: number, clave?: string) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    yield* convex.run(
      Effect.gen(function* () {
        const ctx = yield* MutationCtx;
        const estado = yield* Effect.promise(() =>
          clave === undefined
            ? limitador.limit(ctx, limite, { count: cuantas })
            : limitador.limit(ctx, limite, { count: cuantas, key: clave }),
        );
        assert.isTrue(estado.ok, `quedaban ${cuantas} fichas en ${limite}`);
      }),
    );
  });

const esLimite = Schema.is(LimiteAlcanzado);

/** El límite con que se rechaza un envío, o un fallo de la prueba si no es ese el error. */
const limiteDe = <A, E extends { readonly _tag: string }, R>(envio: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(envio);
    if (!esLimite(error)) return assert.fail(`se esperaba un límite, no ${error._tag}`);
    return error;
  });

describe("buzón: identidad", () => {
  it.effect("la crea el servidor como token firmado, y uno tocado no vale", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      assert.match(identidad, /^[^.]+\.[A-Za-z0-9_-]{43}$/u);

      const enviada = yield* convex
        .desde(IP)
        .mutation(buzon.enviarMedida, { identidad, medida: medida() });
      assert.isTrue(enviada.nueva);

      const [id = "", firma = ""] = identidad.split(".");
      const tocadas = [
        `${id}.${firma.slice(0, -1)}${firma.endsWith("A") ? "B" : "A"}`,
        `${id}x.${firma}`,
        id,
        "inventada",
      ];
      for (const tocada of tocadas) {
        const error = yield* Effect.flip(
          convex.desde(IP).mutation(buzon.enviarMedida, { identidad: tocada, medida: medida() }),
        );
        assert.strictEqual(error._tag, "IdentidadNoValida");
      }
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("pedirla está limitado a 100 al día por IP, y otra IP no lo nota", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      yield* identidadDesde(IP);
      const [creada] = (yield* tablas).identidades;
      yield* gastarDeGolpe("identidadesPorIp", 98, creada?.huellaIp ?? "");
      yield* identidadDesde(IP);

      const error = yield* limiteDe(convex.desde(IP).mutation(buzon.pedirIdentidad));
      assert.strictEqual(error.limite, "identidadesPorIp");
      assert.strictEqual(error.ambito, "ip");
      // 100 al día: una ficha nueva cada 14,4 minutos.
      assert.closeTo(error.reintentarEn, DAY / 100, 1000);

      yield* identidadDesde(OTRA_IP);
      avanzar(DAY / 100);
      yield* identidadDesde(IP);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("sin la clave del despliegue el buzón está cerrado", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      for (const clave of ["", "corta"]) {
        process.env["CELDA_BUZON_CLAVE"] = clave;
        const error = yield* Effect.flip(convex.desde(IP).mutation(buzon.pedirIdentidad));
        assert.strictEqual(error._tag, "BuzonCerrado");
        const envio = yield* Effect.flip(
          convex.desde(IP).mutation(buzon.enviarMedida, { identidad, medida: medida() }),
        );
        assert.strictEqual(envio._tag, "BuzonCerrado");
      }
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});

describe("buzón: envíos", () => {
  it.effect("una medida, una corrección y una corroboración llegan pendientes", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect.pipe(Effect.map((c) => c.desde(IP)));
      const identidad = yield* identidadDesde(IP);
      const enviadas = [medida(), correccion(), corroboracion()] as const;
      yield* convex.mutation(buzon.enviarMedida, { identidad, medida: enviadas[0] });
      yield* convex.mutation(buzon.enviarCorreccion, { identidad, correccion: enviadas[1] });
      yield* convex.mutation(buzon.enviarCorroboracion, { identidad, corroboracion: enviadas[2] });

      const guardadas = (yield* tablas).aportaciones;
      assert.deepStrictEqual(
        guardadas.map((a) => a.id).toSorted(),
        enviadas.map((a) => a.id).toSorted(),
      );
      for (const guardada of guardadas) {
        assert.strictEqual(guardada.estado, "pendiente");
        assert.deepStrictEqual(
          guardada.contenido,
          enviadas.find((e) => e.id === guardada.id),
        );
      }
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("enviar dos veces la misma aportación guarda una y no gasta más fichas", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect.pipe(Effect.map((c) => c.desde(IP)));
      const identidad = yield* identidadDesde(IP);
      const repetida = medida();
      const primera = yield* convex.mutation(buzon.enviarMedida, { identidad, medida: repetida });
      // Tres veces más: con una ráfaga de 3, la cuarta medida nueva ya no cabría.
      for (let i = 0; i < 3; i++) {
        const otra = yield* convex.mutation(buzon.enviarMedida, { identidad, medida: repetida });
        assert.isFalse(otra.nueva);
      }
      assert.isTrue(primera.nueva);
      assert.lengthOf((yield* tablas).aportaciones, 1);
      yield* convex.mutation(buzon.enviarMedida, { identidad, medida: medida() });
      yield* convex.mutation(buzon.enviarMedida, { identidad, medida: medida() });
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "una medida fuera de los rangos de 3GPP o en un sitio imposible da un error tipado",
    () =>
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect.pipe(Effect.map((c) => c.desde(IP)));
        const identidad = yield* identidadDesde(IP);
        const base = medida();
        const malas = [
          medida({ senal: { ...base.senal, rsrpDbm: -20 } }),
          medida({ senal: { ...base.senal, rsrqDb: -50 } }),
          medida({ senal: { ...base.senal, pci: 1008 } }),
          medida({ punto: { longitud: 2.1701, latitud: 41.75 } }),
          medida({ unidaA: { ...base.unidaA, azimut: 300 } }),
          medida({ id: "no-es-un-uuid" }),
          // Una hora por delante del reloj del sistema, que las pruebas mueven con `vi`.
          // @effect-diagnostics-next-line globalDateInEffect:off
          medida({ creada: Date.now() + HOUR }),
        ];
        for (const mala of malas) {
          const error = yield* Effect.flip(
            convex.mutation(buzon.enviarMedida, { identidad, medida: mala }),
          );
          assert.strictEqual(error._tag, "AportacionNoValida");
        }
        assert.lengthOf((yield* tablas).aportaciones, 0);
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("una corrección con una nota demasiado larga no pasa, ni ningún campo de más", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const imagen = `data:image/png;base64,${"iVBORw0KGgo".repeat(2000)}`;
      const error = yield* Effect.flip(
        convex.desde(IP).mutation(buzon.enviarCorreccion, {
          identidad,
          correccion: correccion({ nota: imagen }),
        }),
      );
      assert.strictEqual(error._tag, "AportacionNoValida");

      // Convex rechaza un campo que la forma no tiene antes de llamar a la función.
      const crudo = convex.crudo.withRequestMetadata({ ip: IP });
      const conCaptura = { ...correccion(), captura: imagen };
      const enviarCorreccion = makeFunctionReference<"mutation">("buzon:enviarCorreccion");
      // El rechazo de Convex, sin tipar: solo se mira su texto.
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off
      const rechazo = yield* Effect.flip(
        Effect.tryPromise(() =>
          crudo.mutation(enviarCorreccion, { identidad, correccion: conCaptura }),
        ),
      );
      assert.match(String(rechazo.cause), /captura/u);
      assert.lengthOf((yield* tablas).aportaciones, 0);
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});

describe("buzón: límites", () => {
  it.effect("medidas: 3 seguidas por dispositivo y después una cada 6 minutos", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect.pipe(Effect.map((c) => c.desde(IP)));
      const identidad = yield* identidadDesde(IP);
      for (let i = 0; i < 3; i++)
        yield* convex.mutation(buzon.enviarMedida, { identidad, medida: medida() });
      const error = yield* limiteDe(
        convex.mutation(buzon.enviarMedida, { identidad, medida: medida() }),
      );
      assert.strictEqual(error.limite, "medidasPorDispositivo");
      assert.strictEqual(error.ambito, "dispositivo");
      assert.closeTo(error.reintentarEn, HOUR / 10, 1000);

      // Otro dispositivo en la misma red sigue pudiendo.
      const otra = yield* identidadDesde(IP);
      yield* convex.mutation(buzon.enviarMedida, { identidad: otra, medida: medida() });

      avanzar(error.reintentarEn);
      yield* convex.mutation(buzon.enviarMedida, { identidad, medida: medida() });
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("medidas: 300 por hora desde una IP, y 5.000 al día en total", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const desdeIp = convex.desde(IP);
      const primera = medida();
      yield* desdeIp.mutation(buzon.enviarMedida, {
        identidad: yield* identidadDesde(IP),
        medida: primera,
      });
      yield* gastarDeGolpe("medidasPorIp", 298, yield* huellaDe(primera.id));
      yield* desdeIp.mutation(buzon.enviarMedida, {
        identidad: yield* identidadDesde(IP),
        medida: medida(),
      });
      const porIp = yield* limiteDe(
        desdeIp.mutation(buzon.enviarMedida, {
          identidad: yield* identidadDesde(IP),
          medida: medida(),
        }),
      );
      assert.strictEqual(porIp.limite, "medidasPorIp");
      assert.strictEqual(porIp.ambito, "ip");
      assert.closeTo(porIp.reintentarEn, HOUR / 300, 100);

      // En total van 2: la rechazada no cuenta.
      yield* gastarDeGolpe("medidasEnTotal", 4997);
      const otra = convex.desde(OTRA_IP);
      yield* otra.mutation(buzon.enviarMedida, {
        identidad: yield* identidadDesde(OTRA_IP),
        medida: medida(),
      });
      const total = yield* limiteDe(
        otra.mutation(buzon.enviarMedida, {
          identidad: yield* identidadDesde(OTRA_IP),
          medida: medida(),
        }),
      );
      assert.strictEqual(total.limite, "medidasEnTotal");
      assert.strictEqual(total.ambito, "total");
      assert.isAtLeast(total.reintentarEn, Math.floor(DAY / 5000));
      assert.isBelow(total.reintentarEn, DAY / 5000 + DISPERSION_MAXIMA_MS + 1000);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("correcciones: 3 seguidas por dispositivo y después 10 al día", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect.pipe(Effect.map((c) => c.desde(IP)));
      const identidad = yield* identidadDesde(IP);
      for (let i = 0; i < 3; i++) {
        yield* convex.mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
      }
      const error = yield* limiteDe(
        convex.mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() }),
      );
      assert.strictEqual(error.limite, "correccionesPorDispositivo");
      assert.closeTo(error.reintentarEn, DAY / 10, 1000);
      avanzar(error.reintentarEn);
      yield* convex.mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("correcciones: 50 al día desde una IP y 300 al día en total", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const desdeIp = convex.desde(IP);
      const primera = correccion();
      yield* desdeIp.mutation(buzon.enviarCorreccion, {
        identidad: yield* identidadDesde(IP),
        correccion: primera,
      });
      yield* gastarDeGolpe("correccionesPorIp", 48, yield* huellaDe(primera.id));
      yield* desdeIp.mutation(buzon.enviarCorreccion, {
        identidad: yield* identidadDesde(IP),
        correccion: correccion(),
      });
      const porIp = yield* limiteDe(
        desdeIp.mutation(buzon.enviarCorreccion, {
          identidad: yield* identidadDesde(IP),
          correccion: correccion(),
        }),
      );
      assert.strictEqual(porIp.limite, "correccionesPorIp");
      assert.strictEqual(porIp.ambito, "ip");

      yield* gastarDeGolpe("correccionesEnTotal", 297);
      const otra = convex.desde(OTRA_IP);
      yield* otra.mutation(buzon.enviarCorreccion, {
        identidad: yield* identidadDesde(OTRA_IP),
        correccion: correccion(),
      });
      const total = yield* limiteDe(
        otra.mutation(buzon.enviarCorreccion, {
          identidad: yield* identidadDesde(OTRA_IP),
          correccion: correccion(),
        }),
      );
      assert.strictEqual(total.limite, "correccionesEnTotal");
      assert.strictEqual(total.ambito, "total");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("corroboraciones: 50 al día por dispositivo y 200 por IP, sin tope total", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const desdeIp = convex.desde(IP);
      const identidad = yield* identidadDesde(IP);
      const primera = corroboracion();
      yield* desdeIp.mutation(buzon.enviarCorroboracion, { identidad, corroboracion: primera });
      const [id = ""] = identidad.split(".");
      yield* gastarDeGolpe("corroboracionesPorDispositivo", 48, id);
      yield* desdeIp.mutation(buzon.enviarCorroboracion, {
        identidad,
        corroboracion: corroboracion(),
      });
      const porDispositivo = yield* limiteDe(
        desdeIp.mutation(buzon.enviarCorroboracion, { identidad, corroboracion: corroboracion() }),
      );
      assert.strictEqual(porDispositivo.limite, "corroboracionesPorDispositivo");
      assert.closeTo(porDispositivo.reintentarEn, DAY / 50, 1000);

      // Desde la IP van 2: las gastadas de golpe eran del dispositivo.
      yield* gastarDeGolpe("corroboracionesPorIp", 197, yield* huellaDe(primera.id));
      yield* desdeIp.mutation(buzon.enviarCorroboracion, {
        identidad: yield* identidadDesde(IP),
        corroboracion: corroboracion(),
      });
      const porIp = yield* limiteDe(
        desdeIp.mutation(buzon.enviarCorroboracion, {
          identidad: yield* identidadDesde(IP),
          corroboracion: corroboracion(),
        }),
      );
      assert.strictEqual(porIp.limite, "corroboracionesPorIp");
      assert.strictEqual(porIp.ambito, "ip");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("un envío rechazado por un límite no gasta las fichas de los demás", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const desdeIp = convex.desde(IP);
      const identidad = yield* identidadDesde(IP);
      const primera = medida();
      yield* desdeIp.mutation(buzon.enviarMedida, { identidad, medida: primera });
      yield* gastarDeGolpe("medidasPorIp", 299, yield* huellaDe(primera.id));
      yield* limiteDe(desdeIp.mutation(buzon.enviarMedida, { identidad, medida: medida() }));
      const restantes = yield* Ref.make(0);
      const [id = ""] = identidad.split(".");
      yield* convex.run(
        Effect.gen(function* () {
          const ctx = yield* MutationCtx;
          const { value } = yield* Effect.promise(() =>
            limitador.getValue(ctx, "medidasPorDispositivo", { key: id }),
          );
          yield* Ref.set(restantes, Math.floor(value));
        }),
      );
      // El dispositivo gastó una de sus tres; la rechazada se deshizo con la mutación.
      assert.strictEqual(yield* Ref.get(restantes), 2);
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});

describe("buzón: vetos", () => {
  it.effect("una identidad vetada no puede enviar nada", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const [id = ""] = identidad.split(".");
      yield* convex.mutation(refs.internal.moderacion.vetar, {
        tipo: "identidad",
        valor: id,
        motivo: "spam",
      });
      const envios = [
        convex.desde(IP).mutation(buzon.enviarMedida, { identidad, medida: medida() }),
        convex.desde(IP).mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() }),
        convex
          .desde(IP)
          .mutation(buzon.enviarCorroboracion, { identidad, corroboracion: corroboracion() }),
      ];
      for (const envio of envios) {
        const error = yield* Effect.flip(envio);
        assert.deepInclude(error, { _tag: "Vetada", que: "identidad" });
      }
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("una huella de IP vetada no puede pedir identidad ni enviar, y otra red sí", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const primera = medida();
      yield* convex.desde(IP).mutation(buzon.enviarMedida, { identidad, medida: primera });
      const huella = yield* huellaDe(primera.id);
      yield* convex.mutation(refs.internal.moderacion.vetar, {
        tipo: "ip",
        valor: huella,
        motivo: "spam",
      });

      const pedir = yield* Effect.flip(convex.desde(IP).mutation(buzon.pedirIdentidad));
      assert.deepInclude(pedir, { _tag: "Vetada", que: "ip" });
      const enviar = yield* Effect.flip(
        convex.desde(IP).mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() }),
      );
      assert.deepInclude(enviar, { _tag: "Vetada", que: "ip" });
      // El mismo dispositivo desde otra red puede.
      yield* convex
        .desde(OTRA_IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});
