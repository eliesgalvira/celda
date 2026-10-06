import { ArchivoDePaginas, type PaginaDelRegistro } from "@celda/ingesta/archivo";
import type { FichaLeida } from "@celda/ingesta/extractor";
import { lecturaDeFicha } from "@celda/ingesta/registro-oficial/normalizar";
import { decodificarLatin1 } from "@celda/ingesta/texto";
import { AlmacenDelArchivo } from "@celda/publicacion/almacen";
import { sha256DeBytes } from "@celda/publicacion/almacenes/firma";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeZlib from "node:zlib";

import { BaseNocturna } from "./base.ts";

/**
 * El archivo de páginas del registro oficial (ADR 0027): cada respuesta del listado y de las
 * fichas tal como llegó, en su propio fichero SQLite, aparte de la base. La base tiene catorce
 * copias enteras en el disco y otras catorce en R2; el archivo crece despacio y no se copia
 * entero nunca. Cada noche se saca de él un paquete con lo nuevo, que va a la carpeta de copias y
 * a R2, y con los paquetes se rehace el archivo entero. Nunca se publica.
 *
 * Tablas:
 *
 * - `contenidos`: los bytes de cada página distinta, comprimidos con gzip y nombrados por su
 *   SHA-256 (`huella`). Una página que no cambia no ocupa nada más.
 * - `paginas`: cada URL del registro que se ha leído, con su tipo (`listado` o `ficha`) y, de una
 *   ficha, la clave de su estación base.
 * - `lecturas`: cada vez que se leyó una página, con su contenido y lo que sacó la lectura de
 *   entonces. Como el registro no fecha nada, son la única forma de saber entre qué dos noches
 *   cambió una página.
 * - `paquetes`: los paquetes sacados, con hasta qué fila de cada tabla llega cada uno.
 *
 * Nada se actualiza ni se borra: cada tabla solo recibe filas nuevas, así que un paquete es lo
 * que hay después del último.
 */

/** Las tablas del archivo, en el archivo (`en` vacío) o en un paquete adjunto (`paquete.`). */
const tablas = (en: string): ReadonlyArray<string> => [
  `CREATE TABLE ${en}contenidos (
    id INTEGER PRIMARY KEY,
    huella TEXT NOT NULL UNIQUE,
    bytes INTEGER NOT NULL,
    gzip BLOB NOT NULL
  )`,
  `CREATE TABLE ${en}paginas (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    clave TEXT
  )`,
  `CREATE TABLE ${en}lecturas (
    id INTEGER PRIMARY KEY,
    pagina INTEGER NOT NULL,
    contenido INTEGER NOT NULL,
    leida_en INTEGER NOT NULL,
    resultado TEXT NOT NULL
  )`,
  `CREATE TABLE ${en}paquetes (
    nombre TEXT PRIMARY KEY,
    contenidos_hasta INTEGER NOT NULL,
    paginas_hasta INTEGER NOT NULL,
    lecturas_hasta INTEGER NOT NULL,
    hecho_en INTEGER NOT NULL
  )`,
];

/**
 * El esquema del archivo, por versiones (`PRAGMA user_version`), como el de la base. Un paquete
 * lleva la versión del archivo del que sale, y solo se restaura en un archivo de la misma.
 */
export const ESQUEMA_DEL_ARCHIVO: ReadonlyArray<ReadonlyArray<string>> = [
  [...tablas(""), `CREATE INDEX lecturas_por_pagina ON lecturas (pagina, id)`],
];

/** Las columnas de cada tabla, en orden, para copiarlas entre el archivo y un paquete. */
const COLUMNAS = {
  contenidos: "id, huella, bytes, gzip",
  paginas: "id, tipo, url, clave",
  lecturas: "id, pagina, contenido, leida_en, resultado",
  paquetes: "nombre, contenidos_hasta, paginas_hasta, lecturas_hasta, hecho_en",
} as const;

/** El nombre de un paquete: `archivo-<fecha>.sqlite`, que en orden alfabético va por fechas. */
const PAQUETE = /^archivo-.+\.sqlite$/u;

/** Fichas que se leen del archivo de una vez al releerlas. */
const PAGINA = 500;

/** Lo que tiene el archivo, para el diario y las pruebas. */
export interface ResumenDelArchivo {
  readonly paginas: number;
  readonly lecturas: number;
  readonly contenidos: number;
  /** Bytes de los contenidos sin comprimir. */
  readonly bytes: number;
  /** Bytes de los contenidos comprimidos, lo que ocupan de verdad. */
  readonly comprimidos: number;
}

/** Un paquete recién sacado: su ruta y las filas nuevas que lleva. */
export interface Paquete {
  readonly ruta: string;
  readonly contenidos: number;
  readonly paginas: number;
  readonly lecturas: number;
}

/** La última lectura de una ficha guardada en el archivo, ya descomprimida. */
export interface FichaArchivada {
  readonly clave: string;
  readonly url: string;
  readonly leidaEn: number;
  /** Lo que sacó la lectura de entonces. */
  readonly resultado: string;
  /** La página en HTML, decodificada de ISO-8859-1 como en el extractor. */
  readonly html: string;
}

/** El archivo no se ha podido abrir o no responde. */
export class ArchivoNoDisponible extends Schema.TaggedError<ArchivoNoDisponible>()(
  "ArchivoNoDisponible",
  { motivo: Schema.String },
) {}

/** Un paquete que no es de la versión del archivo, o que no es un paquete. */
export class PaqueteIncompatible extends Schema.TaggedError<PaqueteIncompatible>()(
  "PaqueteIncompatible",
  { paquete: Schema.String, motivo: Schema.String },
) {}

/**
 * El archivo de la ingesta nocturna, además de archivar: sacar paquetes, rehacerlo desde ellos y
 * recorrer las fichas archivadas.
 */
export class ArchivoNocturno extends Context.Service<
  ArchivoNocturno,
  {
    readonly fichero: string;
    readonly resumen: Effect.Effect<ResumenDelArchivo, ArchivoNoDisponible>;
    /**
     * Saca a `carpeta` un paquete con lo que el archivo tiene después del último paquete, o
     * `undefined` si no hay nada nuevo.
     */
    readonly empaquetar: (
      carpeta: string,
    ) => Effect.Effect<Paquete | undefined, ArchivoNoDisponible>;
    /** Añade al archivo lo que tiene un paquete y aún no tenía. */
    readonly restaurar: (
      paquete: string,
    ) => Effect.Effect<void, ArchivoNoDisponible | PaqueteIncompatible>;
    /**
     * Recorre la última lectura de cada ficha archivada, de `PAGINA` en `PAGINA`, sin tener más
     * de una página de fichas en memoria.
     */
    readonly recorrerFichas: <E, R>(
      cada: (ficha: FichaArchivada) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<void, ArchivoNoDisponible | E, R>;
  }
>()("@celda/nocturna/archivo/ArchivoNocturno") {}

const Cuentas = Schema.Struct({
  contenidos: Schema.NullOr(Schema.Int),
  paginas: Schema.NullOr(Schema.Int),
  lecturas: Schema.NullOr(Schema.Int),
});
const FilaResumen = Schema.Struct({
  paginas: Schema.Int,
  lecturas: Schema.Int,
  contenidos: Schema.Int,
  bytes: Schema.NullOr(Schema.Int),
  comprimidos: Schema.NullOr(Schema.Int),
});
const FilaFicha = Schema.Struct({
  id: Schema.Int,
  clave: Schema.NullOr(Schema.String),
  url: Schema.String,
  leida_en: Schema.Finite,
  resultado: Schema.String,
  gzip: Schema.Uint8Array,
});
const decodificar = <S extends Schema.Top>(esquema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(esquema));

/** El mensaje de lo que ha hecho fallar algo, en una línea para el diario. */
const mensajeDe = (causa: Cause.Cause<unknown>): string => {
  const error = Cause.squash(causa);
  return error instanceof Error ? error.message : String(error);
};

/** Un fallo de SQLite, del esquema o del disco, como archivo no disponible. */
const noDisponible = (error: { readonly message: string }) =>
  new ArchivoNoDisponible({ motivo: error.message });

/**
 * Suelta el paquete adjunto a la conexión. Si no puede, lo dice el diario, y el paquete siguiente
 * de la misma orden falla al adjuntarse; la conexión se cierra al acabar la orden.
 */
const soltarPaquete = (sql: SqlClient.SqlClient) =>
  sql
    .unsafe("DETACH DATABASE paquete")
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning(`No se ha podido soltar el paquete del archivo: ${error.message}`),
      ),
    );

/**
 * Abre el archivo y lo pone al día. La conexión es suya, aparte de la de la base: se cierra con la
 * capa.
 */
const abrir = Effect.fn("Archivo.abrir")(function* (fichero: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(fichero), { recursive: true });
  const contexto = yield* Layer.build(SqliteClient.layer({ filename: fichero }));
  const sql = Context.get(contexto, SqlClient.SqlClient);
  const [antes] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
  if ((antes?.user_version ?? 0) < ESQUEMA_DEL_ARCHIVO.length) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const [fila] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
        const actual = fila?.user_version ?? 0;
        for (const [indice, sentencias] of ESQUEMA_DEL_ARCHIVO.entries()) {
          if (indice < actual) continue;
          for (const sentencia of sentencias) yield* sql.unsafe(sentencia);
          yield* sql.unsafe(`PRAGMA user_version = ${indice + 1}`);
        }
      }),
    );
  }
  return sql;
});

/** El archivo sobre una conexión abierta. */
const archivoSobre = (fichero: string, sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const archivar = (pagina: PaginaDelRegistro) =>
      Effect.gen(function* () {
        const leidaEn = yield* Clock.currentTimeMillis;
        const huella = yield* sha256DeBytes(new Uint8Array(pagina.cuerpo));
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const [suyo] = yield* sql<{ readonly id: number }>`SELECT id FROM contenidos
              WHERE huella = ${huella}`;
            const contenido =
              suyo ??
              (yield* sql<{ readonly id: number }>`INSERT INTO contenidos ${sql.insert({
                huella,
                bytes: pagina.cuerpo.byteLength,
                gzip: NodeZlib.gzipSync(pagina.cuerpo),
              })} RETURNING id`)[0];
            const [suya] = yield* sql<{ readonly id: number }>`SELECT id FROM paginas
              WHERE url = ${pagina.url}`;
            const leida =
              suya ??
              (yield* sql<{ readonly id: number }>`INSERT INTO paginas ${sql.insert({
                tipo: pagina.tipo,
                url: pagina.url,
                clave: pagina.clave ?? null,
              })} RETURNING id`)[0];
            yield* sql`INSERT INTO lecturas ${sql.insert({
              pagina: leida?.id ?? 0,
              contenido: contenido?.id ?? 0,
              leida_en: leidaEn,
              resultado: pagina.resultado,
            })}`;
          }),
        );
      }).pipe(
        // El archivo no para nunca la ingesta: lo que no se archiva queda en el diario.
        Effect.catchCause((causa) =>
          Effect.logWarning(`No se ha podido archivar ${pagina.url}: ${mensajeDe(causa)}`),
        ),
        Effect.withSpan("Archivo.archivar"),
      );

    const resumen = Effect.gen(function* () {
      const [fila] = yield* decodificar(FilaResumen)(
        yield* sql`SELECT
            (SELECT count(*) FROM paginas) AS paginas,
            (SELECT count(*) FROM lecturas) AS lecturas,
            (SELECT count(*) FROM contenidos) AS contenidos,
            (SELECT sum(bytes) FROM contenidos) AS bytes,
            (SELECT sum(length(gzip)) FROM contenidos) AS comprimidos`,
      );
      const hecho: ResumenDelArchivo = {
        paginas: fila?.paginas ?? 0,
        lecturas: fila?.lecturas ?? 0,
        contenidos: fila?.contenidos ?? 0,
        bytes: fila?.bytes ?? 0,
        comprimidos: fila?.comprimidos ?? 0,
      };
      return hecho;
    }).pipe(Effect.mapError(noDisponible), Effect.withSpan("Archivo.resumen"));

    /**
     * Copia lo nuevo a un fichero aparte, adjunto a la conexión. Primero se escribe con otro nombre
     * y se renombra al acabar, así que un paquete con su nombre está siempre entero. El archivo
     * apunta el paquete solo después: si la noche se corta entre medias, el paquete siguiente
     * repite esas filas, y al restaurar se ignoran las que ya están.
     */
    const empaquetar = Effect.fn("Archivo.empaquetar")(function* (carpeta: string) {
      const ahora = yield* Clock.currentTimeMillis;
      const [desde] = yield* decodificar(Cuentas)(
        yield* sql`SELECT max(contenidos_hasta) AS contenidos, max(paginas_hasta) AS paginas,
            max(lecturas_hasta) AS lecturas FROM paquetes`,
      );
      const [hasta] = yield* decodificar(Cuentas)(
        yield* sql`SELECT (SELECT max(id) FROM contenidos) AS contenidos,
            (SELECT max(id) FROM paginas) AS paginas, (SELECT max(id) FROM lecturas) AS lecturas`,
      );
      const limites = {
        contenidos: [desde?.contenidos ?? 0, hasta?.contenidos ?? 0],
        paginas: [desde?.paginas ?? 0, hasta?.paginas ?? 0],
        lecturas: [desde?.lecturas ?? 0, hasta?.lecturas ?? 0],
      } as const;
      if (Object.values(limites).every(([de, a]) => a <= de)) return undefined;

      yield* fs.makeDirectory(carpeta, { recursive: true });
      for (const resto of yield* fs.readDirectory(carpeta)) {
        if (resto.endsWith(".parcial")) yield* fs.remove(path.join(carpeta, resto));
      }
      const nombre = `archivo-${DateTime.formatIso(DateTime.makeUnsafe(ahora)).replaceAll(":", "-")}.sqlite`;
      const ruta = path.join(carpeta, nombre);
      const parcial = `${ruta}.parcial`;
      yield* sql.unsafe("ATTACH DATABASE ? AS paquete", [parcial]);
      yield* Effect.ensuring(
        sql.withTransaction(
          Effect.gen(function* () {
            for (const sentencia of tablas("paquete.")) yield* sql.unsafe(sentencia);
            yield* sql.unsafe(`PRAGMA paquete.user_version = ${ESQUEMA_DEL_ARCHIVO.length}`);
            for (const tabla of ["contenidos", "paginas", "lecturas"] as const) {
              const [de, a] = limites[tabla];
              yield* sql.unsafe(
                `INSERT INTO paquete.${tabla} (${COLUMNAS[tabla]})
                  SELECT ${COLUMNAS[tabla]} FROM ${tabla} WHERE id > ? AND id <= ?`,
                [de, a],
              );
            }
            yield* sql.unsafe(
              `INSERT INTO paquete.paquetes (${COLUMNAS.paquetes}) VALUES (?, ?, ?, ?, ?)`,
              [nombre, limites.contenidos[1], limites.paginas[1], limites.lecturas[1], ahora],
            );
          }),
        ),
        soltarPaquete(sql),
      );
      yield* fs.rename(parcial, ruta);
      yield* sql`INSERT INTO paquetes ${sql.insert({
        nombre,
        contenidos_hasta: limites.contenidos[1],
        paginas_hasta: limites.paginas[1],
        lecturas_hasta: limites.lecturas[1],
        hecho_en: ahora,
      })}`;
      const hecho: Paquete = {
        ruta,
        contenidos: limites.contenidos[1] - limites.contenidos[0],
        paginas: limites.paginas[1] - limites.paginas[0],
        lecturas: limites.lecturas[1] - limites.lecturas[0],
      };
      return hecho;
    }, Effect.mapError(noDisponible));

    const restaurar = Effect.fn("Archivo.restaurar")(function* (paquete: string) {
      yield* sql
        .unsafe("ATTACH DATABASE ? AS paquete", [paquete])
        .pipe(Effect.mapError(noDisponible));
      yield* Effect.ensuring(
        Effect.gen(function* () {
          const [version] = yield* sql<{
            readonly user_version: number;
          }>`PRAGMA paquete.user_version`.pipe(Effect.mapError(noDisponible));
          if (version?.user_version !== ESQUEMA_DEL_ARCHIVO.length) {
            return yield* new PaqueteIncompatible({
              paquete,
              motivo: `es de la versión ${version?.user_version ?? 0} del archivo, y este es de la ${ESQUEMA_DEL_ARCHIVO.length}`,
            });
          }
          yield* sql
            .withTransaction(
              Effect.forEach(
                ["contenidos", "paginas", "lecturas", "paquetes"] as const,
                (tabla) =>
                  sql.unsafe(
                    `INSERT OR IGNORE INTO ${tabla} (${COLUMNAS[tabla]})
                      SELECT ${COLUMNAS[tabla]} FROM paquete.${tabla}`,
                  ),
                { discard: true },
              ),
            )
            .pipe(Effect.mapError(noDisponible));
        }),
        soltarPaquete(sql),
      );
    });

    const recorrerFichas = <E, R>(cada: (ficha: FichaArchivada) => Effect.Effect<void, E, R>) =>
      Effect.gen(function* () {
        for (let desde = 0; ;) {
          const filas = yield* sql`SELECT p.id, p.clave, p.url, l.leida_en, l.resultado, c.gzip
              FROM paginas p
              JOIN lecturas l ON l.id = (SELECT max(id) FROM lecturas WHERE pagina = p.id)
              JOIN contenidos c ON c.id = l.contenido
              WHERE p.tipo = 'ficha' AND p.id > ${desde}
              ORDER BY p.id LIMIT ${PAGINA}`.pipe(
            Effect.flatMap(decodificar(FilaFicha)),
            Effect.mapError(noDisponible),
          );
          for (const fila of filas) {
            if (fila.clave === null) continue;
            const html = yield* Effect.try({
              try: () => decodificarLatin1(new Uint8Array(NodeZlib.gunzipSync(fila.gzip))),
              catch: () =>
                new ArchivoNoDisponible({
                  motivo: `no se puede descomprimir la lectura de ${fila.url}`,
                }),
            });
            yield* cada({
              clave: fila.clave,
              url: fila.url,
              leidaEn: fila.leida_en,
              resultado: fila.resultado,
              html,
            });
          }
          const ultima = filas.at(-1);
          if (ultima === undefined) return;
          desde = ultima.id;
        }
      }).pipe(Effect.withSpan("Archivo.recorrerFichas"));

    return {
      paginas: ArchivoDePaginas.of({ archivar }),
      nocturno: ArchivoNocturno.of({ fichero, resumen, empaquetar, restaurar, recorrerFichas }),
    };
  });

/**
 * Un archivo que no se ha podido abrir: no archiva nada, y lo demás falla con el motivo. La
 * ingesta sigue sin él.
 */
const sinArchivo = (fichero: string, motivo: string) => {
  const fallo = Effect.fail(new ArchivoNoDisponible({ motivo }));
  return {
    paginas: ArchivoDePaginas.of({ archivar: () => Effect.void }),
    nocturno: ArchivoNocturno.of({
      fichero,
      resumen: fallo,
      empaquetar: () => fallo,
      restaurar: () => fallo,
      recorrerFichas: () => fallo,
    }),
  };
};

/**
 * El archivo de páginas en `fichero`, para la noche (`ArchivoDePaginas`) y para las copias y las
 * relecturas (`ArchivoNocturno`). Si no se puede abrir, lo dice el diario y la noche sigue sin
 * archivar: perder las páginas de una noche es mejor que perder la noche entera.
 */
export const archivoNocturno = (fichero: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const abierto = yield* Effect.exit(
        Effect.flatMap(abrir(fichero), (sql) => archivoSobre(fichero, sql)),
      );
      const { paginas, nocturno } = Exit.isSuccess(abierto)
        ? abierto.value
        : yield* Effect.as(
            Effect.logError(
              `No se ha podido abrir el archivo de páginas ${fichero}: ${mensajeDe(abierto.cause)}. ` +
                "La noche sigue sin archivar",
            ),
            sinArchivo(fichero, `no se ha podido abrir ${fichero}`),
          );
      return Context.make(ArchivoDePaginas, paginas).pipe(Context.add(ArchivoNocturno, nocturno));
    }),
  );

/** Lo que ha pasado con los paquetes del archivo en R2. Nunca es un fallo de la noche. */
export type ArchivoEnR2 =
  /** No hay cubo de R2 configurado. */
  | { readonly tipo: "sin-subir" }
  | { readonly tipo: "subido"; readonly paquetes: ReadonlyArray<string> }
  | { readonly tipo: "fallido"; readonly motivo: string };

/** Lo que ha hecho la copia del archivo de una noche. */
export interface CopiaDelArchivo {
  /** El paquete nuevo de la noche, o `undefined` si no había nada nuevo o no se pudo sacar. */
  readonly paquete: Paquete | undefined;
  readonly enR2: ArchivoEnR2;
}

/**
 * Sube a R2 los paquetes de `carpeta` que aún no están allí, del más viejo al más nuevo. Así una
 * subida que falla se repite sola la noche siguiente, con el paquete de esa noche.
 */
const subirPaquetes = Effect.fn("Archivo.subirPaquetes")(function* (carpeta: string) {
  const almacen = yield* Effect.serviceOption(AlmacenDelArchivo);
  if (Option.isNone(almacen)) {
    const sinSubir: ArchivoEnR2 = { tipo: "sin-subir" };
    return sinSubir;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* Effect.gen(function* () {
    const locales = (yield* fs.exists(carpeta))
      ? (yield* fs.readDirectory(carpeta)).filter((nombre) => PAQUETE.test(nombre)).toSorted()
      : [];
    const subidos = new Set(yield* almacen.value.listar);
    const faltan = locales.filter((nombre) => !subidos.has(nombre));
    for (const nombre of faltan) {
      const contenido = new Uint8Array(yield* fs.readFile(path.join(carpeta, nombre)));
      yield* almacen.value.guardar(nombre, contenido);
    }
    const subido: ArchivoEnR2 = { tipo: "subido", paquetes: faltan };
    return subido;
  }).pipe(
    Effect.catch((fallo) =>
      Effect.succeed<ArchivoEnR2>({
        tipo: "fallido",
        motivo: "motivo" in fallo ? fallo.motivo : fallo.message,
      }),
    ),
  );
});

/**
 * La copia del archivo al acabar la noche (ADR 0027): saca a `carpeta` un paquete con lo nuevo y
 * sube a R2 los paquetes que aún no están allí. Sin el archivo en el contexto no hace nada. Si algo
 * falla, lo dice el diario y la noche sigue: lo que no se ha copiado va en el paquete siguiente.
 */
export const copiarArchivo = Effect.fn("Archivo.copiar")(function* (carpeta: string) {
  const archivo = yield* Effect.serviceOption(ArchivoNocturno);
  if (Option.isNone(archivo)) return undefined;
  const paquete = yield* archivo.value.empaquetar(carpeta).pipe(
    Effect.tap((hecho) =>
      hecho === undefined
        ? Effect.logInfo("Archivo de páginas: nada nuevo que empaquetar")
        : Effect.logInfo(
            `Archivo de páginas: paquete ${hecho.ruta} con ${hecho.lecturas} lecturas, ` +
              `${hecho.paginas} páginas nuevas y ${hecho.contenidos} contenidos nuevos`,
          ),
    ),
    Effect.catch((fallo) =>
      Effect.as(
        Effect.logWarning(`No se ha podido empaquetar el archivo de páginas: ${fallo.motivo}`),
        undefined,
      ),
    ),
  );
  const enR2 = yield* subirPaquetes(carpeta);
  if (enR2.tipo === "subido" && enR2.paquetes.length > 0) {
    yield* Effect.logInfo(`Archivo de páginas en R2: ${enR2.paquetes.join(", ")}`);
  } else if (enR2.tipo === "fallido") {
    yield* Effect.logWarning(
      `No se han podido subir los paquetes del archivo a R2: ${enR2.motivo}. ` +
        "Se suben la noche siguiente",
    );
  }
  const hecha: CopiaDelArchivo = { paquete, enR2 };
  return hecha;
});

/**
 * Rehace el archivo con los paquetes de `carpeta`, en el orden de sus nombres. Un paquete que ya
 * estaba, entero o en parte, no duplica nada. Devuelve los paquetes leídos.
 */
export const restaurarArchivo = Effect.fn("Archivo.restaurarDesde")(function* (carpeta: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const archivo = yield* ArchivoNocturno;
  const paquetes = (yield* fs.readDirectory(carpeta)).filter((n) => PAQUETE.test(n)).toSorted();
  for (const paquete of paquetes) {
    yield* archivo.restaurar(path.join(carpeta, paquete));
  }
  return paquetes;
});

/** Lo que ha dado releer las fichas del archivo. */
export interface Relectura {
  /** Fichas archivadas, una por estación base: la última lectura de cada una. */
  readonly fichas: number;
  readonly leidas: number;
  readonly sinFicha: number;
  readonly ajenas: number;
  /** Las que la lectura de hoy no entiende, con el motivo, en el orden del archivo. */
  readonly ilegibles: ReadonlyArray<{ readonly clave: string; readonly motivo: string }>;
  /** Las que la lectura de hoy entiende y la de entonces no. */
  readonly arregladas: number;
  /** Con `aplicar`, lo que ha pasado con cada leída en la base. */
  readonly aplicadas: Readonly<Record<ResultadoDeReleida, number>>;
}

/** Qué pasa en la base con la ficha que se relee del archivo (`BaseNocturna.aplicarFichaReleida`). */
export type ResultadoDeReleida = "aplicada" | "al-dia" | "posterior" | "sin-observacion";

/**
 * Relee con la lectura de hoy la última lectura archivada de cada ficha, sin pedir nada al
 * registro (ADR 0027). Sirve para comprobar un arreglo de `leerFicha` con todas las fichas que se
 * tienen y, con `aplicar`, para llevarlo a la base sin volver a pedirlas: cada ficha que se lee se
 * guarda como si se acabara de leer en la fecha de su lectura archivada, salvo si la observación
 * ha cambiado después o ya estaba leída con la versión de hoy
 * (`BaseNocturna.aplicarFichaReleida`). La fusión y la publicación de lo aplicado las hace la
 * noche siguiente.
 */
export const releerArchivo = Effect.fn("Archivo.releer")(function* (aplicar: boolean) {
  const archivo = yield* ArchivoNocturno;
  const base = aplicar ? Option.some(yield* BaseNocturna) : Option.none();
  const cuenta = { fichas: 0, leidas: 0, sinFicha: 0, ajenas: 0, arregladas: 0 };
  const ilegibles: Array<{ readonly clave: string; readonly motivo: string }> = [];
  const aplicadas: Record<ResultadoDeReleida, number> = {
    aplicada: 0,
    "al-dia": 0,
    posterior: 0,
    "sin-observacion": 0,
  };
  const aplicarLeida = (clave: string, ficha: FichaLeida, leidaEn: number) =>
    Option.match(base, {
      onNone: () => Effect.void,
      onSome: (abierta) =>
        Effect.map(abierta.aplicarFichaReleida(clave, ficha, leidaEn), (resultado) => {
          aplicadas[resultado]++;
        }),
    });
  yield* archivo.recorrerFichas((archivada) => {
    cuenta.fichas++;
    const lectura = lecturaDeFicha(archivada.html);
    switch (lectura.resultado) {
      case "sin-ficha":
        cuenta.sinFicha++;
        return Effect.void;
      case "ajena":
        cuenta.ajenas++;
        return Effect.void;
      case "ilegible":
        ilegibles.push({ clave: archivada.clave, motivo: lectura.motivo });
        return Effect.void;
      case "leida":
        cuenta.leidas++;
        if (archivada.resultado !== "leida") cuenta.arregladas++;
        return aplicarLeida(archivada.clave, lectura.ficha, archivada.leidaEn);
    }
  });
  const hecha: Relectura = { ...cuenta, ilegibles, aplicadas };
  return hecha;
});

/** El resultado de `releerArchivo` para la terminal. */
export const describirRelectura = (r: Relectura, aplicar: boolean): string =>
  [
    `Fichas archivadas: ${r.fichas}`,
    `- leídas con la lectura de hoy: ${r.leidas}, de ellas ${r.arregladas} que la de entonces no leía`,
    `- sin ficha en el registro: ${r.sinFicha}`,
    `- páginas que no son del geoportal: ${r.ajenas}`,
    `- ilegibles: ${r.ilegibles.length}`,
    ...r.ilegibles.slice(0, 20).map((i) => `  - ${i.clave}: ${i.motivo}`),
    ...(r.ilegibles.length > 20 ? [`  - y ${r.ilegibles.length - 20} más`] : []),
    aplicar
      ? `En la base: ${r.aplicadas.aplicada} aplicadas, ${r.aplicadas["al-dia"]} ya al día, ` +
        `${r.aplicadas.posterior} con la observación cambiada después, ` +
        `${r.aplicadas["sin-observacion"]} sin observación vigente. ` +
        "La noche siguiente las fusiona y las publica"
      : "Sin --aplicar no se cambia nada en la base",
  ].join("\n");
