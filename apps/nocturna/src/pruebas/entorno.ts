// Las pruebas son su propio punto de entrada y montan sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import type { Fuente } from "@celda/dominio/observacion";
import { INTERRUPTOR_POR_DEFECTO, type Interruptor } from "@celda/ingesta/ejecucion";
import { zonaDeBarrido } from "@celda/dominio/barrido";
import type { OpcionesBarrido } from "@celda/ingesta/barrido";
import { OPCIONES_PUNTOS, type OpcionesPuntos } from "@celda/ingesta/barridoDePuntos";
import type { ExtractorDePuntos, ExtractorPorCajas } from "@celda/ingesta/extractor";
import { OPCIONES_FICHAS, Provincias } from "@celda/ingesta/fichas";
import { capaDePuntosGrabada } from "@celda/ingesta/pruebas/antenasmoviles";
import { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import type { CopiaDeReserva } from "@celda/publicacion/reserva";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { NodeServices } from "@effect/platform-node";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { baseNocturna } from "../base.ts";
import { COPIAS_CONSERVADAS, REINTENTO_DE_PUBLICACION } from "../configuracion.ts";
import { Extractores, noche, type OpcionesNoche, provinciasDe, publicadorEn } from "../programa.ts";

/** Lotes pequeños, para que la muestra del Campus Nord ocupe varios. */
export const POR_LOTE = 8;

/** Una carpeta temporal con la base, el almacén y las copias de una prueba. */
export interface Entorno {
  readonly base: string;
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
      almacen,
      copias: path.join(carpeta, "copias"),
      escritos: Ref.get(registro),
      almacenVigilado: vigilado,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/**
 * La muestra del Campus Nord cae en Cataluña: las pruebas con ella la barren cada noche, sin
 * turnos, y las fichas van con sus valores por defecto.
 */
export const CATALUNA_CADA_NOCHE: OpcionesBarrido = {
  zonas: {
    cadaNoche: [zonaDeBarrido("cataluna")].flatMap((z) => z ?? []),
    enTurno: [],
    porNoche: 1,
  },
  fichas: OPCIONES_FICHAS,
};

/** Las opciones de la noche por defecto, con las carpetas del entorno. */
export const opcionesDe = (entorno: Entorno): OpcionesNoche => ({
  proceso: CATALUNA_CADA_NOCHE,
  puntos: OPCIONES_PUNTOS,
  reintento: REINTENTO_DE_PUBLICACION,
  copias: { carpeta: entorno.copias, conservar: COPIAS_CONSERVADAS },
});

/** Lo que cambia de una noche a otra en una prueba. */
export interface Variante {
  readonly almacen?: Layer.Layer<AlmacenDeFicheros>;
  /** La copia de reserva de Vercel. Sin ella, la noche no la toca. */
  readonly reserva?: Layer.Layer<CopiaDeReserva>;
  readonly interruptores?: Readonly<Record<Fuente, Interruptor>>;
  readonly reintento?: Duration.Duration;
  readonly proceso?: OpcionesBarrido;
  /** antenasmoviles.es, que por defecto no tiene ningún punto. Empieza apagado. */
  readonly antenasMoviles?: Layer.Layer<ExtractorDePuntos>;
  readonly puntos?: OpcionesPuntos;
}

/** antenasmoviles.es sin ningún punto, para las noches que no lo usan. */
const SIN_PUNTOS = capaDePuntosGrabada({
  listado: { puntos: [], avisos: [] },
  detalles: new Map(),
});

/**
 * Una noche como la lanza el programa, con el extractor que se le pase, la base del entorno, los
 * límites de barrio reales y el almacén vigilado. La base se abre y se cierra con la noche.
 */
export const unaNoche = (
  entorno: Entorno,
  extractor: Layer.Layer<ExtractorPorCajas>,
  variante: Variante = {},
) =>
  Effect.gen(function* () {
    const zonas = yield* zonasDePublicacion;
    const entornoDeLaNoche = Layer.mergeAll(
      publicadorEn(zonas, POR_LOTE).pipe(
        Layer.provide(variante.almacen ?? entorno.almacenVigilado),
        Layer.provide(variante.reserva ?? Layer.empty),
      ),
      Layer.succeed(
        Extractores,
        Extractores.of({
          registroOficial: extractor,
          antenasMoviles: variante.antenasMoviles ?? SIN_PUNTOS,
        }),
      ),
      Layer.succeed(Provincias, provinciasDe(zonas.municipios)),
    ).pipe(
      Layer.provideMerge(
        baseNocturna({
          fichero: entorno.base,
          interruptores: variante.interruptores ?? INTERRUPTOR_POR_DEFECTO,
        }),
      ),
    );
    return yield* noche({
      ...opcionesDe(entorno),
      reintento: variante.reintento ?? REINTENTO_DE_PUBLICACION,
      proceso: variante.proceso ?? CATALUNA_CADA_NOCHE,
      puntos: variante.puntos ?? OPCIONES_PUNTOS,
    }).pipe(Effect.provide(entornoDeLaNoche));
  });

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
