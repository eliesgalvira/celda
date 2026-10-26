// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { ficheroDeBaremo, leerBaremo } from "@celda/dominio/baremo";
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import {
  decodificarManifiesto,
  ficheroDeManifiesto,
  leerCapaDeProvincia,
  leerResumen,
  selloDeVersion,
} from "@celda/dominio/provincias";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";

import { montarCapasEn } from "./capas.ts";
import { conEntorno, contenidoDe, type Entorno, unaNoche } from "./pruebas/entorno.ts";

/** Un manifiesto de publicación escrito a mano, para las publicaciones a medias. */
const codificarManifiesto = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ version: Schema.String, ficheros: Schema.Array(Schema.String) }),
  ),
);

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

const registroOficial = (grabada: FuenteGrabada) =>
  capaGrabadaPorCajas("registro-oficial", grabada);

/** La muestra sin las estaciones de `claves`: otra versión de los datos. */
const sin = (grabada: FuenteGrabada, claves: ReadonlyArray<string>): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.filter((r) => !claves.includes(r.clave)),
  },
});

/** La muestra sin una estación de Vodafone. */
const sinUna = (grabada: FuenteGrabada): FuenteGrabada =>
  sin(grabada, ["VODAFONE ESPAÑA, S.A.U. - 079808"]);

/** Un almacén en una carpeta del disco, como lo ve el build: un servicio ya montado. */
const almacenEn = (carpeta: string) =>
  Effect.service(AlmacenDeFicheros).pipe(
    Effect.provide(
      almacenEnCarpeta({ carpeta, origen: "/capas" }).pipe(Layer.provide(NodeServices.layer)),
    ),
  );

/**
 * La orden `capas` como la lanza el build: del almacén en `origen`, que hace de cubo de R2, a una
 * carpeta nueva. `escritos` apunta en orden lo que escribe en la carpeta.
 */
const montar = (origen: string, carpeta: string, escritos?: Ref.Ref<ReadonlyArray<string>>) =>
  Effect.gen(function* () {
    const deR2 = yield* almacenEn(origen);
    const destino = yield* almacenEn(carpeta);
    const apuntar = (fichero: string) =>
      escritos === undefined ? Effect.void : Ref.update(escritos, (e) => [...e, fichero]);
    const vigilado = AlmacenDeFicheros.of({
      ...destino,
      guardar: (fichero, contenido) =>
        Effect.tap(destino.guardar(fichero, contenido), () => apuntar(fichero)),
      cambiarVigente: (contenido) =>
        Effect.tap(destino.cambiarVigente(contenido), () => apuntar(FICHERO_VIGENTE)),
    });
    return yield* montarCapasEn(deR2, carpeta).pipe(
      Effect.provideService(AlmacenDeFicheros, vigilado),
    );
  }).pipe(Effect.provide(NodeServices.layer));

/** Por qué ha fallado el montaje: el motivo de unas capas incompletas, o la etiqueta del error. */
const porQue = (fallo: Effect.Error<ReturnType<typeof montar>>): string =>
  fallo._tag === "CapasIncompletas" ? fallo.motivo : fallo._tag;

/**
 * Un build de Vercel tras las noches de la prueba: la orden `capas`, que lee del almacén del
 * entorno como el build lee de R2, en una carpeta nueva. Devuelve la carpeta.
 */
const construir = (entorno: Entorno) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const destino = path.join(path.dirname(entorno.almacen), "vercel", "capas");
    yield* montar(entorno.almacen, destino);
    return destino;
  });

/** El sello de la versión vigente de un almacén. */
const selloVigente = (almacen: ReadonlyMap<string, string>): string => {
  const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
  if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
  return selloDeVersion(vigente.success.version);
};

/** Los ficheros que lista el manifiesto de una versión de un almacén. */
const listadosEn = (almacen: ReadonlyMap<string, string>, sello: string) => {
  const manifiesto = ficheroDeManifiesto(sello);
  const listados = decodificarManifiesto(almacen.get(manifiesto) ?? "");
  if (Result.isFailure(listados)) return assert.fail(`${manifiesto} no se entiende`);
  return listados.success.ficheros;
};

/** Los sellos de los manifiestos de un almacén, del más viejo al más reciente. */
const sellosDe = (almacen: ReadonlyMap<string, string>) =>
  [...almacen.keys()].flatMap((f) => /^ficheros@(.+)\.json$/u.exec(f)?.[1] ?? []).toSorted();

/**
 * Lo que pediría una pestaña abierta con un resumen: la capa de cada provincia que lista, los
 * lotes de fichas de esa capa y las partes del índice de claves.
 */
const loQuePideUnaPestana = (almacen: ReadonlyMap<string, string>, resumen: string) => {
  const contenido = almacen.get(resumen) ?? "";
  const version = `sitios@${/^resumen@([^.]+)\./u.exec(resumen)?.[1] ?? ""}`;
  const leido = leerResumen(contenido, version);
  if (Result.isFailure(leido)) return assert.fail(`${resumen} no se entiende`);
  return [
    ...leido.success.claves,
    ...leido.success.provincias.flatMap((provincia) => {
      if (provincia.fichero === undefined) return [];
      const capa = leerCapaDeProvincia(almacen.get(provincia.fichero) ?? "", provincia.codigo);
      if (Result.isFailure(capa)) return assert.fail(`${provincia.fichero} no se entiende`);
      return [provincia.fichero, ...capa.success.lotes];
    }),
  ];
};

describe("las capas en Vercel", () => {
  it.effect(
    "el build monta la vigente y las dos anteriores, y nada de la cuarta",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          // Cuatro versiones: cada estación que falta en dos barridos seguidos se retira.
          const claves = grabada.listado.registros.map((r) => r.clave).slice(0, 3);
          const muestras = [grabada, ...claves.map((_, i) => sin(grabada, claves.slice(0, i + 1)))];
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, registroOficial(grabada));
          for (const muestra of muestras.slice(1)) {
            yield* TestClock.adjust(DIA);
            const barrido = yield* unaNoche(entorno, registroOficial(muestra));
            assert.strictEqual(barrido.publicacion.tipo, "barrido");
            yield* TestClock.adjust(DIA);
            const nueva = yield* unaNoche(entorno, registroOficial(muestra));
            assert.strictEqual(nueva.publicacion.tipo, "publicada");
          }

          const almacen = yield* contenidoDe(entorno.almacen);
          const montado = yield* contenidoDe(yield* construir(entorno));
          const sellos = sellosDe(almacen);
          assert.lengthOf(sellos, 4);
          const [vieja, ...montadas] = sellos;
          assert.strictEqual(montadas.at(-1), selloVigente(almacen));

          // La vigente y las dos anteriores, cada una con su manifiesto, el resumen de la vigente
          // y vigente.json; nada de la cuarta que no compartan. Igual byte a byte que R2, salvo el
          // baremo de exposición de la vigente, que calcula el build (ADR 0030).
          const vigente = `sitios@${selloVigente(almacen)}`;
          const baremo = ficheroDeBaremo(vigente, "08");
          const esperados = new Set([
            FICHERO_VIGENTE,
            ...(almacen.get(FICHERO_VIGENTE)?.match(/resumen@[^"]+/u) ?? []),
            ...montadas.flatMap((s) => [ficheroDeManifiesto(s), ...listadosEn(almacen, s)]),
            baremo,
          ]);
          assert.deepStrictEqual([...montado.keys()].toSorted(), [...esperados].toSorted());
          for (const [fichero, contenido] of [...montado].filter(([f]) => f !== baremo)) {
            assert.strictEqual(contenido, almacen.get(fichero), fichero);
          }
          assert.isFalse(almacen.has(baremo));
          assert.isTrue(Result.isSuccess(leerBaremo(montado.get(baremo) ?? "", vigente, "08")));
          const soloDeLaVieja = listadosEn(almacen, vieja ?? "").filter((f) => !esperados.has(f));
          assert.isNotEmpty(soloDeLaVieja);
          assert.isTrue(soloDeLaVieja.every((f) => !montado.has(f)));
        }),
      ),
    60_000,
  );

  it.effect(
    "una pestaña abierta con cualquiera de las dos versiones anteriores abre sus provincias y sus fichas",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          const claves = grabada.listado.registros.map((r) => r.clave).slice(0, 2);
          yield* TestClock.setTime(NOCHE);
          // Cada pestaña abre con el resumen vigente la noche en que se abrió.
          const resumenes: Array<string> = [];
          const apuntar = Effect.gen(function* () {
            const publicado = yield* contenidoDe(entorno.almacen);
            const resumen = publicado.get(FICHERO_VIGENTE)?.match(/resumen@[^"]+/u)?.[0];
            if (resumen !== undefined) resumenes.push(resumen);
          });
          yield* unaNoche(entorno, registroOficial(grabada));
          yield* apuntar;
          for (const muestra of [sin(grabada, claves.slice(0, 1)), sin(grabada, claves)]) {
            for (let noche = 0; noche < 2; noche++) {
              yield* TestClock.adjust(DIA);
              yield* unaNoche(entorno, registroOficial(muestra));
              yield* apuntar;
            }
          }
          const almacen = yield* contenidoDe(entorno.almacen);
          assert.lengthOf(sellosDe(almacen), 3);
          const montado = yield* contenidoDe(yield* construir(entorno));
          // Los cinco resúmenes que ha habido: tres versiones, dos con un barrido más.
          assert.lengthOf(new Set(resumenes), 5);
          for (const resumen of resumenes) {
            const pedidos = loQuePideUnaPestana(almacen, resumen);
            assert.isNotEmpty(pedidos);
            const faltan = pedidos.filter((f) => !montado.has(f));
            assert.deepStrictEqual(faltan, [], `una pestaña con ${resumen} no los encuentra`);
          }
        }),
      ),
    60_000,
  );

  describe("la orden capas", () => {
    /**
     * Un almacén con dos versiones publicadas, que hace de cubo de R2, y una carpeta vacía al
     * lado para las capas.
     */
    const publicado = <A, E, R>(
      prueba: (almacen: string, destino: string) => Effect.Effect<A, E, R>,
    ) =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          yield* unaNoche(entorno, registroOficial(grabada));
          for (let noche = 0; noche < 2; noche++) {
            yield* TestClock.adjust(DIA);
            yield* unaNoche(entorno, registroOficial(sinUna(grabada)));
          }
          assert.lengthOf(sellosDe(yield* contenidoDe(entorno.almacen)), 2);
          return yield* prueba(entorno.almacen, path.join(path.dirname(entorno.almacen), "capas"));
        }),
      );

    it.effect("monta las dos versiones y escribe vigente.json el último", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const escritos = yield* Ref.make<ReadonlyArray<string>>([]);
          const montadas = yield* montar(almacen, destino, escritos);
          const publicadas = yield* contenidoDe(almacen);
          const [anterior, vigente] = sellosDe(publicadas);
          assert.strictEqual(montadas.version, `sitios@${vigente}`);
          assert.deepStrictEqual(montadas.anteriores, [`sitios@${anterior}`]);
          const orden = yield* Ref.get(escritos);
          assert.strictEqual(orden.at(-1), FICHERO_VIGENTE);
          assert.strictEqual(orden.filter((f) => f === FICHERO_VIGENTE).length, 1);
          assert.strictEqual(montadas.ficheros, orden.length);
        }),
      ),
    );

    it.effect("falta un lote de la vigente: falla y no escribe vigente.json", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const publicadas = yield* contenidoDe(almacen);
          const lote = listadosEn(publicadas, selloVigente(publicadas)).find((f) =>
            f.startsWith("fichas/"),
          );
          yield* fs.remove(path.join(almacen, lote ?? ""));
          const fallo = yield* Effect.flip(montar(almacen, destino));
          assert.strictEqual(porQue(fallo), `falta ${lote}`);
          assert.isFalse(yield* fs.exists(path.join(destino, FICHERO_VIGENTE)));
        }),
      ),
    );

    it.effect("falta un fichero de la versión anterior: falla y no escribe vigente.json", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const publicadas = yield* contenidoDe(almacen);
          const [anterior, vigente] = sellosDe(publicadas);
          const deLaVigente = new Set(listadosEn(publicadas, vigente ?? ""));
          const suyo = listadosEn(publicadas, anterior ?? "").find((f) => !deLaVigente.has(f));
          assert.isDefined(suyo);
          yield* fs.remove(path.join(almacen, suyo ?? ""));
          const fallo = yield* Effect.flip(montar(almacen, destino));
          assert.strictEqual(porQue(fallo), `falta ${suyo}`);
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
          const fallo = yield* Effect.flip(montar(almacen, destino));
          assert.strictEqual(porQue(fallo), `${capa} no coincide con su huella`);
          assert.isFalse(yield* fs.exists(path.join(destino, FICHERO_VIGENTE)));
        }),
      ),
    );

    it.effect("no monta una publicación a medias, posterior a la vigente", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const medias = ficheroDeManifiesto("2099-01-01T00:00:00Z");
          const manifiesto = yield* codificarManifiesto({
            version: "sitios@2099-01-01T00:00:00Z",
            ficheros: ["fichas/08/x.json"],
          });
          yield* fs.writeFileString(path.join(almacen, medias), manifiesto);
          const montadas = yield* montar(almacen, destino);
          assert.lengthOf(montadas.anteriores, 1);
          assert.isFalse(yield* fs.exists(path.join(destino, medias)));
        }),
      ),
    );

    it.effect("las copias de la base y el archivo de páginas del cubo nunca se montan", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          for (const privado of [
            "copias/ingesta-2026-09-26T02-15-00.000Z.sqlite.gz",
            "archivo/archivo-2026-09-26T02-15-00.000Z.sqlite",
          ]) {
            yield* fs.makeDirectory(path.join(almacen, path.dirname(privado)), {
              recursive: true,
            });
            yield* fs.writeFileString(path.join(almacen, privado), "privado");
          }
          yield* montar(almacen, destino);
          const montados = yield* fs.readDirectory(destino, { recursive: true });
          assert.isFalse(montados.some((f) => f.startsWith("copias") || f.startsWith("archivo")));

          // Aunque un manifiesto lo liste por un error, el build falla sin escribir vigente.json.
          const publicadas = yield* contenidoDe(almacen);
          const sello = selloVigente(publicadas);
          const manifiesto = yield* codificarManifiesto({
            version: `sitios@${sello}`,
            ficheros: [
              ...listadosEn(publicadas, sello),
              "archivo/archivo-2026-09-26T02-15-00.000Z.sqlite",
            ],
          });
          yield* fs.writeFileString(path.join(almacen, ficheroDeManifiesto(sello)), manifiesto);
          const otro = path.join(path.dirname(destino), "otras-capas");
          const fallo = yield* Effect.flip(montar(almacen, otro));
          assert.strictEqual(
            porQue(fallo),
            "un manifiesto lista ficheros privados: archivo/archivo-2026-09-26T02-15-00.000Z.sqlite",
          );
          assert.isFalse(yield* fs.exists(path.join(otro, FICHERO_VIGENTE)));
        }),
      ),
    );

    it.effect("no monta en una carpeta que ya tiene algo", () =>
      publicado((almacen, destino) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* fs.makeDirectory(destino, { recursive: true });
          yield* fs.writeFileString(path.join(destino, "otra.json"), "{}");
          const fallo = yield* Effect.flip(montar(almacen, destino));
          assert.strictEqual(porQue(fallo), "CarpetaOcupada");
        }),
      ),
    );

    it.effect("sin nada publicado falla", () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fallo = yield* Effect.flip(
            montar(entorno.almacen, path.join(path.dirname(entorno.almacen), "capas")),
          );
          assert.strictEqual(porQue(fallo), "no hay vigente.json");
        }),
      ),
    );
  });
});
