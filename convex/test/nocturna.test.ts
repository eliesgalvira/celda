// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Registro } from "@celda/ingesta/extractor";
import { OPCIONES_PROCESO, type OpcionesProceso } from "@celda/ingesta/proceso";
import { OPCIONES_ZONAS } from "@celda/ingesta/barrido";
import {
  capaGrabada,
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import {
  conEntorno,
  contenidoDe,
  type Entorno,
  POR_LOTE,
  unaNoche,
} from "@celda/nocturna/pruebas/entorno";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";

import { publicacionDirecta } from "../src/publicacion";
import { convexEnMemoria, ejecutar } from "./ayudas";
import * as TestConfect from "./TestConfect";

/**
 * La ingesta nocturna (#35) tiene que publicar lo mismo que Convex mientras las dos convivan
 * (ADR 0015). Cada noche, las dos leen las mismas respuestas grabadas a la misma hora, cada una
 * publica en su carpeta, y las carpetas tienen que ser iguales byte a byte: capas, lotes de
 * fichas y `vigente.json`. Las dos usan las mismas reglas, la misma fusión y la misma
 * publicación; lo que se compara es todo lo que cada una guarda por su cuenta. Convex lee la caja
 * de Barcelona entera y la nocturna barre Cataluña por cuadros (#40): la muestra cae en un solo
 * cuadro, así que las dos cuentan las mismas ausencias.
 */

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

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
const unDiaDespues = (grabada: FuenteGrabada): FuenteGrabada => ({
  listado: {
    ...grabada.listado,
    registros: [
      ...grabada.listado.registros
        .filter((r) => r.clave !== QUITADO)
        .map((r) =>
          r.clave === MOVIDO
            ? { ...r, posicion: { ...r.posicion, latitud: r.posicion.latitud + 0.0018 } }
            : r,
        ),
      NUEVO,
    ],
  },
  fichas: new Map([...grabada.fichas, [NUEVO.clave, []]]),
});

/**
 * Hace las mismas noches en Convex en memoria y en la ingesta nocturna, y compara las dos
 * carpetas después de cada una.
 */
const compararNoches = (
  noches: ReadonlyArray<FuenteGrabada>,
  proceso: OpcionesProceso = OPCIONES_PROCESO,
) =>
  conEntorno((nocturna: Entorno) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const carpetaDeConvex = path.join(yield* fs.makeTempDirectoryScoped(), "almacen");
      const publicacion = publicacionDirecta(yield* zonasDePublicacion, POR_LOTE).pipe(
        Layer.provide(
          Layer.merge(
            almacenEnCarpeta({ carpeta: carpetaDeConvex, origen: "http://capas.prueba" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
            yield* convexEnMemoria,
          ),
        ),
      );

      for (const [i, grabada] of noches.entries()) {
        yield* TestClock.setTime(NOCHE + i * DIA);
        const enConvex = yield* ejecutar(
          capaGrabada("registro-oficial", grabada),
          proceso,
          publicacion,
        );
        // La nocturna barre Cataluña por cuadros; Campus Nord cae entero en el de Barcelona.
        const fuera = yield* unaNoche(nocturna, capaGrabadaPorCajas("registro-oficial", grabada), {
          proceso: { ...proceso, zonas: OPCIONES_ZONAS },
        });
        assert.strictEqual(enConvex.estado, "completada");
        assert.deepStrictEqual(
          fuera.ejecuciones.map((e) => e.estado),
          ["completada"],
        );
        const deConvex = yield* contenidoDe(carpetaDeConvex);
        const deNocturna = yield* contenidoDe(nocturna.almacen);
        assert.isAbove(deConvex.size, 2, `noche ${i + 1}: Convex no ha publicado`);
        assert.deepStrictEqual([...deNocturna.keys()], [...deConvex.keys()], `noche ${i + 1}`);
        for (const [fichero, contenido] of deConvex) {
          assert.strictEqual(deNocturna.get(fichero), contenido, `noche ${i + 1}: ${fichero}`);
        }
        // Las dos ponen en las fichas el municipio del IGN, con los mismos límites.
        const lotes = [...deConvex].filter(([fichero]) => fichero.startsWith("fichas@"));
        assert.isNotEmpty(lotes);
        for (const [fichero, contenido] of lotes) {
          assert.include(contenido, '"fuenteDeLugares"', fichero);
          assert.include(contenido, '"municipio":{"codigo":"08019","nombre":"Barcelona"}', fichero);
        }
      }
    }),
  ).pipe(Effect.provide(TestConfect.layer));

describe("la ingesta nocturna publica lo mismo que Convex (mismas respuestas grabadas)", () => {
  it.effect("con cambios, una baja tras dos barridos y una alta", () =>
    Effect.gen(function* () {
      const grabada = yield* muestraCampusNord.pipe(Effect.provide(NodeServices.layer));
      const despues = unDiaDespues(grabada);
      yield* compararNoches([grabada, despues, despues, grabada]);
    }),
  );

  it.effect("con las fichas repartidas en varias noches, en el mismo orden", () =>
    Effect.gen(function* () {
      const grabada = yield* muestraCampusNord.pipe(Effect.provide(NodeServices.layer));
      const despues = unDiaDespues(grabada);
      yield* compararNoches([grabada, grabada, despues, despues, despues], {
        ...OPCIONES_PROCESO,
        maxFichas: 12,
      });
    }),
  );
});
