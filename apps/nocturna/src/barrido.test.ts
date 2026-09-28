// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type Caja,
  Caja as CajaEsquema,
  type ZonaDeBarrido,
  ZONAS_DE_BARRIDO,
} from "@celda/dominio/barrido";
import type { OpcionesZonas } from "@celda/ingesta/barrido";
import { ExtractorPorCajas, RespuestaInesperada } from "@celda/ingesta/extractor";
import { ObservacionGuardada } from "@celda/ingesta/guardado";
import {
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { NodeServices } from "@effect/platform-node";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BaseNocturna, ESQUEMA } from "./base.ts";
import { describirResumen } from "./estado.ts";
import {
  conBase,
  conEntorno,
  type Entorno,
  OPCIONES_BARRIDO,
  tablasDe,
  unaNoche,
} from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

/** Dos zonas de un cuadro cada una: el de Barcelona y el de al lado, hacia el oeste. */
const A: ZonaDeBarrido = { nombre: "a", titulo: "A", cuadros: ["2,41"] };
const B: ZonaDeBarrido = { nombre: "b", titulo: "B", cuadros: ["1,41"] };

const cadaNoche = (...zonas: ReadonlyArray<ZonaDeBarrido>): OpcionesZonas => ({
  cadaNoche: zonas,
  enTurno: [],
  porNoche: 1,
});
const porTurnos = (...zonas: ReadonlyArray<ZonaDeBarrido>): OpcionesZonas => ({
  cadaNoche: [],
  enTurno: zonas,
  porNoche: 1,
});

/** La muestra de Campus Nord con la mitad de sus registros movidos 1° al oeste, a la zona B. */
const repartida = (grabada: FuenteGrabada): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.map((r, i) =>
      i % 2 === 0 ? r : { ...r, posicion: { ...r.posicion, longitud: r.posicion.longitud - 1 } },
    ),
  },
});

const sin = (grabada: FuenteGrabada, clave: string): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.filter((r) => r.clave !== clave),
  },
});

const movida = (grabada: FuenteGrabada, clave: string, longitud: number): FuenteGrabada => ({
  ...grabada,
  listado: {
    ...grabada.listado,
    registros: grabada.listado.registros.map((r) =>
      r.clave === clave ? { ...r, posicion: { ...r.posicion, longitud } } : r,
    ),
  },
});

/** El registro de la zona A (cuadro 2,41) y el de la zona B (cuadro 1,41) que se siguen. */
const claveEn = (grabada: FuenteGrabada, cuadro: "2,41" | "1,41") => {
  const registro = grabada.listado.registros.find(
    (r) => Math.floor(r.posicion.longitud) === Number(cuadro.split(",")[0]),
  );
  assert.isDefined(registro);
  return registro.clave;
};

/**
 * La fuente grabada, con las cajas de un cuadro que fallan como una respuesta ilegible del
 * geoportal, y apuntando qué cajas se piden.
 */
const conFallos = (
  grabada: FuenteGrabada,
  opciones: {
    readonly fallaEn?: string;
    readonly pedidas?: Ref.Ref<ReadonlyArray<Caja>>;
    readonly tope?: number;
  } = {},
) =>
  Layer.effect(
    ExtractorPorCajas,
    Effect.map(ExtractorPorCajas, (real) =>
      ExtractorPorCajas.of({
        ...real,
        caja: (caja) =>
          Effect.gen(function* () {
            if (opciones.pedidas !== undefined) {
              yield* Ref.update(opciones.pedidas, (p) => [...p, caja]);
            }
            if (opciones.fallaEn === `${Math.floor(caja[0])},${Math.floor(caja[1])}`) {
              return yield* new RespuestaInesperada({
                url: "bbox",
                motivo: "HTTP 500 sin reintento",
              });
            }
            return yield* real.caja(caja);
          }),
      }),
    ),
  ).pipe(Layer.provide(capaGrabadaPorCajas("registro-oficial", grabada, opciones.tope)));

const registro = (grabada: FuenteGrabada) => capaGrabadaPorCajas("registro-oficial", grabada);

const noche = (entorno: Entorno, extractor: Layer.Layer<ExtractorPorCajas>, zonas: OpcionesZonas) =>
  unaNoche(entorno, extractor, { proceso: { ...OPCIONES_BARRIDO, zonas } });

interface Observada {
  readonly clave: string;
  readonly cuadro: string;
  readonly ausencias: number;
  readonly retirada: boolean;
}

const decodificarObservadas = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      clave: Schema.String,
      cuadro: Schema.String,
      ausencias: Schema.Int,
      retirada: Schema.Int,
    }),
  ),
);
const decodificarCajas = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(CajaEsquema)));
const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));

/** Cada observación con su cuadro, sus ausencias y si está retirada, leídas de la base. */
const observadas = (entorno: Entorno) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const filas = yield* sql`SELECT clave, cuadro,
        json_extract(datos, '$.ausencias') AS ausencias, retirada_en IS NOT NULL AS retirada
      FROM observaciones`;
    const leidas = yield* decodificarObservadas(filas);
    return new Map(
      leidas.map((fila): [string, Observada] => [
        fila.clave,
        { ...fila, retirada: fila.retirada === 1 },
      ]),
    );
  }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

const observada = (entorno: Entorno, clave: string) =>
  Effect.map(observadas(entorno), (todas) => {
    const una = todas.get(clave);
    assert.isDefined(una, clave);
    return una;
  });

/** La última ejecución del registro oficial en la base. */
const ultimaEjecucion = (entorno: Entorno) =>
  conBase(
    entorno.base,
    Effect.flatMap(BaseNocturna, (base) =>
      Effect.map(base.resumen(NOCHE), (resumen) => {
        const fuente = resumen.fuentes.find((f) => f.fuente === "registro-oficial");
        assert.isDefined(fuente?.ultima);
        return fuente.ultima;
      }),
    ),
  );

describe("barrido por zonas (base SQLite, registro oficial grabado)", () => {
  it.effect(
    "con Cataluña pide cada cuadro una vez y apunta las peticiones, los bytes y los cambios",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = yield* muestraCampusNord;
          yield* TestClock.setTime(NOCHE);
          const hecha = yield* unaNoche(entorno, capaGrabadaPorCajas("registro-oficial", grabada));
          assert.strictEqual(hecha.publicacion.tipo, "publicada");

          const ultima = yield* ultimaEjecucion(entorno);
          assert.strictEqual(ultima.estado, "completada");
          assert.strictEqual(ultima.registros, 40);
          assert.deepStrictEqual(ultima.zonas, [
            {
              zona: "cataluna",
              estado: "completado",
              cuadros: 9,
              peticiones: 9,
              bytes: 40 * 617 + 8 * 2,
              registros: 40,
              observaciones: { creados: 40, cambiados: 0, retirados: 0 },
            },
          ]);
          const texto = yield* conBase(
            entorno.base,
            Effect.flatMap(BaseNocturna, (base) =>
              Effect.map(base.resumen(NOCHE), (r) => describirResumen(entorno.base, r)),
            ),
          );
          assert.include(
            texto,
            "- cataluna: completado, 9 cuadros, 9 peticiones, 25 kB, 40 registros; " +
              "observaciones +40 ~0 -0",
          );
          assert.include(texto, "- cataluna: último barrido completado 2026-09-26 02:15:00 UTC");
        }),
      ),
  );

  it.effect("una pasada sin cambios pide solo las cajas guardadas, ninguna en el tope", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const pedidas = yield* Ref.make<ReadonlyArray<Caja>>([]);
        // Con un tope de 8, los 40 registros de Campus Nord obligan a dividir su cuadro.
        const fuente = conFallos(grabada, { pedidas, tope: 8 });
        yield* TestClock.setTime(NOCHE);
        yield* noche(entorno, fuente, cadaNoche(A));
        const primera = yield* Ref.getAndSet(pedidas, []);
        const guardadas = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [fila] = yield* sql<{ readonly cajas: string }>`SELECT cajas FROM cuadros
              WHERE cuadro = '2,41'`;
          return yield* decodificarCajas(fila?.cajas ?? "[]");
        }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
        assert.isAbove(primera.length, guardadas.length);
        assert.isAbove(guardadas.length, 1);

        yield* TestClock.adjust(DIA);
        yield* noche(entorno, fuente, cadaNoche(A));
        assert.deepStrictEqual(yield* Ref.get(pedidas), guardadas);
        const ultima = yield* ultimaEjecucion(entorno);
        assert.strictEqual(ultima.zonas?.[0]?.peticiones, guardadas.length);
        assert.strictEqual(ultima.registros, 40);
      }),
    ),
  );

  it.effect(
    "una zona que falla no cuenta ausencias en ninguna, y retirar exige dos barridos de la misma",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabada = repartida(yield* muestraCampusNord);
          const enA = claveEn(grabada, "2,41");
          const enB = claveEn(grabada, "1,41");
          yield* TestClock.setTime(NOCHE);
          yield* noche(entorno, registro(grabada), cadaNoche(A, B));

          // Segunda noche: la zona A falla y a B le falta una estación. A tampoco trae la suya.
          const sinLasDos = sin(sin(grabada, enA), enB);
          yield* TestClock.adjust(DIA);
          const segunda = yield* noche(
            entorno,
            conFallos(sinLasDos, { fallaEn: "2,41" }),
            cadaNoche(A, B),
          );
          assert.deepStrictEqual(
            segunda.ejecuciones[0]?.zonas.map((z) => [z.zona, z.estado]),
            [
              ["a", "fallido"],
              ["b", "completado"],
            ],
          );
          assert.strictEqual((yield* observada(entorno, enA)).ausencias, 0);
          assert.strictEqual((yield* observada(entorno, enB)).ausencias, 1);
          const ultima = yield* ultimaEjecucion(entorno);
          assert.strictEqual(ultima.estado, "completada");
          assert.include(ultima.errores.join("\n"), "Zona a: RespuestaInesperada");

          // Tercera: las dos bien y sin las dos estaciones. B lleva dos barridos seguidos sin la
          // suya y la retira; A, uno.
          yield* TestClock.adjust(DIA);
          yield* noche(entorno, registro(sinLasDos), cadaNoche(A, B));
          assert.isTrue((yield* observada(entorno, enB)).retirada);
          const deA = yield* observada(entorno, enA);
          assert.isFalse(deA.retirada);
          assert.strictEqual(deA.ausencias, 1);

          yield* TestClock.adjust(DIA);
          yield* noche(entorno, registro(sinLasDos), cadaNoche(A, B));
          assert.isTrue((yield* observada(entorno, enA)).retirada);
        }),
      ),
  );

  it.effect("con las zonas por turnos, retirar espera al segundo barrido de su zona", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = repartida(yield* muestraCampusNord);
        const enA = claveEn(grabada, "2,41");
        yield* TestClock.setTime(NOCHE);
        yield* noche(entorno, registro(grabada), cadaNoche(A, B));

        const sinEnA = sin(grabada, enA);
        const turnos: Array<string> = [];
        for (let n = 0; n < 3; n++) {
          yield* TestClock.adjust(DIA);
          const hecha = yield* noche(entorno, registro(sinEnA), porTurnos(A, B));
          turnos.push(...(hecha.ejecuciones[0]?.zonas.map((z) => z.zona) ?? []));
          const deA = yield* observada(entorno, enA);
          // Tras A (una ausencia), tras B (sigue igual) y tras A otra vez (retirada).
          assert.deepStrictEqual(
            [deA.ausencias, deA.retirada],
            [
              [1, false],
              [1, false],
              [2, true],
            ][n],
          );
        }
        assert.deepStrictEqual(turnos, ["a", "b", "a"]);
      }),
    ),
  );

  it.effect("una estación que se mueve a un cuadro de otra zona no se retira", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = repartida(yield* muestraCampusNord);
        const enA = claveEn(grabada, "2,41");
        yield* TestClock.setTime(NOCHE);
        yield* noche(entorno, registro(grabada), cadaNoche(A, B));

        // Pasa del cuadro 2,41 (zona A) al 1,41 (zona B). Las zonas se turnan, así que la
        // primera noche A no la ve y B aún no la ha visto en su sitio nuevo.
        const movidaAB = movida(grabada, enA, 1.9);
        for (let n = 0; n < 5; n++) {
          yield* TestClock.adjust(DIA);
          yield* noche(entorno, registro(movidaAB), porTurnos(A, B));
          assert.isFalse((yield* observada(entorno, enA)).retirada, `noche ${n + 1}`);
        }
        const ahora = yield* observada(entorno, enA);
        assert.strictEqual(ahora.cuadro, "1,41");
        assert.strictEqual(ahora.ausencias, 0);

        // Y si vuelve con las dos zonas la misma noche, tampoco.
        for (let n = 0; n < 2; n++) {
          yield* TestClock.adjust(DIA);
          yield* noche(entorno, registro(grabada), cadaNoche(A, B));
        }
        const vuelta = yield* observada(entorno, enA);
        assert.deepStrictEqual(
          [vuelta.cuadro, vuelta.ausencias, vuelta.retirada],
          ["2,41", 0, false],
        );
      }),
    ),
  );

  it.effect("un cuadro vacío que tenía estaciones es un fallo de la fuente y no retira nada", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* noche(entorno, registro(grabada), cadaNoche(A));
        const vacia: FuenteGrabada = { ...grabada, listado: { registros: [], avisos: [] } };
        for (let n = 0; n < 3; n++) {
          yield* TestClock.adjust(DIA);
          const hecha = yield* noche(entorno, registro(vacia), cadaNoche(A));
          assert.strictEqual(hecha.ejecuciones[0]?.estado, "fallida");
        }
        const ultima = yield* ultimaEjecucion(entorno);
        assert.strictEqual(ultima.zonas?.[0]?.estado, "fallido");
        assert.include(
          ultima.zonas?.[0]?.error ?? "",
          "el listado del cuadro 2,41 ha vuelto vacío y la base tiene 40 estaciones vigentes",
        );
        const todas = yield* observadas(entorno);
        assert.strictEqual(todas.size, 40);
        assert.isTrue([...todas.values()].every((o) => o.ausencias === 0 && !o.retirada));
      }),
    ),
  );

  it.effect("un barrido cortado a mitad se retoma sin repetir los cuadros guardados", () =>
    Effect.gen(function* () {
      const grabada = yield* muestraCampusNord.pipe(Effect.provide(NodeServices.layer));
      yield* TestClock.setTime(NOCHE);
      // Se va la luz al pedir el quinto cuadro de Cataluña (3,41), con 2,41 ya guardado.
      const cortada = Layer.effect(
        ExtractorPorCajas,
        Effect.gen(function* () {
          const pedidas = yield* Ref.make(0);
          const real = yield* ExtractorPorCajas;
          return ExtractorPorCajas.of({
            ...real,
            caja: (caja) =>
              Effect.flatMap(
                Ref.updateAndGet(pedidas, (n) => n + 1),
                (n) => (n === 5 ? Effect.die("se ha ido la luz") : real.caja(caja)),
              ),
          });
        }),
      ).pipe(Layer.provide(capaGrabadaPorCajas("registro-oficial", grabada)));
      const pedidas = yield* Ref.make<ReadonlyArray<Caja>>([]);

      const retomada = yield* conEntorno((entorno) =>
        Effect.gen(function* () {
          assert.isTrue(Exit.isFailure(yield* Effect.exit(unaNoche(entorno, cortada))));
          const aMedias = yield* conBase(
            entorno.base,
            Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)),
          );
          const registro = aMedias.fuentes.find((f) => f.fuente === "registro-oficial");
          assert.deepStrictEqual(registro?.zonas, [
            { zona: "cataluna", completado: null, aMedias: true },
          ]);
          assert.strictEqual(registro?.vigentes, 40);

          yield* unaNoche(entorno, conFallos(grabada, { pedidas }));
          return {
            tablas: yield* tablasDe(entorno.base),
            ultima: yield* ultimaEjecucion(entorno),
          };
        }),
      );
      // Solo pide los cinco cuadros que faltaban.
      assert.deepStrictEqual(
        (yield* Ref.get(pedidas)).map((caja) => `${caja[0]},${caja[1]}`),
        ["3,41", "0,42", "1,42", "2,42", "3,42"],
      );
      assert.strictEqual(retomada.ultima.zonas?.[0]?.cuadros, 5);
      assert.strictEqual(retomada.ultima.zonas?.[0]?.estado, "completado");

      const completa = yield* conEntorno((entorno) =>
        Effect.andThen(
          unaNoche(entorno, capaGrabadaPorCajas("registro-oficial", grabada)),
          tablasDe(entorno.base),
        ),
      );
      assert.deepStrictEqual(retomada.tablas, completa);
    }),
  );

  it.effect("un cuadro en el tope tras las divisiones máximas hace fallar su zona", () =>
    conEntorno((entorno) =>
      Effect.gen(function* () {
        const grabada = yield* muestraCampusNord;
        const [uno, dos] = grabada.listado.registros;
        assert.isDefined(uno);
        assert.isDefined(dos);
        const juntas: FuenteGrabada = {
          ...grabada,
          listado: { registros: [uno, { ...dos, posicion: uno.posicion }], avisos: [] },
        };
        yield* TestClock.setTime(NOCHE);
        const hecha = yield* noche(entorno, conFallos(juntas, { tope: 2 }), cadaNoche(A));
        assert.strictEqual(hecha.ejecuciones[0]?.estado, "fallida");
        const ultima = yield* ultimaEjecucion(entorno);
        assert.include(ultima.zonas?.[0]?.error ?? "", "CuadroSinDividir");
        assert.strictEqual(ultima.registros, null);
        assert.strictEqual((yield* observadas(entorno)).size, 0);
      }),
    ),
  );

  it.effect("el módulo de NixOS acepta las mismas zonas de barrido que el programa", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const modulo = yield* fs.readFileString(
        path.join(
          yield* path.fromFileUrl(new URL(".", import.meta.url)),
          "../../../nix/nocturna-nixos.mod.nix",
        ),
      );
      const enumerado = /zonaDeBarrido = enum \[([^\]]*)\]/u.exec(modulo)?.[1] ?? "";
      const enNix = [...enumerado.matchAll(/"([^"]+)"/gu)].map((nombre) => nombre[1]);
      assert.deepStrictEqual(
        enNix,
        ZONAS_DE_BARRIDO.map((zona) => zona.nombre),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "una base de antes del barrido por zonas se pone al día con el cuadro de cada una",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const grabada = yield* muestraCampusNord;
          const [enMadrid, quitada] = grabada.listado.registros;
          assert.isDefined(enMadrid);
          assert.isDefined(quitada);
          // Una base con solo la primera versión del esquema y las observaciones de una noche, una
          // de ellas en Madrid.
          yield* fs.makeDirectory(path.dirname(entorno.base), { recursive: true });
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            for (const sentencia of ESQUEMA[0] ?? []) yield* sql.unsafe(sentencia);
            yield* sql.unsafe("PRAGMA user_version = 1");
            for (const r of grabada.listado.registros) {
              const datos = yield* codificarObservacion({
                ...r,
                posicion: r === enMadrid ? { longitud: -3.7, latitud: 40.4 } : r.posicion,
                fuente: "registro-oficial",
                afirma: "presente",
                bandas: [],
                fecha: NOCHE - DIA,
                fichaLeidaEn: null,
                ausencias: 0,
                retiradaEn: null,
              });
              yield* sql`INSERT INTO observaciones ${sql.insert({
                fuente: "registro-oficial",
                clave: r.clave,
                ficha_leida_en: null,
                retirada_en: null,
                datos,
              })}`;
            }
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));

          yield* conBase(entorno.base, Effect.asVoid(BaseNocturna));
          const antes = yield* observadas(entorno);
          assert.strictEqual(antes.get(enMadrid.clave)?.cuadro, "-4,40");
          assert.strictEqual(antes.get(quitada.clave)?.cuadro, "2,41");

          // La primera noche por zonas cuenta una ausencia a la del cuadro de la zona que el
          // listado ya no trae, y ninguna a la de Madrid, que no es de la zona.
          yield* TestClock.setTime(NOCHE);
          yield* noche(
            entorno,
            registro(sin(sin(grabada, enMadrid.clave), quitada.clave)),
            cadaNoche(A),
          );
          const despues = yield* observadas(entorno);
          assert.strictEqual(despues.get(quitada.clave)?.ausencias, 1);
          assert.strictEqual(despues.get(enMadrid.clave)?.ausencias, 0);
          assert.strictEqual([...despues.values()].filter((o) => o.ausencias > 0).length, 1);
        }),
      ),
  );
});
