// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { decodificarManifiesto, ficheroDeManifiesto } from "@celda/dominio/provincias";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { INTERRUPTOR_POR_DEFECTO } from "@celda/ingesta/ejecucion";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { CopiaDeReserva, ReservaNoDisponible } from "@celda/publicacion/reserva";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { copiarReserva } from "./reserva.ts";
import { conEntorno, contenidoDe, type Entorno, unaNoche } from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

const registroOficial = (grabada: FuenteGrabada) =>
  capaGrabadaPorCajas("registro-oficial", grabada);

/** La muestra sin una estación de Vodafone: otra versión de los datos. */
const sinUna = (grabada: FuenteGrabada): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.filter(
      (r) => r.clave !== "VODAFONE ESPAÑA, S.A.U. - 079808",
    ),
  },
});

/** La orden `reserva` como la lanza el build: de `origen` a una carpeta nueva. */
const copiar = (origen: string, carpeta: string) =>
  copiarReserva(origen, carpeta).pipe(
    Effect.provide(
      Layer.merge(almacenEnCarpeta({ carpeta, origen: "/capas" }), FetchHttpClient.layer).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

/** Por qué ha fallado la copia: el motivo de una copia incompleta, o la etiqueta del error. */
const porQue = (fallo: Effect.Error<ReturnType<typeof copiar>>): string =>
  fallo._tag === "CopiaIncompleta" ? fallo.motivo : fallo._tag;

/** Qué hace el Vercel de mentira con cada llamada al deploy hook. */
interface Vercel {
  /** El despliegue no llega a R2: su build falla. */
  readonly sinR2: Ref.Ref<boolean>;
  /** El deploy hook no contesta. */
  readonly hookCaido: Ref.Ref<boolean>;
  /** La copia servida no contesta. */
  readonly copiaCaida: Ref.Ref<boolean>;
  /** Llamadas al deploy hook que ha aceptado. */
  readonly despliegues: Effect.Effect<number>;
  /** La carpeta del despliegue que se sirve, si hay alguno. */
  readonly servido: Effect.Effect<Option.Option<string>>;
  readonly capa: Layer.Layer<CopiaDeReserva>;
}

/**
 * Un Vercel de mentira. Cada llamada al deploy hook construye un despliegue nuevo en su carpeta
 * con la orden `reserva`, que lee del almacén del entorno como el build lee de R2. Si el build
 * acaba bien, ese despliegue pasa a servirse; si falla, se sigue sirviendo el anterior.
 */
const vercelDePrueba = (entorno: Entorno) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sinR2 = yield* Ref.make(false);
    const hookCaido = yield* Ref.make(false);
    const copiaCaida = yield* Ref.make(false);
    const despliegues = yield* Ref.make(0);
    const servido = yield* Ref.make(Option.none<string>());
    const carpeta = path.join(path.dirname(entorno.almacen), "vercel");

    const vigente = Effect.gen(function* () {
      if (yield* Ref.get(copiaCaida)) {
        return yield* new ReservaNoDisponible({ motivo: "ERR_CONNECTION_RESET" });
      }
      const actual = yield* Ref.get(servido);
      if (Option.isNone(actual)) return Option.none<string>();
      return Option.some(
        yield* Effect.orDie(fs.readFileString(path.join(actual.value, FICHERO_VIGENTE))),
      );
    });

    const desplegar = Effect.gen(function* () {
      if (yield* Ref.get(hookCaido)) {
        return yield* new ReservaNoDisponible({ motivo: "el deploy hook contesta 503" });
      }
      const numero = yield* Ref.updateAndGet(despliegues, (n) => n + 1);
      const destino = path.join(carpeta, String(numero));
      const origen = (yield* Ref.get(sinR2)) ? path.join(carpeta, "sin-r2") : entorno.almacen;
      const build = yield* Effect.exit(copiar(origen, destino));
      if (Exit.isSuccess(build)) yield* Ref.set(servido, Option.some(destino));
    });

    const hecho: Vercel = {
      sinR2,
      hookCaido,
      copiaCaida,
      despliegues: Ref.get(despliegues),
      servido: Ref.get(servido),
      capa: Layer.succeed(CopiaDeReserva, CopiaDeReserva.of({ vigente, desplegar })),
    };
    return hecho;
  });

/** Los ficheros que tiene que llevar la copia de la versión vigente de un almacén. */
const deLaVigente = (almacen: ReadonlyMap<string, string>) => {
  const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
  if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
  const manifiesto = ficheroDeManifiesto(vigente.success.version);
  const listados = decodificarManifiesto(almacen.get(manifiesto) ?? "");
  if (Result.isFailure(listados)) return assert.fail(`${manifiesto} no se entiende`);
  return [
    FICHERO_VIGENTE,
    manifiesto,
    vigente.success.resumen ?? "",
    ...listados.success.ficheros,
  ].toSorted();
};

describe("copia de reserva de Vercel", () => {
  it.effect(
    "tras cada versión nueva la noche pide un despliegue, y la copia solo lleva la vigente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const vercel = yield* vercelDePrueba(entorno);
          yield* TestClock.setTime(NOCHE);
          const primera = yield* unaNoche(entorno, registroOficial(grabada), {
            reserva: vercel.capa,
          });
          assert.deepStrictEqual(primera.reserva, {
            tipo: "desplegada",
            version: primera.publicacion.tipo === "publicada" ? primera.publicacion.version : "",
          });
          assert.strictEqual(yield* vercel.despliegues, 1);

          // Un barrido sin la estación: la misma versión con otro resumen, que la copia no tiene.
          yield* TestClock.adjust(DIA);
          const segunda = yield* unaNoche(entorno, registroOficial(sinUna(grabada)), {
            reserva: vercel.capa,
          });
          assert.strictEqual(segunda.publicacion.tipo, "barrido");
          assert.strictEqual(segunda.reserva.tipo, "desplegada");
          assert.strictEqual(yield* vercel.despliegues, 2);

          // El segundo barrido sin ella la retira: una versión nueva.
          yield* TestClock.adjust(DIA);
          const tercera = yield* unaNoche(entorno, registroOficial(sinUna(grabada)), {
            reserva: vercel.capa,
          });
          assert.strictEqual(tercera.publicacion.tipo, "publicada");
          assert.strictEqual(tercera.reserva.tipo, "desplegada");
          assert.strictEqual(yield* vercel.despliegues, 3);

          const almacen = yield* contenidoDe(entorno.almacen);
          const servido = yield* vercel.servido;
          assert.isTrue(Option.isSome(servido));
          const copia = yield* contenidoDe(Option.getOrElse(servido, () => ""));
          // El almacén guarda las dos versiones y los tres resúmenes; la copia, solo la vigente,
          // igual byte a byte.
          assert.lengthOf(
            [...almacen.keys()].filter((f) => f.startsWith("resumen@")),
            3,
          );
          assert.lengthOf(
            [...almacen.keys()].filter((f) => f.startsWith("ficheros@")),
            2,
          );
          assert.deepStrictEqual([...copia.keys()].toSorted(), deLaVigente(almacen));
          for (const [fichero, contenido] of copia) {
            assert.strictEqual(contenido, almacen.get(fichero), fichero);
          }
        }),
      ),
    30_000,
  );

  it.effect("con la copia al día no se vuelve a desplegar", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const vercel = yield* vercelDePrueba(entorno);
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, registroOficial(grabada), { reserva: vercel.capa });
        const apagada = yield* unaNoche(entorno, registroOficial(grabada), {
          reserva: vercel.capa,
          interruptores: {
            ...INTERRUPTOR_POR_DEFECTO,
            "registro-oficial": { activo: false, motivo: "prueba" },
          },
        });
        assert.strictEqual(apagada.publicacion.tipo, "al-dia");
        assert.strictEqual(apagada.reserva.tipo, "al-dia");
        assert.strictEqual(yield* vercel.despliegues, 1);
      }),
    ),
  );

  it.effect("un build que no llega a R2 falla y se sigue sirviendo la copia anterior", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const vercel = yield* vercelDePrueba(entorno);
        yield* TestClock.setTime(NOCHE);
        yield* unaNoche(entorno, registroOficial(grabada), { reserva: vercel.capa });
        const anterior = yield* vercel.servido;

        yield* Ref.set(vercel.sinR2, true);
        yield* TestClock.adjust(DIA);
        const segunda = yield* unaNoche(entorno, registroOficial(sinUna(grabada)), {
          reserva: vercel.capa,
        });
        assert.strictEqual(segunda.reserva.tipo, "desplegada");
        assert.strictEqual(yield* vercel.despliegues, 2);
        assert.deepStrictEqual(yield* vercel.servido, anterior);

        // La noche siguiente la copia sigue sin la versión nueva: se vuelve a desplegar.
        yield* Ref.set(vercel.sinR2, false);
        const tercera = yield* unaNoche(entorno, registroOficial(sinUna(grabada)), {
          reserva: vercel.capa,
        });
        assert.strictEqual(tercera.reserva.tipo, "desplegada");
        assert.strictEqual(yield* vercel.despliegues, 3);
        const servido = yield* vercel.servido;
        const almacen = yield* contenidoDe(entorno.almacen);
        const copia = yield* contenidoDe(Option.getOrElse(servido, () => ""));
        assert.strictEqual(copia.get(FICHERO_VIGENTE), almacen.get(FICHERO_VIGENTE));
      }),
    ),
  );

  it.effect("si la copia no contesta se despliega igual, y un hook caído no tumba la noche", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const vercel = yield* vercelDePrueba(entorno);
        yield* TestClock.setTime(NOCHE);
        yield* Ref.set(vercel.hookCaido, true);
        const primera = yield* unaNoche(entorno, registroOficial(grabada), {
          reserva: vercel.capa,
        });
        assert.strictEqual(primera.publicacion.tipo, "publicada");
        assert.deepStrictEqual(primera.reserva, {
          tipo: "fallida",
          motivo: "el deploy hook contesta 503",
        });
        assert.isDefined(primera.copia);

        yield* Ref.set(vercel.hookCaido, false);
        yield* Ref.set(vercel.copiaCaida, true);
        yield* TestClock.adjust(DIA);
        const segunda = yield* unaNoche(entorno, registroOficial(grabada), {
          reserva: vercel.capa,
        });
        assert.strictEqual(segunda.reserva.tipo, "desplegada");
        assert.strictEqual(yield* vercel.despliegues, 1);
      }),
    ),
  );

  it.effect("sin deploy hook la noche no toca la copia", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        const hecha = yield* unaNoche(entorno, registroOficial(yield* muestraCampusNord));
        assert.deepStrictEqual(hecha.reserva, { tipo: "sin-reserva" });
      }),
    ),
  );

  describe("la orden reserva", () => {
    /** Un almacén con una versión publicada y una carpeta vacía al lado para la copia. */
    const publicado = <A, E, R>(
      prueba: (almacen: string, destino: string) => Effect.Effect<A, E, R>,
    ) =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, registroOficial(yield* muestraCampusNord));
          return yield* prueba(entorno.almacen, path.join(path.dirname(entorno.almacen), "copia"));
        }),
      );

    it.effect("falta un lote: falla y la copia no tiene vigente.json", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const lote = [...(yield* contenidoDe(almacen)).keys()].find((f) =>
            f.startsWith("fichas/"),
          );
          yield* fs.remove(path.join(almacen, lote ?? ""));
          const fallo = yield* Effect.flip(copiar(almacen, destino));
          assert.strictEqual(porQue(fallo), `falta ${lote}`);
          assert.isFalse(yield* fs.exists(path.join(destino, FICHERO_VIGENTE)));
        }),
      ),
    );

    it.effect("una capa que no coincide con su huella: falla y no escribe vigente.json", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const capa = [...(yield* contenidoDe(almacen)).keys()].find((f) =>
            f.startsWith("provincias/"),
          );
          yield* fs.writeFileString(path.join(almacen, capa ?? ""), "{}");
          const fallo = yield* Effect.flip(copiar(almacen, destino));
          assert.strictEqual(porQue(fallo), `${capa} no coincide con su huella`);
          assert.isFalse(yield* fs.exists(path.join(destino, FICHERO_VIGENTE)));
        }),
      ),
    );

    it.effect("no copia en una carpeta que ya tiene algo", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* fs.makeDirectory(destino, { recursive: true });
          yield* fs.writeFileString(path.join(destino, "otra.json"), "{}");
          const fallo = yield* Effect.flip(copiar(almacen, destino));
          assert.strictEqual(porQue(fallo), "CarpetaOcupada");
        }),
      ),
    );

    it.effect("sin nada publicado falla", () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fallo = yield* Effect.flip(
            copiar(entorno.almacen, path.join(path.dirname(entorno.almacen), "copia")),
          );
          assert.strictEqual(porQue(fallo), "no hay vigente.json");
        }),
      ),
    );
  });
});
