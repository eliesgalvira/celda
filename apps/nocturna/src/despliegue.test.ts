// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import { ficheroDeManifiesto } from "@celda/dominio/provincias";
import { INTERRUPTOR_POR_DEFECTO } from "@celda/ingesta/ejecucion";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { AlmacenDeFicheros, AlmacenNoDisponible } from "@celda/publicacion/almacen";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import {
  codificarDespliegue,
  type ComprobacionDelDespliegue,
  comprobarDespliegue,
  FICHERO_DEL_DESPLIEGUE,
  huellaDeLaWeb,
  Produccion,
  type R2DelDespliegue,
} from "@celda/publicacion/despliegue";
import { VercelNoDisponible } from "@celda/publicacion/vercel";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import { montarCapasEn } from "./capas.ts";
import { argumentosDelDespliegue, ordenDespliegue, ordenHuellaWeb } from "./despliegue.ts";
import { conEntorno, contenidoDe, type Entorno, unaNoche } from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;
const COMMIT = "0631fc3eb2352cd994c79009743808d78e0e9eeb";

/** El commit del push número `n` a `main` en una prueba. */
const commitNumero = (n: number): string => `${String(n).padStart(4, "0")}${COMMIT.slice(4)}`;

const registroOficial = (grabada: FuenteGrabada) =>
  capaGrabadaPorCajas("registro-oficial", grabada);

/** La muestra sin una estación de Vodafone: dos noches así retiran la estación. */
const sinUna = (grabada: FuenteGrabada): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.filter(
      (r) => r.clave !== "VODAFONE ESPAÑA, S.A.U. - 079808",
    ),
  },
});

/** Un almacén en una carpeta del disco, ya montado, como el cubo de R2 que lee el flujo. */
const almacenEn = (carpeta: string) =>
  Effect.service(AlmacenDeFicheros).pipe(
    Effect.provide(
      almacenEnCarpeta({ carpeta, origen: "/capas" }).pipe(Layer.provide(NodeServices.layer)),
    ),
  );

/** Lo construido de una web de prueba: `apps/web/dist`, sin capas. */
const CONSTRUIDO = {
  "dist/index.html": "<!doctype html><script src=/assets/index-a1.js></script>",
  "dist/assets/index-a1.js": "console.log('celda')",
  "dist/iconos/favicon.svg": "<svg/>",
  "vercel.json": '{"buildCommand":"./scripts/vercel.sh"}',
  "scripts/vercel.sh": "pnpm run build",
  "src/entrada.tsx": "export {}",
} satisfies Readonly<Record<string, string>>;

/**
 * El flujo de despliegue, con un Vercel de mentira y su producción.
 *
 * - Cada push es un commit nuevo de la web de prueba. El flujo construye la web y calcula su huella
 *   la primera vez que mira un commit, y la guarda con el commit en la clave, como en la caché de
 *   GitHub. Las demás ejecuciones del mismo commit la leen de ahí.
 * - Cada despliegue copia la web construida, escribe en su raíz el `despliegue.json` que le pasa
 *   el flujo y monta las capas con la orden `capas` desde el almacén del entorno, que hace de cubo
 *   de R2. Si el build acaba bien, pasa a servirse; si falla, se sigue sirviendo el anterior.
 */
const vercelDePrueba = (entorno: Entorno) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const raiz = path.dirname(entorno.almacen);
    const web = path.join(raiz, "web");
    const servido = yield* Ref.make(Option.none<string>());
    const caida = yield* Ref.make(false);
    const buildFalla = yield* Ref.make(false);
    const despliegues = yield* Ref.make(0);
    const construcciones = yield* Ref.make(0);
    const empujados = yield* Ref.make(0);
    const commit = Effect.map(Ref.get(empujados), commitNumero);
    const memoria = new Map<string, string>();

    /**
     * Un push a `main`: un commit nuevo que cambia, añade o quita (`undefined`) ficheros de la
     * web de prueba.
     */
    const empujar = (cambios: Readonly<Record<string, string | undefined>>) =>
      Effect.gen(function* () {
        for (const [ruta, contenido] of Object.entries(cambios)) {
          const fichero = path.join(web, ruta);
          if (contenido === undefined) {
            yield* fs.remove(fichero);
            continue;
          }
          yield* fs.makeDirectory(path.dirname(fichero), { recursive: true });
          yield* fs.writeFileString(fichero, contenido);
        }
        yield* Ref.update(empujados, (n) => n + 1);
      });
    yield* empujar(CONSTRUIDO);

    /** La huella de la web del commit de ahora: la guardada o, si no hay, la de construirla. */
    const huellaDelCommit = Effect.gen(function* () {
      const deAhora = yield* commit;
      const guardada = memoria.get(deAhora);
      if (guardada !== undefined) return guardada;
      yield* Ref.update(construcciones, (n) => n + 1);
      const huella = yield* huellaDeLaWeb(web);
      memoria.set(deAhora, huella);
      return huella;
    });

    const desplegar = (comprobacion: ComprobacionDelDespliegue) =>
      Effect.gen(function* () {
        const numero = yield* Ref.updateAndGet(despliegues, (n) => n + 1);
        if (yield* Ref.get(buildFalla)) return;
        const destino = path.join(raiz, "vercel", String(numero));
        yield* fs.copy(path.join(web, "dist"), destino);
        yield* fs.writeFileString(
          path.join(destino, FICHERO_DEL_DESPLIEGUE),
          `${codificarDespliegue(comprobacion.despliegue)}\n`,
        );
        const capas = path.join(destino, "capas");
        yield* montarCapasEn(yield* almacenEn(entorno.almacen), capas).pipe(
          Effect.provide(
            almacenEnCarpeta({ carpeta: capas, origen: "/capas" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
        );
        yield* Ref.set(servido, Option.some(destino));
      });

    const produccion = Layer.succeed(
      Produccion,
      Produccion.of({
        leer: (ruta) =>
          Effect.gen(function* () {
            if (yield* Ref.get(caida)) {
              return yield* new VercelNoDisponible({ motivo: "ERR_CONNECTION_RESET" });
            }
            const actual = yield* Ref.get(servido);
            if (Option.isNone(actual)) return Option.none<string>();
            const fichero = path.join(actual.value, ruta);
            if (!(yield* Effect.orDie(fs.exists(fichero)))) return Option.none<string>();
            return Option.some(yield* Effect.orDie(fs.readFileString(fichero)));
          }),
      }),
    );

    const r2 = yield* almacenEn(entorno.almacen);
    /** Lo que diría el flujo de despliegue ahora, con el cubo de R2 del entorno. */
    const comprobar = (
      opciones: { readonly aMano?: boolean; readonly r2?: R2DelDespliegue } = {},
    ) =>
      Effect.gen(function* () {
        const huella = yield* huellaDelCommit;
        return yield* comprobarDespliegue({
          huella,
          commit: yield* commit,
          aMano: opciones.aMano ?? false,
          r2: opciones.r2 ?? { tipo: "cubo", origen: r2 },
        }).pipe(Effect.provide(produccion));
      });

    return {
      web,
      empujar,
      desplegar,
      comprobar,
      produccion,
      caida,
      buildFalla,
      /** La caché de GitHub pierde lo guardado. */
      olvidar: Effect.sync(() => memoria.clear()),
      servido: Ref.get(servido),
      despliegues: Ref.get(despliegues),
      /** Veces que el flujo ha construido la web para calcular su huella. */
      construcciones: Ref.get(construcciones),
      commit,
    };
  });

/** Una noche con la muestra del Campus Nord, o con la que se le pase, y un día más en el reloj. */
const noche = (entorno: Entorno, grabada: FuenteGrabada) =>
  Effect.tap(unaNoche(entorno, registroOficial(grabada)), () => TestClock.adjust(DIA));

/** Comprueba, despliega si toca, como el flujo de GitHub, y devuelve lo que se ha visto. */
const unaEjecucion = (vercel: Effect.Success<ReturnType<typeof vercelDePrueba>>) =>
  Effect.gen(function* () {
    const comprobacion = yield* vercel.comprobar();
    if (comprobacion.desplegar) yield* vercel.desplegar(comprobacion);
    return comprobacion;
  });

/** El sello de las versiones que lista el almacén del entorno, del más viejo al más reciente. */
const sellosDe = (entorno: Entorno) =>
  Effect.map(contenidoDe(entorno.almacen), (almacen) =>
    [...almacen.keys()].flatMap((f) => /^ficheros@(.+)\.json$/u.exec(f)?.[1] ?? []).toSorted(),
  );

describe("cuándo se despliega", () => {
  it.effect(
    "sin cambios en R2 ni en la web no se despliega, y el registro dice por qué",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, grabada);
          const vercel = yield* vercelDePrueba(entorno);

          // El primer despliegue: producción aún no sirve nada.
          const primera = yield* unaEjecucion(vercel);
          assert.isTrue(primera.desplegar);
          assert.strictEqual(primera.web.tipo, "no-se-sabe");
          assert.strictEqual(primera.datos.tipo, "cambia");

          // Una noche con el registro apagado no publica nada, y la ejecución de cada día no
          // despliega.
          const [sello] = yield* sellosDe(entorno);
          const apagada = yield* unaNoche(entorno, registroOficial(grabada), {
            interruptores: {
              ...INTERRUPTOR_POR_DEFECTO,
              "registro-oficial": { activo: false, motivo: "prueba" },
            },
          });
          assert.strictEqual(apagada.publicacion.tipo, "al-dia");
          for (let dia = 0; dia < 2; dia++) {
            const sinCambios = yield* unaEjecucion(vercel);
            assert.isFalse(sinCambios.desplegar);
            assert.strictEqual(
              sinCambios.motivo,
              "No se despliega porque producción ya sirve esta web y estos datos.",
            );
            assert.strictEqual(sinCambios.web.tipo, "igual");
            assert.include(sinCambios.web.detalle, (yield* vercel.commit).slice(0, 7));
            assert.deepStrictEqual(sinCambios.datos, {
              tipo: "igual",
              detalle: `Producción sirve sitios@${sello}, la versión vigente de R2.`,
            });
          }
          assert.strictEqual(yield* vercel.despliegues, 1);
        }),
      ),
    60_000,
  );

  it.effect(
    "un barrido nuevo y una versión nueva en R2 se despliegan solos, una vez cada uno",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, grabada);
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);
          const [primera] = yield* sellosDe(entorno);

          // Falta una estación en un barrido: la misma versión con otro resumen nacional.
          yield* noche(entorno, sinUna(grabada));
          const barrido = yield* unaEjecucion(vercel);
          assert.isTrue(barrido.desplegar);
          assert.strictEqual(barrido.motivo, "Se despliega porque han cambiado los datos.");
          assert.strictEqual(barrido.web.tipo, "igual");
          assert.strictEqual(barrido.datos.tipo, "cambia");
          assert.include(barrido.datos.detalle, `R2 tiene sitios@${primera} con otro resumen`);
          assert.isFalse((yield* unaEjecucion(vercel)).desplegar);

          // En el segundo barrido se retira: una versión nueva.
          yield* noche(entorno, sinUna(grabada));
          const [anterior, nueva] = yield* sellosDe(entorno);
          assert.strictEqual(anterior, primera);
          const version = yield* unaEjecucion(vercel);
          assert.isTrue(version.desplegar);
          assert.strictEqual(
            version.datos.detalle,
            `R2 tiene sitios@${nueva} y producción sirve sitios@${primera}.`,
          );
          const despues = yield* unaEjecucion(vercel);
          assert.isFalse(despues.desplegar);
          assert.strictEqual(
            despues.datos.detalle,
            `Producción sirve sitios@${nueva}, la versión vigente de R2, y las anteriores que montaría el build, sitios@${primera}.`,
          );
          assert.strictEqual(yield* vercel.despliegues, 3);
        }),
      ),
    60_000,
  );

  it.effect(
    "un cambio en lo que se construye se despliega, y uno en el código que no lo cambia, no",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, yield* muestraCampusNord);
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);

          yield* vercel.empujar({ "src/entrada.tsx": "// Solo un comentario." });
          assert.isFalse((yield* unaEjecucion(vercel)).desplegar);

          for (const cambio of [
            { "dist/assets/index-a1.js": "console.log('Celda')" },
            {
              "dist/assets/index-b2.js": "console.log('celda')",
              "dist/assets/index-a1.js": undefined,
            },
            { "vercel.json": '{"buildCommand":"./scripts/vercel.sh","headers":[]}' },
          ]) {
            yield* vercel.empujar(cambio);
            const cambiada = yield* unaEjecucion(vercel);
            assert.isTrue(cambiada.desplegar);
            assert.strictEqual(cambiada.motivo, "Se despliega porque ha cambiado la web.");
            assert.strictEqual(cambiada.datos.tipo, "igual");
            assert.include(cambiada.web.detalle, "La web ha cambiado.");
            assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
          }
          assert.strictEqual(yield* vercel.despliegues, 4);
        }),
      ),
    60_000,
  );

  it.effect(
    "la ejecución de cada día no construye la web si nadie ha empujado, y tras un push la construye una vez",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, grabada);
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);
          assert.strictEqual(yield* vercel.construcciones, 1);

          // Cada día, sin pushes: la huella sale de la caché. Una versión nueva en R2 se despliega
          // igual, con esa huella.
          for (let dia = 0; dia < 3; dia++) assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
          yield* noche(entorno, sinUna(grabada));
          assert.isTrue((yield* unaEjecucion(vercel)).desplegar);
          assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
          assert.strictEqual(yield* vercel.construcciones, 1);

          // Un push que no cambia lo construido: se construye una vez y no se despliega.
          yield* vercel.empujar({ "src/entrada.tsx": "// Solo un comentario." });
          for (let dia = 0; dia < 3; dia++) assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
          assert.strictEqual(yield* vercel.construcciones, 2);

          // Si la caché lo pierde, se vuelve a construir y se decide lo mismo.
          yield* vercel.olvidar;
          assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
          assert.strictEqual(yield* vercel.construcciones, 3);
          assert.strictEqual(yield* vercel.despliegues, 2);
        }),
      ),
    60_000,
  );

  it.effect(
    "si un despliegue falla, la siguiente ejecución ve que producción va atrás y vuelve a desplegar",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, grabada);
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);

          // Un push que cambia la web y una versión nueva, con un build de Vercel que falla.
          yield* vercel.empujar({ "dist/index.html": "<!doctype html><title>Celda</title>" });
          yield* noche(entorno, sinUna(grabada));
          yield* Ref.set(vercel.buildFalla, true);
          const fallida = yield* unaEjecucion(vercel);
          assert.strictEqual(
            fallida.motivo,
            "Se despliega porque ha cambiado la web y han cambiado los datos.",
          );

          // La huella del commit ya está en la caché, pero producción sigue con lo de antes.
          yield* Ref.set(vercel.buildFalla, false);
          const otraVez = yield* unaEjecucion(vercel);
          assert.strictEqual(otraVez.motivo, fallida.motivo);
          assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
          assert.strictEqual(yield* vercel.construcciones, 2);
          assert.strictEqual(yield* vercel.despliegues, 3);
        }),
      ),
    60_000,
  );

  it.effect(
    "si producción no tiene una versión anterior que el build montaría, se despliega",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, grabada);
          yield* noche(entorno, sinUna(grabada));
          yield* noche(entorno, sinUna(grabada));
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);
          const [anterior] = yield* sellosDe(entorno);

          // Como un despliegue hecho con un build que montaba menos versiones anteriores.
          const servido = yield* vercel.servido;
          const manifiesto = ficheroDeManifiesto(anterior ?? "");
          yield* fs.remove(
            path.join(
              Option.getOrElse(servido, () => ""),
              "capas",
              manifiesto,
            ),
          );
          const comprobacion = yield* unaEjecucion(vercel);
          assert.isTrue(comprobacion.desplegar);
          assert.deepStrictEqual(comprobacion.datos, {
            tipo: "cambia",
            detalle: `Producción no sirve ${manifiesto}, que el build montaría desde R2.`,
          });
          assert.isFalse((yield* unaEjecucion(vercel)).desplegar);
        }),
      ),
    60_000,
  );

  it.effect(
    "sin la clave de R2, con R2 caído o con producción caída se despliega, y dice por qué",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, yield* muestraCampusNord);
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);

          const sinClave = yield* vercel.comprobar({
            r2: { tipo: "sin-clave", faltan: ["CELDA_R2_ID_CLAVE", "CELDA_R2_SECRETO"] },
          });
          assert.isTrue(sinClave.desplegar);
          assert.strictEqual(
            sinClave.motivo,
            "Se despliega porque no se sabe si han cambiado los datos.",
          );
          assert.deepStrictEqual(sinClave.datos, {
            tipo: "no-se-sabe",
            detalle:
              "Sin la clave de R2 de solo lectura no se sabe qué versión tiene R2. Faltan CELDA_R2_ID_CLAVE y CELDA_R2_SECRETO.",
          });

          // R2 lee y no lista. Una lectura que falla se reintenta con esperas de segundos.
          const real = yield* almacenEn(entorno.almacen);
          const caido = yield* vercel.comprobar({
            r2: {
              tipo: "cubo",
              origen: AlmacenDeFicheros.of({
                ...real,
                listar: Effect.fail(new AlmacenNoDisponible({ motivo: "R2 contesta 503" })),
              }),
            },
          });
          assert.isTrue(caido.desplegar);
          assert.deepStrictEqual(caido.datos, {
            tipo: "no-se-sabe",
            detalle: "R2 no responde (R2 contesta 503).",
          });

          const roto = yield* vercel.comprobar({
            r2: { tipo: "cubo", origen: yield* almacenEn(`${entorno.almacen}-vacio`) },
          });
          assert.deepStrictEqual(roto.datos, {
            tipo: "no-se-sabe",
            detalle: "R2 no tiene entero lo que montaría el build (no hay vigente.json).",
          });

          yield* Ref.set(vercel.caida, true);
          const sinProduccion = yield* vercel.comprobar();
          assert.isTrue(sinProduccion.desplegar);
          assert.strictEqual(
            sinProduccion.motivo,
            "Se despliega porque no se sabe qué web sirve producción y no se sabe si han cambiado los datos.",
          );
          assert.include(sinProduccion.web.detalle, "ERR_CONNECTION_RESET");
        }),
      ),
    60_000,
  );

  it.effect("a mano se despliega aunque nada cambie, y el registro dice lo que hay", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOCHE);
        yield* noche(entorno, yield* muestraCampusNord);
        const vercel = yield* vercelDePrueba(entorno);
        yield* unaEjecucion(vercel);
        const aMano = yield* vercel.comprobar({ aMano: true });
        assert.isTrue(aMano.desplegar);
        assert.strictEqual(aMano.motivo, "Se despliega porque se ha pedido a mano.");
        assert.strictEqual(aMano.web.tipo, "igual");
        assert.strictEqual(aMano.datos.tipo, "igual");
      }),
    ),
  );
});

describe("las órdenes huella-web y despliegue", () => {
  it.effect(
    "huella-web escribe la huella en su fichero, y despliegue deja en --salida, tras lo que ya tenía, lo que lee el flujo",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, yield* muestraCampusNord);
          const vercel = yield* vercelDePrueba(entorno);
          yield* unaEjecucion(vercel);

          const fichero = path.join(path.dirname(entorno.almacen), "huella-web");
          const huella = yield* ordenHuellaWeb(vercel.web, fichero);
          assert.strictEqual(yield* fs.readFileString(fichero), `${huella}\n`);

          const salida = path.join(path.dirname(entorno.almacen), "salida");
          yield* fs.writeFileString(salida, "commit=0631fc3\n");
          const commit = yield* vercel.commit;
          const argumentos = yield* argumentosDelDespliegue([
            "--salida",
            salida,
            "--huella",
            (yield* fs.readFileString(fichero)).trim(),
            "--commit",
            commit,
          ]);
          const comprobacion = yield* ordenDespliegue(argumentos, {
            tipo: "cubo",
            origen: yield* almacenEn(entorno.almacen),
          }).pipe(Effect.provide(vercel.produccion));
          assert.deepStrictEqual((yield* fs.readFileString(salida)).split("\n"), [
            "commit=0631fc3",
            "desplegar=no",
            `despliegue=${codificarDespliegue({ web: huella, commit })}`,
            "motivo=No se despliega porque producción ya sirve esta web y estos datos.",
            "",
          ]);
          const servido = Option.getOrElse(yield* vercel.servido, () => "");
          assert.strictEqual(
            yield* fs.readFileString(path.join(servido, FICHERO_DEL_DESPLIEGUE)),
            `${codificarDespliegue(comprobacion.despliegue)}\n`,
          );
          assert.isTrue(yield* fs.exists(path.join(servido, "capas", FICHERO_VIGENTE)));
        }),
      ),
  );

  it.effect("despliegue lee sus argumentos en cualquier orden, y si falta algo dice el uso", () =>
    Effect.gen(function* () {
      const huella = "c".repeat(64);
      assert.deepStrictEqual(
        yield* argumentosDelDespliegue(["--a-mano", "--commit", "abc", "--huella", huella]),
        { huella, commit: "abc", aMano: true, salida: Option.none() },
      );
      for (const mal of [
        ["--commit", "abc"],
        ["--huella", huella],
        ["--huella", huella, "--commit"],
        ["--huella", "corta", "--commit", "abc"],
        ["apps/web", "--huella", huella, "--commit", "abc"],
      ]) {
        const fallo = yield* Effect.flip(argumentosDelDespliegue(mal));
        assert.include(fallo.message, "Uso: despliegue");
      }
    }),
  );
});
