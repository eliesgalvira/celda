// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Registro } from "@celda/ingesta/extractor";
import { OPCIONES_PROCESO, type OpcionesProceso } from "@celda/ingesta/proceso";
import { OPCIONES_FICHAS } from "@celda/ingesta/fichas";
import {
  capaGrabada,
  capaGrabadaPorCajas,
  type FuenteGrabada,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import {
  CATALUNA_CADA_NOCHE,
  conEntorno,
  contenidoDe,
  type Entorno,
  POR_LOTE,
  unaNoche,
  type Variante,
} from "@celda/nocturna/pruebas/entorno";
import { decodificarVigente, FICHERO_VIGENTE } from "@celda/dominio/capa";
import { leerResumen } from "@celda/dominio/provincias";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { publicacionDirecta } from "../src/publicacion";
import { convexEnMemoria, ejecutar } from "./ayudas";
import * as TestConfect from "./TestConfect";

/**
 * La ingesta nocturna (#35) tiene que publicar lo mismo que Convex mientras las dos convivan
 * (ADR 0015). Cada noche, las dos leen las mismas respuestas grabadas a la misma hora, cada una
 * publica en su carpeta, y las carpetas tienen que ser iguales byte a byte: el manifiesto, las
 * capas de provincia y sus lotes de fichas (formato 5, ADR 0016). Del resumen nacional y de
 * `vigente.json` se comparan los datos; la cobertura no, porque cada una barre lo suyo.
 * Las dos usan las mismas reglas, la misma fusión y la misma publicación; lo que se compara es
 * todo lo que cada una guarda por su cuenta. Convex lee la caja de Barcelona entera y la nocturna
 * barre Cataluña por cuadros (#40): la muestra cae en un solo cuadro, así que las dos cuentan las
 * mismas ausencias.
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

/** Lo que contesta el registro oficial una noche. */
interface NocheGrabada {
  readonly registro: FuenteGrabada;
}

/** El resumen y `vigente.json`, que lleva su nombre: los ficheros que cambian con la cobertura. */
const esDeCobertura = (fichero: string): boolean =>
  fichero === FICHERO_VIGENTE || fichero.startsWith("resumen@");

/**
 * Lo que dicen `vigente.json` y su resumen sin lo que depende de la cobertura: las zonas, si cada
 * provincia está cubierta, su último barrido y el nombre del resumen, que lleva su huella.
 * Convex lee la caja de Barcelona y la nocturna barre Cataluña por cuadros, así que la cobertura
 * de cada una es distinta por diseño; los datos de la misma instantánea no.
 */
const sinCobertura = (almacen: ReadonlyMap<string, string>) => {
  const vigente = decodificarVigente(almacen.get(FICHERO_VIGENTE) ?? "");
  if (Result.isFailure(vigente)) return assert.fail("vigente.json no se entiende");
  const { resumen: fichero, ...resto } = vigente.success;
  const resumen = leerResumen(almacen.get(fichero ?? "") ?? "", resto.version);
  if (Result.isFailure(resumen)) return assert.fail(resumen.failure.message);
  return {
    vigente: resto,
    fuentes: resumen.success.fuentes,
    provincias: resumen.success.provincias.map(
      ({ cubierta: _cubierta, barrido: _barrido, ...datos }) => datos,
    ),
    // Cada una con sus fechas de barrido, pero las dos con la de esta noche.
    barridos: [...new Set(resumen.success.cobertura.map((zona) => zona.barrido))],
  };
};

/**
 * Hace las mismas noches en Convex en memoria y en la ingesta nocturna, y compara las dos
 * carpetas después de cada una.
 */
const compararNoches = (
  noches: ReadonlyArray<NocheGrabada>,
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

      for (const [i, { registro }] of noches.entries()) {
        yield* TestClock.setTime(NOCHE + i * DIA);
        const enConvex = yield* ejecutar(
          capaGrabada("registro-oficial", registro),
          proceso,
          publicacion,
        );
        // La nocturna barre Cataluña por cuadros; Campus Nord cae entero en el de Barcelona.
        const variante: Variante = {
          proceso: {
            zonas: CATALUNA_CADA_NOCHE.zonas,
            fichas: { ...OPCIONES_FICHAS, maximo: proceso.maxFichas, relectura: proceso.rotacion },
          },
        };
        const fuera = yield* unaNoche(
          nocturna,
          capaGrabadaPorCajas("registro-oficial", registro),
          variante,
        );
        assert.strictEqual(enConvex.estado, "completada");
        assert.deepStrictEqual(
          fuera.ejecuciones.map((e) => e.estado),
          ["completada"],
        );
        const deConvex = yield* contenidoDe(carpetaDeConvex);
        const deNocturna = yield* contenidoDe(nocturna.almacen);
        assert.isAbove(deConvex.size, 2, `noche ${i + 1}: Convex no ha publicado`);
        // Los datos, byte a byte: el manifiesto, las capas de provincia y los lotes.
        const datos = (almacen: ReadonlyMap<string, string>) =>
          [...almacen].filter(([fichero]) => !esDeCobertura(fichero));
        assert.deepStrictEqual(datos(deNocturna), datos(deConvex), `noche ${i + 1}`);
        // El resumen y vigente.json, salvo la cobertura: cada una la suya.
        assert.deepStrictEqual(
          sinCobertura(deNocturna),
          sinCobertura(deConvex),
          `noche ${i + 1}: resumen`,
        );
        // Las dos ponen en las fichas el municipio del IGN, con los mismos límites.
        const lotes = [...deConvex].filter(([fichero]) => fichero.startsWith("fichas/"));
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
      yield* compararNoches([grabada, despues, despues, grabada].map((registro) => ({ registro })));
    }),
  );

  it.effect("con las fichas repartidas en varias noches, en el mismo orden", () =>
    Effect.gen(function* () {
      const grabada = yield* muestraCampusNord.pipe(Effect.provide(NodeServices.layer));
      const despues = unDiaDespues(grabada);
      yield* compararNoches(
        [grabada, grabada, despues, despues, despues].map((registro) => ({ registro })),
        { ...OPCIONES_PROCESO, maxFichas: 12 },
      );
    }),
  );
});
