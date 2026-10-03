// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { type Caja, cajaDeCuadro, ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import { municipioDelPunto } from "@celda/dominio/municipio";
import { ExtractorPorCajas, FuenteBloqueada, type Registro } from "@celda/ingesta/extractor";
import { capaGrabadaPorCajas } from "@celda/ingesta/pruebas/grabado";
import { municipiosDeEspana } from "@celda/publicacion/zonas";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { cuadrosDeBorde, derivarCuadros, pasadaDeBorde, provinciasPorCuadro } from "./cuadros.ts";

const NOCHE = Date.UTC(2026, 9, 3, 2, 15);

/** Un registro de prueba de Movistar en `posicion`. */
const registro = (codigo: string, longitud: number, latitud: number): Registro => ({
  clave: `TELEFONICA MOVILES ESPAÑA, S.A.U. - ${codigo}`,
  compania: "movistar",
  codigo,
  posicion: { longitud, latitud },
  direccion: "CL PRUEBA, 1. MUNICIPIO, PROVINCIA",
  municipio: "MUNICIPIO",
  url: `https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=${codigo}`,
});

/** Alborán, en el cuadro `-4,35`, que no está en ninguna zona. */
const ALBORAN = registro("0400001", -3.035, 35.94);

describe("cuadros de las zonas desde el registro oficial (#55)", () => {
  it.effect(
    "los cuadros de borde son los que tocan alguna provincia y no están en ninguna zona",
    () =>
      Effect.gen(function* () {
        const indice = yield* municipiosDeEspana;
        const toca = provinciasPorCuadro(indice);
        const enZonas = ZONAS_DE_BARRIDO.flatMap((zona) => zona.cuadros);
        // Todos los cuadros de las zonas tocan alguna provincia.
        for (const cuadro of enZonas) assert.isTrue(toca.has(cuadro), cuadro);
        // Con los límites del IGN de hoy, quedan cuatro: el sur de Tenerife, el oeste de La Palma,
        // Alborán y el oeste de Cáceres.
        assert.deepStrictEqual(cuadrosDeBorde(indice), ["-17,27", "-19,28", "-4,35", "-8,40"]);
        assert.deepStrictEqual(toca.get("-4,35"), ["04"]);
      }),
  );

  it.effect(
    "la pasada pide cada cuadro una vez con el extractor y apunta sus registros por provincia",
    () =>
      Effect.gen(function* () {
        const indice = yield* municipiosDeEspana;
        yield* TestClock.setTime(NOCHE);
        const pasada = yield* pasadaDeBorde(
          ["-4,35", "-8,40"],
          (posicion) => municipioDelPunto(posicion, indice).provincia?.codigo,
        ).pipe(
          Effect.provide(
            capaGrabadaPorCajas("registro-oficial", {
              listado: { registros: [ALBORAN], avisos: [] },
              fichas: new Map(),
            }),
          ),
        );
        assert.deepStrictEqual(pasada.cuadros, [
          { cuadro: "-4,35", registros: 1, porProvincia: { "04": 1 } },
          { cuadro: "-8,40", registros: 0, porProvincia: {} },
        ]);
        assert.strictEqual(pasada.peticiones, 2);
        assert.deepStrictEqual(pasada.errores, []);
        assert.strictEqual(pasada.inicio, NOCHE);
      }),
  );

  it.effect("si la fuente bloquea, para, y apunta el fallo y los cuadros que no ha pedido", () =>
    Effect.gen(function* () {
      const pedidas: Array<Caja> = [];
      const bloqueado = Layer.succeed(
        ExtractorPorCajas,
        ExtractorPorCajas.of({
          fuente: "registro-oficial",
          caja: (caja) => {
            pedidas.push(caja);
            return Effect.fail(
              new FuenteBloqueada({ url: "https://geoportal", motivo: "HTTP 403" }),
            );
          },
          ficha: () => Effect.succeed([]),
          peticiones: Effect.sync(() => pedidas.length),
        }),
      );
      const pasada = yield* pasadaDeBorde(["-17,27", "-19,28", "-4,35"], () => undefined).pipe(
        Effect.provide(bloqueado),
      );
      assert.deepStrictEqual(pedidas, [cajaDeCuadro("-17,27")]);
      assert.deepStrictEqual(pasada.cuadros, []);
      assert.lengthOf(pasada.errores, 2);
      assert.match(pasada.errores[0] ?? "", /^-17,27: FuenteBloqueada: HTTP 403/u);
      assert.strictEqual(pasada.errores[1], "Sin pedir: -19,28 -4,35");
    }),
  );

  it.effect(
    "derivar suma los cuadros de borde con registros, y cada cuadro va a la zona de su regla",
    () =>
      Effect.gen(function* () {
        const indice = yield* municipiosDeEspana;
        const listado = {
          fuente: "prueba",
          barrido: NOCHE,
          posiciones: [
            // Barcelona, Madrid y dos en el cuadro de Ávila y Segovia, de Castilla y León.
            { longitud: 2.17, latitud: 41.39 },
            { longitud: -3.7, latitud: 40.42 },
            { longitud: -4.7, latitud: 40.66 },
            { longitud: -4.12, latitud: 40.95 },
          ],
        };
        const borde = {
          inicio: NOCHE,
          fin: NOCHE + 20_000,
          peticiones: 3,
          bytes: 621,
          cuadros: [
            { cuadro: "-4,35", registros: 1, porProvincia: { "04": 1 } },
            { cuadro: "-8,40", registros: 0, porProvincia: {} },
          ],
          errores: [],
        };
        const derivados = derivarCuadros(listado, borde, indice);
        if (Result.isFailure(derivados)) return assert.fail(derivados.failure.message);
        assert.deepStrictEqual(
          derivados.success.cuadros.map((c) => [c.cuadro, c.zona, c.registros]),
          [
            ["2,41", "cataluna", 1],
            ["-4,40", "centro", 1],
            ["-4,35", "andalucia", 1],
            ["-5,40", "ebro-y-duero", 2],
          ],
        );
        assert.strictEqual(derivados.success.registros, 5);
        assert.deepStrictEqual(derivados.success.cuadros.at(-1)?.porProvincia, {
          "05": 1,
          "40": 1,
        });
        assert.strictEqual(derivados.success.borde, borde);
      }),
  );
});
