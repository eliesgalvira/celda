// Las pruebas son su propio punto de entrada y montan sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import { INTERRUPTOR_POR_DEFECTO, type Interruptores } from "@celda/ingesta/ejecucion";
import { zonaDeBarrido } from "@celda/dominio/barrido";
import { BaseDeBarrido, OPCIONES_BARRIDO, type OpcionesBarrido } from "@celda/ingesta/barrido";
import type { ExtractorPorCajas } from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS } from "@celda/ingesta/fichas";
import {
  type AlmacenDeCopias,
  AlmacenDeFicheros,
  type AlmacenDelArchivo,
} from "@celda/publicacion/almacen";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { NodeServices } from "@effect/platform-node";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ArchivoNocturno, archivoNocturno } from "../archivo.ts";
import { BaseNocturna, baseNocturna } from "../base.ts";
import type { AceptadasDelBuzon } from "../buzon.ts";
import { CALENDARIO } from "../calendario.ts";
import { COPIAS_CONSERVADAS, REINTENTO_DE_PUBLICACION } from "../configuracion.ts";
import { Extractores, noche, type OpcionesNoche, publicadorEn, sinAlmacen } from "../programa.ts";

/** Lotes pequeños, para que la muestra del Campus Nord ocupe varios. */
export const POR_LOTE = 8;

/** Una carpeta temporal con la base, el almacén y las copias de una prueba. */
export interface Entorno {
  readonly base: string;
  /** El archivo de páginas, al lado de la base. */
  readonly archivo: string;
  readonly almacen: string;
  readonly copias: string;
  /** Ficheros escritos en el almacén desde el principio de la prueba, en orden. */
  readonly escritos: Effect.Effect<ReadonlyArray<string>>;
  /** El almacén en la carpeta, apuntando cada fichero que escribe. */
  readonly almacenVigilado: Layer.Layer<AlmacenDeFicheros>;
}

/**
 * Un entorno nuevo en una carpeta temporal que se borra al acabar. La carpeta sale de `TMPDIR`,
 * como la de cualquier prueba.
 */
export const conEntorno = <A, E, R>(prueba: (entorno: Entorno) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const carpeta = yield* fs.makeTempDirectoryScoped({ prefix: "celda-nocturna-" });
    const almacen = path.join(carpeta, "almacen");
    const registro = yield* Ref.make<ReadonlyArray<string>>([]);
    const vigilado = Layer.effect(
      AlmacenDeFicheros,
      Effect.map(AlmacenDeFicheros, (real) =>
        AlmacenDeFicheros.of({
          ...real,
          guardar: (fichero, contenido) =>
            Effect.tap(real.guardar(fichero, contenido), (nuevo) =>
              nuevo ? Ref.update(registro, (r) => [...r, fichero]) : Effect.void,
            ),
          cambiarVigente: (contenido) =>
            Effect.tap(real.cambiarVigente(contenido), () =>
              Ref.update(registro, (r) => [...r, FICHERO_VIGENTE]),
            ),
        }),
      ),
    ).pipe(
      Layer.provide(almacenEnCarpeta({ carpeta: almacen, origen: "http://capas.prueba" })),
      Layer.provide(NodeServices.layer),
    );
    return yield* prueba({
      base: path.join(carpeta, "estado", "ingesta.sqlite"),
      archivo: path.join(carpeta, "estado", "archivo.sqlite"),
      almacen,
      copias: path.join(carpeta, "copias"),
      escritos: Ref.get(registro),
      almacenVigilado: vigilado,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** La zona de barrido de Cataluña, en la que cae la muestra del Campus Nord. */
export const CATALUNA = [zonaDeBarrido("cataluna")].flatMap((z) => z ?? []);

/**
 * La muestra del Campus Nord cae en Cataluña: las pruebas con ella solo barren esa zona, y las
 * fichas van con sus valores por defecto. Cada ejecución de estas pruebas es una ronda nueva,
 * como la del primer sábado de cada mes: barre Cataluña y lee todas las fichas. Las que prueban
 * la ronda, con la del domingo que la retoma, usan `EN_RONDAS`.
 */
export const CATALUNA_CADA_NOCHE: OpcionesBarrido = {
  zonas: CATALUNA,
  fichas: OPCIONES_FICHAS,
  reciente: Duration.zero,
};

/**
 * Como `CATALUNA_CADA_NOCHE`, con las rondas de producción (`RECIENTE`): una ejecución que llega
 * menos de un día y medio después de otra solo lee lo que esa dejó sin leer.
 */
export const EN_RONDAS: OpcionesBarrido = { ...OPCIONES_BARRIDO, zonas: CATALUNA };

/** Las opciones de la orden `noche` por defecto, con las carpetas del entorno. */
export const opcionesDe = (entorno: Entorno): OpcionesNoche => ({
  proceso: CATALUNA_CADA_NOCHE,
  reintento: REINTENTO_DE_PUBLICACION,
  copias: { carpeta: entorno.copias, conservar: COPIAS_CONSERVADAS },
  calendario: CALENDARIO,
});

/** Lo que cambia de una noche a otra en una prueba. */
export interface Variante {
  readonly almacen?: Layer.Layer<AlmacenDeFicheros>;
  /** Sin almacén, como el programa sin configurarle uno: la noche ingiere y no publica. */
  readonly sinPublicar?: boolean;
  /** Emplazamientos por lote de fichas; por defecto, `POR_LOTE`. */
  readonly porLote?: number;
  /** Las copias de la base en R2. Sin ellas, la copia se queda en el disco. */
  readonly copiasEnR2?: Layer.Layer<AlmacenDeCopias>;
  /** El archivo de páginas en otro fichero que el del entorno. */
  readonly archivo?: string;
  /** Los paquetes del archivo de páginas en R2. Sin ellos, se quedan en la carpeta de copias. */
  readonly archivoEnR2?: Layer.Layer<AlmacenDelArchivo>;
  readonly interruptores?: Interruptores;
  /** El buzón de Convex del que se lee lo aceptado. */
  readonly buzon?: Layer.Layer<AceptadasDelBuzon>;
  readonly proceso?: OpcionesBarrido;
  /** Cambia la base del barrido de la noche, para que falle donde quiera la prueba. */
  readonly envolverBase?: (base: BaseDeBarrido["Service"]) => BaseDeBarrido["Service"];
}

/**
 * Una noche como la lanza el programa, con el extractor que se le pase, la base y el archivo de
 * páginas del entorno, los límites de barrio reales y el almacén vigilado. La base y el archivo se
 * abren y se cierran con la noche.
 */
export const unaNoche = (
  entorno: Entorno,
  extractor: Layer.Layer<ExtractorPorCajas>,
  variante: Variante = {},
) =>
  Effect.gen(function* () {
    const zonas = yield* zonasDePublicacion;
    const entornoDeLaNoche = Layer.mergeAll(
      variante.sinPublicar === true
        ? sinAlmacen
        : publicadorEn(zonas, variante.porLote ?? POR_LOTE).pipe(
            Layer.provide(variante.almacen ?? entorno.almacenVigilado),
          ),
      Layer.succeed(
        Extractores,
        Extractores.of({
          registroOficial: extractor,
          comunidad: Option.fromUndefinedOr(variante.buzon),
        }),
      ),

      variante.copiasEnR2 ?? Layer.empty,
      variante.archivoEnR2 ?? Layer.empty,
      archivoNocturno(variante.archivo ?? entorno.archivo),
    ).pipe(
      Layer.provideMerge(
        baseNocturna({
          fichero: entorno.base,
          interruptores: variante.interruptores ?? INTERRUPTOR_POR_DEFECTO,
          archivo: variante.archivo ?? entorno.archivo,
        }),
      ),
    );
    const laNoche = noche({
      ...opcionesDe(entorno),
      proceso: variante.proceso ?? CATALUNA_CADA_NOCHE,
    });
    const { envolverBase } = variante;
    return yield* (
      envolverBase === undefined
        ? laNoche
        : Effect.flatMap(Effect.service(BaseDeBarrido), (base) =>
            laNoche.pipe(Effect.provideService(BaseDeBarrido, envolverBase(base))),
          )
    ).pipe(Effect.provide(entornoDeLaNoche));
  });

/**
 * Repite el historial de la base del entorno y lo compara con la tabla de observaciones, con las
 * fichas de sus hechos leídas del archivo de páginas del entorno (ADR 0027).
 */
export const comprobarHistorial = (entorno: Entorno, maximo = 5) =>
  Effect.gen(function* () {
    const base = yield* BaseNocturna;
    const archivo = yield* ArchivoNocturno;
    return yield* base.comprobarHistorial(maximo, (huellas) =>
      Effect.orDie(archivo.fichasDePaginas(huellas)),
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        archivoNocturno(entorno.archivo),
        baseNocturna({
          fichero: entorno.base,
          interruptores: INTERRUPTOR_POR_DEFECTO,
          archivo: entorno.archivo,
        }),
      ),
    ),
  );

/** Abre una base (la del entorno o una copia) y hace algo con ella. */
export const conBase = <A, E, R>(fichero: string, efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(baseNocturna({ fichero, interruptores: INTERRUPTOR_POR_DEFECTO })));

/**
 * Las observaciones y los emplazamientos tal como están en la base, leídos con el cliente SQLite
 * y sin pasar por el programa, para comparar dos bases.
 */
export const tablasDe = (fichero: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      observaciones: yield* sql`SELECT fuente, clave, ficha_leida_en, retirada_en, datos
        FROM observaciones ORDER BY fuente, clave`,
      emplazamientos: yield* sql`SELECT clave, version, datos FROM emplazamientos ORDER BY clave`,
    };
  }).pipe(Effect.provide(SqliteClient.layer({ filename: fichero })));

/** Todos los ficheros del almacén con su contenido, para comparar dos almacenes. */
export const contenidoDe = (carpeta: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(carpeta))) return new Map<string, string>();
    const entradas = (yield* fs.readDirectory(carpeta, { recursive: true }))
      .filter((entrada) => entrada.endsWith(".json"))
      .toSorted();
    const contenidos = yield* Effect.forEach(entradas, (entrada) =>
      fs.readFileString(path.join(carpeta, entrada)),
    );
    return new Map(entradas.map((entrada, i) => [entrada, contenidos[i] ?? ""]));
  });
