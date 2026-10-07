// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { FichaLeida } from "./extractor.ts";
import { huellaDeFicha, observacionDe, type ObservacionGuardada, trasFicha } from "./guardado.ts";
import { conFilasRotadas } from "./pruebas/ficha.ts";
import { leerMuestra } from "./pruebas/grabado.ts";
import { bandasDeFilas, leerFicha, medidasDeFilas } from "./registro-oficial/normalizar.ts";
import { decodificarLatin1 } from "./texto.ts";

const conMuestras = Effect.provide(NodeServices.layer);

const DIA = 24 * 60 * 60 * 1000;
const ANTES = Date.UTC(2026, 8, 30);
const HOY = ANTES + 7 * DIA;

const MEDIDAS = [
  { distanciaMetros: 47, acimutGrados: 1, microvatiosPorCm2: 0.46922 },
  { distanciaMetros: 49, acimutGrados: 90, microvatiosPorCm2: 0.12 },
];

/** Una observación del registro leída antes de que Celda guardara las medidas de exposición. */
const leidaSinMedidas: ObservacionGuardada = {
  fuente: "registro-oficial",
  clave: "TELEFONICA MOVILES ESPAÑA SAU - 0800143",
  compania: "movistar",
  codigo: "0800143",
  posicion: { longitud: 2.11, latitud: 41.39 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "Barcelona",
  bandas: [],
  url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0800143",
  fecha: ANTES,
  afirma: "presente",
  fichaLeidaEn: ANTES,
  ausencias: 0,
  retiradaEn: null,
};

describe("trasFicha", () => {
  it("las primeras medidas que lee se publican sin mover la fecha, porque el registro ya las tenía", () => {
    const { guardada, cambiada } = trasFicha(
      leidaSinMedidas,
      { bandas: [], medidasDeExposicion: MEDIDAS },
      HOY,
    );
    assert.isTrue(cambiada);
    assert.strictEqual(guardada.fecha, ANTES);
    assert.strictEqual(guardada.fichaLeidaEn, HOY);
    assert.deepStrictEqual(guardada.medidasDeExposicion, MEDIDAS);
  });

  it("una ficha sin medidas también se publica la primera vez, con la lista vacía", () => {
    const { guardada, cambiada } = trasFicha(
      leidaSinMedidas,
      { bandas: [], medidasDeExposicion: [] },
      HOY,
    );
    assert.isTrue(cambiada);
    assert.strictEqual(guardada.fecha, ANTES);
    assert.deepStrictEqual(guardada.medidasDeExposicion, []);
  });

  it("unas medidas distintas de las guardadas cambian la fecha", () => {
    const { guardada, cambiada } = trasFicha(
      { ...leidaSinMedidas, medidasDeExposicion: MEDIDAS },
      { bandas: [], medidasDeExposicion: MEDIDAS.slice(1) },
      HOY,
    );
    assert.isTrue(cambiada);
    assert.strictEqual(guardada.fecha, HOY);
    assert.deepStrictEqual(guardada.medidasDeExposicion, MEDIDAS.slice(1));
  });

  it("las mismas medidas no cambian nada más que la fecha de lectura", () => {
    const { guardada, cambiada } = trasFicha(
      { ...leidaSinMedidas, medidasDeExposicion: MEDIDAS },
      { bandas: [], medidasDeExposicion: MEDIDAS },
      HOY,
    );
    assert.isFalse(cambiada);
    assert.strictEqual(guardada.fecha, ANTES);
    assert.strictEqual(guardada.fichaLeidaEn, HOY);
  });
});

/** Las cuatro fichas que el registro dio con las filas en otro orden el 07/10/2026. */
const DEL_7_DE_OCTUBRE = [
  "detalle-orange-CATR0057A.iso-8859-1.html",
  "detalle-digi-0801321.iso-8859-1.html",
  "detalle-telefonica-0801321.iso-8859-1.html",
  "detalle-telefonica-0802878.iso-8859-1.html",
];

const leida = (html: string): FichaLeida => {
  const ficha = leerFicha(html);
  if (Result.isFailure(ficha)) return assert.fail(ficha.failure);
  return ficha.success;
};

describe("observacionDe", () => {
  it("una del registro con la ficha en la cola lleva las bandas sin leer (#41)", () => {
    assert.strictEqual(
      observacionDe({ ...leidaSinMedidas, fichaLeidaEn: null }).bandasSinLeer,
      true,
    );
  });

  it("leída, sin ficha en el registro o de la comunidad, no", () => {
    assert.notProperty(observacionDe(leidaSinMedidas), "bandasSinLeer");
    assert.notProperty(
      observacionDe({ ...leidaSinMedidas, fichaLeidaEn: null, sinFichaEnRegistro: ANTES }),
      "bandasSinLeer",
    );
    assert.notProperty(
      observacionDe({ ...leidaSinMedidas, fuente: "comunidad", fichaLeidaEn: null }),
      "bandasSinLeer",
    );
  });
});

/** Una ficha grabada en HTML, tal como llega, y con sus filas en otro orden. */
const grabada = (nombre: string) =>
  Effect.map(leerMuestra(nombre), (bytes) => {
    const html = decodificarLatin1(new Uint8Array(bytes));
    return { html, rotada: conFilasRotadas(html) };
  });

/**
 * La observación que guardaba una noche de antes de la versión 11 de la base: las bandas y las
 * medidas en el orden de la página, sin la huella de la ficha.
 */
const guardadaEnElOrdenDeLaPagina = (html: string): ObservacionGuardada => {
  const { cruda } = leida(html);
  if (cruda === undefined) return assert.fail("sin las filas de la ficha");
  return {
    ...leidaSinMedidas,
    bandas: Result.getOrThrow(bandasDeFilas(cruda.caracteristicas)),
    medidasDeExposicion: Result.getOrThrow(medidasDeFilas(cruda.niveles)),
  };
};

describe("trasFicha con las filas en otro orden (ADR 0027)", () => {
  it.effect(
    "las fichas del 07/10/2026 se leen igual y dan la misma huella con las filas en otro orden",
    () =>
      Effect.gen(function* () {
        for (const nombre of DEL_7_DE_OCTUBRE) {
          const { html, rotada } = yield* grabada(nombre);
          assert.notStrictEqual(rotada, html, nombre);
          const { cruda, ...enOrden } = leida(html);
          const { cruda: crudaRotada, ...rotadaEnOrden } = leida(rotada);
          assert.notDeepEqual(crudaRotada, cruda, nombre);
          assert.deepStrictEqual(rotadaEnOrden, enOrden, nombre);
          assert.strictEqual(
            huellaDeFicha(crudaRotada ?? assert.fail("")),
            huellaDeFicha(cruda ?? assert.fail("")),
            nombre,
          );
        }
      }).pipe(conMuestras),
  );

  it.effect("la primera vez que guarda lo crudo, unas filas en otro orden no cambian nada", () =>
    Effect.gen(function* () {
      for (const nombre of DEL_7_DE_OCTUBRE) {
        const { html, rotada } = yield* grabada(nombre);
        const { guardada, cambiada, hecho } = trasFicha(
          guardadaEnElOrdenDeLaPagina(html),
          leida(rotada),
          HOY,
        );
        // Guardar lo crudo por primera vez es un hecho, pero sin cambio.
        assert.deepStrictEqual(hecho?.tipo === "ficha" && hecho.cambia, false, nombre);
        assert.isFalse(cambiada, nombre);
        assert.strictEqual(guardada.fecha, ANTES, nombre);
        assert.strictEqual(guardada.fichaLeidaEn, HOY, nombre);
      }
    }).pipe(conMuestras),
  );

  it.effect("las noches siguientes, unas filas en otro orden no son ningún hecho", () =>
    Effect.gen(function* () {
      for (const nombre of DEL_7_DE_OCTUBRE) {
        const { html, rotada } = yield* grabada(nombre);
        const primera = trasFicha(guardadaEnElOrdenDeLaPagina(html), leida(html), ANTES + DIA);
        const segunda = trasFicha(primera.guardada, leida(rotada), HOY);
        assert.isUndefined(segunda.hecho, nombre);
        assert.isFalse(segunda.cambiada, nombre);
        assert.strictEqual(segunda.guardada.fecha, ANTES, nombre);
        assert.deepStrictEqual(segunda.guardada.bandas, primera.guardada.bandas, nombre);
        assert.deepStrictEqual(
          segunda.guardada.medidasDeExposicion,
          primera.guardada.medidasDeExposicion,
          nombre,
        );
      }
    }).pipe(conMuestras),
  );

  it.effect("un cambio de verdad con las filas en otro orden sigue cambiando la fecha", () =>
    Effect.gen(function* () {
      const { html, rotada } = yield* grabada("detalle-telefonica-0802878.iso-8859-1.html");
      const otraMedida = rotada.replace("0.12629", "0.5");
      const otraBanda = rotada.replace("3460.00 - 3600.00", "3420.00 - 3500.00");
      assert.notStrictEqual(otraMedida, rotada);
      assert.notStrictEqual(otraBanda, rotada);
      // La primera vez que guarda lo crudo y las noches siguientes.
      const primera = trasFicha(guardadaEnElOrdenDeLaPagina(html), leida(html), ANTES + DIA);
      for (const previa of [guardadaEnElOrdenDeLaPagina(html), primera.guardada]) {
        for (const otra of [otraMedida, otraBanda]) {
          const { guardada, cambiada, hecho } = trasFicha(previa, leida(otra), HOY);
          assert.deepStrictEqual(hecho?.tipo === "ficha" && hecho.cambia, true);
          assert.isTrue(cambiada);
          assert.strictEqual(guardada.fecha, HOY);
        }
      }
    }).pipe(conMuestras),
  );
});
