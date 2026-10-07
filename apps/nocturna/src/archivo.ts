import { ArchivoDePaginas, type PaginaDelRegistro } from "@celda/ingesta/archivo";
import type { FichaLeida } from "@celda/ingesta/extractor";
import type { FichasDeLasPaginas } from "@celda/ingesta/hechos";
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
 * entero nunca. Cada noche se saca de él lo nuevo en paquetes de `TAMANO_DE_PAQUETE` como mucho,
 * que van a la carpeta de copias y a R2, y con los paquetes se rehace el archivo entero. Nunca se
 * publica.
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

/**
 * El nombre de un paquete: `archivo-<fecha>-<número>.sqlite`, que en orden alfabético va por
 * fechas, o `archivo-<fecha>.sqlite`, el de un paquete de antes de partirlos (ADR 0027).
 */
const PAQUETE = /^archivo-.+\.sqlite$/u;

/**
 * Lo más que ocupa un paquete, 8 MiB. Cada uno se sube a R2 en una sola petición, con el cuerpo
 * entero en memoria, y `fetch` la da por perdida si no acaba en 300 s (`PLAZOS_DE_R2`). Con 8 MiB
 * basta algo más de 0,2 Mbit/s de subida, y la subida no pasa de unos 50 MB de memoria. La noche
 * de la relectura de España, unos 120 MB, son unos quince paquetes.
 */
export const TAMANO_DE_PAQUETE = 8 * 1024 * 1024;

/**
 * La carpeta, dentro de la de los paquetes, donde queda entero un paquete de antes que se ha
 * partido para subirlo. No se sube ni se restaura con los demás, y no se borra.
 */
export const ENTEROS = "enteros";

/** Las tablas que se reparten entre los paquetes, en el orden en que se llenan. */
const TABLAS = ["contenidos", "paginas", "lecturas"] as const;
type Tabla = (typeof TABLAS)[number];

/** Un `id` de cada tabla. */
export type Cotas = Readonly<Record<Tabla, number>>;

/** Las filas de cada tabla que lleva un paquete: las de `id` mayor que `de` y hasta `a`. */
export interface Tramos {
  readonly de: Cotas;
  readonly a: Cotas;
}

/** Una fila nueva, por su `id`, y lo que ocupa en un paquete. */
export type FilaQueOcupa = readonly [id: number, bytes: number];

/**
 * Reparte las filas nuevas, de `desde` (sin incluir) a `hasta`, en paquetes de `presupuesto` bytes
 * como mucho. Llena los paquetes en orden, primero con los contenidos, luego con las páginas y al
 * final con las lecturas, así que cada `a` es a la vez lo que lleva ese paquete y lo que llevan
 * todos hasta él. Si la noche se corta entre dos, el siguiente empieza donde acabó el último. Un
 * paquete lleva al menos una fila, aunque esa sola pase del presupuesto. El último llega hasta
 * `hasta`.
 */
export const partir = (
  filas: Readonly<Record<Tabla, ReadonlyArray<FilaQueOcupa>>>,
  desde: Cotas,
  hasta: Cotas,
  presupuesto: number,
): ReadonlyArray<Tramos> => {
  const tramos: Array<Tramos> = [];
  let de = desde;
  const hastaAqui: Record<Tabla, number> = { ...desde };
  let ocupado = 0;
  for (const tabla of TABLAS) {
    for (const [id, bytes] of filas[tabla]) {
      if (ocupado > 0 && ocupado + bytes > presupuesto) {
        const a: Cotas = { ...hastaAqui };
        tramos.push({ de, a });
        de = a;
        ocupado = 0;
      }
      hastaAqui[tabla] = id;
      ocupado += bytes;
    }
  }
  tramos.push({ de, a: hasta });
  return tramos;
};

/** Las páginas de SQLite, de 4 KiB por defecto, y lo que cabe de una fila en su hoja. */
const PAGINA_SQLITE = 4096;
const LOCAL_MAXIMO = PAGINA_SQLITE - 35;
const LOCAL_MINIMO = Math.floor(((PAGINA_SQLITE - 12) * 32) / 255) - 23;

/**
 * Lo que ocupa en el fichero una fila de una tabla con un registro de `bytes`, como lo guarda
 * SQLite. Lo que no cabe en la hoja va a páginas de desbordamiento enteras. Las filas entran en
 * orden de `id`, así que cada hoja se llena con tantas celdas como quepan, y una celda de algo
 * más de media página ocupa la hoja entera, así que una ficha de 2,2 KB comprimida ocupa 4 KiB.
 */
const enLaTabla = (bytes: number): number => {
  const resto = LOCAL_MINIMO + ((bytes - LOCAL_MINIMO) % (PAGINA_SQLITE - 4));
  const local = bytes <= LOCAL_MAXIMO ? bytes : resto <= LOCAL_MAXIMO ? resto : LOCAL_MINIMO;
  const desbordadas = Math.ceil((bytes - local) / (PAGINA_SQLITE - 4));
  // La celda lleva además su tamaño, el `id`, el puntero a lo desbordado y su puntero en la hoja.
  const celda = local + 12 + (desbordadas > 0 ? 4 : 0);
  const porHoja = Math.max(1, Math.floor((PAGINA_SQLITE - 8) / celda));
  return PAGINA_SQLITE / porHoja + desbordadas * PAGINA_SQLITE;
};

/**
 * Lo que ocupa una entrada de un índice único (`huella`, `url`). Las entradas llegan en desorden,
 * y las páginas de un índice así se quedan, de media, a dos tercios.
 */
const enElIndice = (bytes: number): number => (bytes + 16) * 1.5;

/** Lo que ocupa un paquete sin filas, con la cabecera, el esquema y una página por tabla e índice. */
const PAQUETE_VACIO = 16 * PAGINA_SQLITE;

const FilaOcupada = Schema.Struct({ id: Schema.Int, registro: Schema.Int, indice: Schema.Int });

/**
 * Los bytes del registro de cada fila de una tabla, con su cabecera, y los de la clave de su
 * índice, en `origen` («» o `origen.`).
 */
const OCUPACION: Readonly<Record<Tabla, (origen: string) => string>> = {
  contenidos: (origen) =>
    `SELECT id, length(huella) + length(gzip) + 12 AS registro, length(huella) AS indice
      FROM ${origen}contenidos WHERE id > ? AND id <= ? ORDER BY id`,
  paginas: (origen) =>
    `SELECT id, length(CAST(tipo AS BLOB)) + length(CAST(url AS BLOB))
        + coalesce(length(CAST(clave AS BLOB)), 0) + 8 AS registro,
        length(CAST(url AS BLOB)) AS indice
      FROM ${origen}paginas WHERE id > ? AND id <= ? ORDER BY id`,
  lecturas: (origen) =>
    `SELECT id, length(CAST(resultado AS BLOB)) + 24 AS registro, 0 AS indice
      FROM ${origen}lecturas WHERE id > ? AND id <= ? ORDER BY id`,
};

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

/** Los paquetes que acaba de sacar una noche y las filas nuevas que llevan entre todos. */
export interface Paquetes {
  readonly rutas: ReadonlyArray<string>;
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
  /** El SHA-256 de la página, el nombre de su contenido. */
  readonly huella: string;
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
    /** Lo más que ocupa cada paquete, `TAMANO_DE_PAQUETE` salvo en las pruebas. */
    readonly tamanoDePaquete: number;
    readonly resumen: Effect.Effect<ResumenDelArchivo, ArchivoNoDisponible>;
    /**
     * Saca a `carpeta` lo que el archivo tiene después del último paquete, en paquetes de
     * `tamanoDePaquete` como mucho, o `undefined` si no hay nada nuevo.
     */
    readonly empaquetar: (
      carpeta: string,
    ) => Effect.Effect<Paquetes | undefined, ArchivoNoDisponible>;
    /** Añade al archivo lo que tiene un paquete y aún no tenía. */
    readonly restaurar: (
      paquete: string,
    ) => Effect.Effect<void, ArchivoNoDisponible | PaqueteIncompatible>;
    /**
     * Recorre la última lectura de cada ficha archivada, de `PAGINA` en `PAGINA`, sin tener más
     * de una página de fichas en memoria.
     */
    /**
     * Lo que se lee hoy de las páginas de unas fichas, por su SHA-256, para repetir el historial
     * (ADR 0027). Una que no está en el archivo, o que hoy no se lee, falta.
     */
    readonly fichasDePaginas: (
      huellas: ReadonlyArray<string>,
    ) => Effect.Effect<FichasDeLasPaginas, ArchivoNoDisponible>;
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

const CERO: Cotas = { contenidos: 0, paginas: 0, lecturas: 0 };

/** Unas cuentas leídas de SQLite como cotas, con las de `faltan` en las tablas sin valor. */
const comoCotas = (cuentas: typeof Cuentas.Type | undefined, faltan: Cotas): Cotas => ({
  contenidos: cuentas?.contenidos ?? faltan.contenidos,
  paginas: cuentas?.paginas ?? faltan.paginas,
  lecturas: cuentas?.lecturas ?? faltan.lecturas,
});

/** La mayor cota de cada tabla. */
const mayores = (unas: Cotas, otras: Cotas): Cotas => ({
  contenidos: Math.max(unas.contenidos, otras.contenidos),
  paginas: Math.max(unas.paginas, otras.paginas),
  lecturas: Math.max(unas.lecturas, otras.lecturas),
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
  huella: Schema.String,
  gzip: Schema.Uint8Array,
});
const decodificar = <S extends Schema.Top>(esquema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(esquema));

/** El mensaje de lo que ha hecho fallar algo, en una línea para el diario. */
const mensajeDe = (causa: Cause.Cause<unknown>): string => {
  const error = Cause.squash(causa);
  return error instanceof Error ? error.message : String(error);
};

/** Un contenido del archivo, comprimido. */
const FilaContenido = Schema.Struct({ huella: Schema.String, gzip: Schema.Uint8Array });

const trozosDe = <A>(elementos: ReadonlyArray<A>, tamano: number) =>
  Array.from({ length: Math.ceil(elementos.length / tamano) }, (_, i) =>
    elementos.slice(i * tamano, (i + 1) * tamano),
  );

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

/** La conexión con las filas y el disco donde van los paquetes. */
interface Conexion {
  readonly sql: SqlClient.SqlClient;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}

/** Lo que hay que saber para sacar unas filas en paquetes. */
interface Empaquetado {
  /** Dónde están las filas, «» en la base principal de la conexión u `origen.` en una adjunta. */
  readonly origen: "" | "origen.";
  readonly carpeta: string;
  /** El nombre de los paquetes sin su número, `archivo-<fecha>`. */
  readonly raiz: string;
  readonly hechoEn: number;
  readonly desde: Cotas;
  readonly hasta: Cotas;
  readonly tamano: number;
}

/**
 * Saca a `carpeta` las filas de `desde` (sin incluir) a `hasta` en paquetes de `tamano` bytes como
 * mucho (`partir`), `<raiz>-001.sqlite`, `<raiz>-002.sqlite`… Cada uno es un SQLite con las tablas
 * del archivo, la versión de su esquema y su fila en `paquetes`, y se rehace el archivo con ellos
 * en cualquier orden. Cada uno se escribe con otro nombre y se renombra al acabar, así que uno con
 * su nombre está siempre entero. Tras renombrar cada uno se llama a `alEscribir`. Devuelve sus
 * rutas.
 */
const escribirPaquetes = <E, R>(
  { sql, fs, path }: Conexion,
  empaquetado: Empaquetado,
  alEscribir: (nombre: string, hasta: Cotas) => Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const { origen, carpeta, raiz, desde, hasta } = empaquetado;
    yield* fs.makeDirectory(carpeta, { recursive: true });
    for (const resto of yield* fs.readDirectory(carpeta)) {
      if (resto.endsWith(".parcial")) yield* fs.remove(path.join(carpeta, resto));
    }
    const filas: Record<Tabla, ReadonlyArray<FilaQueOcupa>> = {
      contenidos: [],
      paginas: [],
      lecturas: [],
    };
    for (const tabla of TABLAS) {
      const ocupadas = yield* decodificar(FilaOcupada)(
        yield* sql.unsafe(OCUPACION[tabla](origen), [desde[tabla], hasta[tabla]]),
      );
      filas[tabla] = ocupadas.map((fila): FilaQueOcupa => [
        fila.id,
        enLaTabla(fila.registro) + (fila.indice === 0 ? 0 : enElIndice(fila.indice)),
      ]);
    }
    const rutas: Array<string> = [];
    const tramos = partir(filas, desde, hasta, empaquetado.tamano - PAQUETE_VACIO);
    for (const [indice, { de, a }] of tramos.entries()) {
      const nombre = `${raiz}-${String(indice + 1).padStart(3, "0")}.sqlite`;
      const ruta = path.join(carpeta, nombre);
      const parcial = `${ruta}.parcial`;
      yield* sql.unsafe("ATTACH DATABASE ? AS paquete", [parcial]);
      yield* Effect.ensuring(
        sql.withTransaction(
          Effect.gen(function* () {
            for (const sentencia of tablas("paquete.")) yield* sql.unsafe(sentencia);
            yield* sql.unsafe(`PRAGMA paquete.user_version = ${ESQUEMA_DEL_ARCHIVO.length}`);
            for (const tabla of TABLAS) {
              yield* sql.unsafe(
                `INSERT INTO paquete.${tabla} (${COLUMNAS[tabla]})
                  SELECT ${COLUMNAS[tabla]} FROM ${origen}${tabla} WHERE id > ? AND id <= ?`,
                [de[tabla], a[tabla]],
              );
            }
            yield* sql.unsafe(
              `INSERT INTO paquete.paquetes (${COLUMNAS.paquetes}) VALUES (?, ?, ?, ?, ?)`,
              [nombre, a.contenidos, a.paginas, a.lecturas, empaquetado.hechoEn],
            );
          }),
        ),
        soltarPaquete(sql),
      );
      yield* fs.rename(parcial, ruta);
      yield* alEscribir(nombre, a);
      rutas.push(ruta);
    }
    return rutas;
  });

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
const archivoSobre = (fichero: string, tamanoDePaquete: number, sql: SqlClient.SqlClient) =>
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
     * Copia lo nuevo a paquetes aparte (`escribirPaquetes`). El archivo apunta cada paquete después
     * de renombrarlo: si la noche se corta entre medias, el paquete siguiente repite esas filas, y
     * al restaurar se ignoran las que ya están.
     */
    const empaquetar = Effect.fn("Archivo.empaquetar")(function* (carpeta: string) {
      const ahora = yield* Clock.currentTimeMillis;
      const [antes] = yield* decodificar(Cuentas)(
        yield* sql`SELECT max(contenidos_hasta) AS contenidos, max(paginas_hasta) AS paginas,
            max(lecturas_hasta) AS lecturas FROM paquetes`,
      );
      const [ultimas] = yield* decodificar(Cuentas)(
        yield* sql`SELECT (SELECT max(id) FROM contenidos) AS contenidos,
            (SELECT max(id) FROM paginas) AS paginas, (SELECT max(id) FROM lecturas) AS lecturas`,
      );
      const desde = comoCotas(antes, CERO);
      const hasta = mayores(comoCotas(ultimas, CERO), desde);
      if (TABLAS.every((tabla) => hasta[tabla] <= desde[tabla])) return undefined;

      const fecha = DateTime.formatIso(DateTime.makeUnsafe(ahora)).replaceAll(":", "-");
      const rutas = yield* escribirPaquetes(
        { sql, fs, path },
        {
          origen: "",
          carpeta,
          raiz: `archivo-${fecha}`,
          hechoEn: ahora,
          desde,
          hasta,
          tamano: tamanoDePaquete,
        },
        (nombre, a) =>
          sql`INSERT INTO paquetes ${sql.insert({
            nombre,
            contenidos_hasta: a.contenidos,
            paginas_hasta: a.paginas,
            lecturas_hasta: a.lecturas,
            hecho_en: ahora,
          })}`,
      );
      const hechos: Paquetes = {
        rutas,
        contenidos: hasta.contenidos - desde.contenidos,
        paginas: hasta.paginas - desde.paginas,
        lecturas: hasta.lecturas - desde.lecturas,
      };
      return hechos;
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

    const fichasDePaginas = (huellas: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const fichas = new Map<string, Pick<FichaLeida, "bandas" | "medidasDeExposicion">>();
        for (const trozo of trozosDe(huellas, PAGINA)) {
          const filas = yield* sql`SELECT huella, gzip FROM contenidos
              WHERE huella IN ${sql.in(trozo)}`.pipe(
            Effect.flatMap(decodificar(FilaContenido)),
            Effect.mapError(noDisponible),
          );
          for (const fila of filas) {
            const html = yield* Effect.try({
              try: () => decodificarLatin1(new Uint8Array(NodeZlib.gunzipSync(fila.gzip))),
              catch: () =>
                new ArchivoNoDisponible({ motivo: `no se puede descomprimir ${fila.huella}` }),
            });
            const lectura = lecturaDeFicha(html);
            if (lectura.resultado === "leida") {
              const { bandas, medidasDeExposicion } = lectura.ficha;
              fichas.set(fila.huella, { bandas, medidasDeExposicion });
            }
          }
        }
        const hechas: FichasDeLasPaginas = fichas;
        return hechas;
      }).pipe(Effect.withSpan("Archivo.fichasDePaginas"));

    const recorrerFichas = <E, R>(cada: (ficha: FichaArchivada) => Effect.Effect<void, E, R>) =>
      Effect.gen(function* () {
        for (let desde = 0; ;) {
          const filas =
            yield* sql`SELECT p.id, p.clave, p.url, l.leida_en, l.resultado, c.huella, c.gzip
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
              huella: fila.huella,
            });
          }
          const ultima = filas.at(-1);
          if (ultima === undefined) return;
          desde = ultima.id;
        }
      }).pipe(Effect.withSpan("Archivo.recorrerFichas"));

    return {
      paginas: ArchivoDePaginas.of({ archivar }),
      nocturno: ArchivoNocturno.of({
        fichero,
        tamanoDePaquete,
        resumen,
        empaquetar,
        restaurar,
        fichasDePaginas,
        recorrerFichas,
      }),
    };
  });

/**
 * Un archivo que no se ha podido abrir: no archiva nada, y lo demás falla con el motivo. La
 * ingesta sigue sin él.
 */
const sinArchivo = (fichero: string, tamanoDePaquete: number, motivo: string) => {
  const fallo = Effect.fail(new ArchivoNoDisponible({ motivo }));
  return {
    paginas: ArchivoDePaginas.of({ archivar: () => Effect.void }),
    nocturno: ArchivoNocturno.of({
      fichero,
      tamanoDePaquete,
      resumen: fallo,
      empaquetar: () => fallo,
      restaurar: () => fallo,
      fichasDePaginas: () => fallo,
      recorrerFichas: () => fallo,
    }),
  };
};

/**
 * El archivo de páginas en `fichero`, para la noche (`ArchivoDePaginas`) y para las copias y las
 * relecturas (`ArchivoNocturno`). Si no se puede abrir, lo dice el diario y la noche sigue sin
 * archivar: perder las páginas de una noche es mejor que perder la noche entera.
 */
export const archivoNocturno = (fichero: string, tamanoDePaquete = TAMANO_DE_PAQUETE) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const abierto = yield* Effect.exit(
        Effect.flatMap(abrir(fichero), (sql) => archivoSobre(fichero, tamanoDePaquete, sql)),
      );
      const { paginas, nocturno } = Exit.isSuccess(abierto)
        ? abierto.value
        : yield* Effect.as(
            Effect.logError(
              `No se ha podido abrir el archivo de páginas ${fichero}: ${mensajeDe(abierto.cause)}. ` +
                "La noche sigue sin archivar",
            ),
            sinArchivo(fichero, tamanoDePaquete, `no se ha podido abrir ${fichero}`),
          );
      return Context.make(ArchivoDePaginas, paginas).pipe(Context.add(ArchivoNocturno, nocturno));
    }),
  );

/**
 * Parte un paquete de antes, de un solo fichero por noche, en paquetes de `tamano` como mucho a su
 * lado, `<nombre>-001.sqlite`, `<nombre>-002.sqlite`…, y lo deja entero en la carpeta `ENTEROS`.
 * Los paquetes nuevos llevan las mismas filas y rehacen el mismo archivo. Si se corta a medias, el
 * paquete sigue en su sitio y la vez siguiente se parte otra vez, con los mismos nombres. Devuelve
 * las rutas de los paquetes nuevos.
 */
export const trocearPaquete = Effect.fn("Archivo.trocear")(
  function* (ruta: string, tamano: number) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const carpeta = path.dirname(ruta);
    const nombre = path.basename(ruta);
    const rutas = yield* Effect.scoped(
      Effect.gen(function* () {
        // Una conexión en memoria con el paquete adjunto, que solo se lee. Abierto como base
        // principal, la conexión lo pasaría a WAL y lo cambiaría.
        const contexto = yield* Layer.build(
          SqliteClient.layer({ filename: ":memory:", disableWAL: true }),
        );
        const sql = Context.get(contexto, SqlClient.SqlClient);
        yield* sql.unsafe("ATTACH DATABASE ? AS origen", [ruta]);
        const [version] = yield* sql<{ readonly user_version: number }>`PRAGMA origen.user_version`;
        if (version?.user_version !== ESQUEMA_DEL_ARCHIVO.length) {
          return yield* new PaqueteIncompatible({
            paquete: ruta,
            motivo: `es de la versión ${version?.user_version ?? 0} del archivo, y este es de la ${ESQUEMA_DEL_ARCHIVO.length}`,
          });
        }
        const [suyo] = yield* decodificar(Cuentas)(
          yield* sql`SELECT max(contenidos_hasta) AS contenidos, max(paginas_hasta) AS paginas,
            max(lecturas_hasta) AS lecturas FROM origen.paquetes`,
        );
        const [primeras] = yield* decodificar(Cuentas)(
          yield* sql`SELECT (SELECT min(id) - 1 FROM origen.contenidos) AS contenidos,
            (SELECT min(id) - 1 FROM origen.paginas) AS paginas,
            (SELECT min(id) - 1 FROM origen.lecturas) AS lecturas`,
        );
        const [ultimas] = yield* decodificar(Cuentas)(
          yield* sql`SELECT (SELECT max(id) FROM origen.contenidos) AS contenidos,
            (SELECT max(id) FROM origen.paginas) AS paginas,
            (SELECT max(id) FROM origen.lecturas) AS lecturas`,
        );
        const [hechoEn] = yield* sql<{
          readonly hecho_en: number | null;
        }>`SELECT max(hecho_en) AS hecho_en FROM origen.paquetes`;
        // Hasta donde dice su fila en `paquetes`, y nunca antes de su última fila.
        const hasta = mayores(comoCotas(suyo, CERO), comoCotas(ultimas, CERO));
        const desde = comoCotas(primeras, hasta);
        return yield* escribirPaquetes(
          { sql, fs, path },
          {
            origen: "origen.",
            carpeta,
            raiz: path.basename(nombre, ".sqlite"),
            hechoEn: hechoEn?.hecho_en ?? 0,
            desde,
            hasta,
            tamano,
          },
          () => Effect.void,
        );
      }),
    );
    yield* fs.makeDirectory(path.join(carpeta, ENTEROS), { recursive: true });
    yield* fs.rename(ruta, path.join(carpeta, ENTEROS, nombre));
    return rutas;
  },
  Effect.mapError((error) => (error._tag === "PaqueteIncompatible" ? error : noDisponible(error))),
);

/** Lo que ha pasado con los paquetes del archivo en R2. Nunca es un fallo de la noche. */
export type ArchivoEnR2 =
  /** No hay cubo de R2 configurado. */
  | { readonly tipo: "sin-subir" }
  | { readonly tipo: "subido"; readonly paquetes: ReadonlyArray<string> }
  /** `paquetes` son los que sí se han subido antes del fallo. */
  | {
      readonly tipo: "fallido";
      readonly motivo: string;
      readonly paquetes: ReadonlyArray<string>;
    };

/** Lo que ha hecho la copia del archivo de una noche. */
export interface CopiaDelArchivo {
  /** Los paquetes nuevos de la noche, o `undefined` si no había nada nuevo o no se pudo sacar. */
  readonly paquetes: Paquetes | undefined;
  readonly enR2: ArchivoEnR2;
}

/**
 * Sube a R2 los paquetes de `carpeta` que aún no están allí, del más viejo al más nuevo. Así una
 * subida que falla se repite sola la noche siguiente, con los paquetes de esa noche. Se para en el
 * primero que no sube tras los reintentos de cada petición (`PLAZOS_DE_R2`), porque si R2 o la
 * conexión no responden, insistir con los demás solo alargaría la noche. Los que ya han subido no
 * se vuelven a subir.
 *
 * Un paquete de más del doble de `tamano` es de antes de partirlos, y se parte primero
 * (`trocearPaquete`) para subir sus partes. Si no se puede partir, lo dice el diario y no se sube.
 */
const subirPaquetes = Effect.fn("Archivo.subirPaquetes")(function* (
  carpeta: string,
  tamano: number,
) {
  const almacen = yield* Effect.serviceOption(AlmacenDelArchivo);
  if (Option.isNone(almacen)) {
    const sinSubir: ArchivoEnR2 = { tipo: "sin-subir" };
    return sinSubir;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const subidos: Array<string> = [];
  return yield* Effect.gen(function* () {
    const enR2 = new Set(yield* almacen.value.listar);
    const faltan = Effect.gen(function* () {
      if (!(yield* fs.exists(carpeta))) return [];
      return (yield* fs.readDirectory(carpeta))
        .filter((nombre) => PAQUETE.test(nombre) && !enR2.has(nombre))
        .toSorted();
    });
    const esGrande = (ruta: string) =>
      Effect.map(fs.stat(ruta), (info) => Number(info.size) > 2 * tamano);
    for (const nombre of yield* faltan) {
      const ruta = path.join(carpeta, nombre);
      if (!(yield* esGrande(ruta))) continue;
      yield* trocearPaquete(ruta, tamano).pipe(
        Effect.flatMap((rutas) =>
          Effect.logInfo(
            `Archivo de páginas: ${nombre} partido en ${rutas.length} paquetes para subirlo; ` +
              `el entero queda en ${path.join(carpeta, ENTEROS)}`,
          ),
        ),
        Effect.catch((fallo) =>
          Effect.logWarning(`No se ha podido partir ${nombre} para subirlo a R2: ${fallo.motivo}`),
        ),
      );
    }
    for (const nombre of yield* faltan) {
      const ruta = path.join(carpeta, nombre);
      if (yield* esGrande(ruta)) continue;
      yield* almacen.value.guardar(nombre, new Uint8Array(yield* fs.readFile(ruta)));
      subidos.push(nombre);
    }
    const subido: ArchivoEnR2 = { tipo: "subido", paquetes: subidos };
    return subido;
  }).pipe(
    Effect.catch((fallo) =>
      Effect.succeed<ArchivoEnR2>({
        tipo: "fallido",
        motivo: "motivo" in fallo ? fallo.motivo : fallo.message,
        paquetes: subidos,
      }),
    ),
  );
});

/** Los paquetes de una noche para el diario, el único o el primero y el último. */
const describirPaquetes = (rutas: ReadonlyArray<string>): string =>
  rutas.length === 1
    ? `paquete ${rutas[0] ?? ""}`
    : `${rutas.length} paquetes, de ${rutas[0] ?? ""} a ${rutas.at(-1) ?? ""},`;

/**
 * La copia del archivo al acabar la noche (ADR 0027): saca a `carpeta` lo nuevo en paquetes y
 * sube a R2 los paquetes que aún no están allí. Sin el archivo en el contexto no hace nada. Si algo
 * falla, lo dice el diario y la noche sigue: lo que no se ha copiado va en los paquetes o la subida
 * siguientes.
 */
export const copiarArchivo = Effect.fn("Archivo.copiar")(function* (carpeta: string) {
  const archivo = yield* Effect.serviceOption(ArchivoNocturno);
  if (Option.isNone(archivo)) return undefined;
  const paquetes = yield* archivo.value.empaquetar(carpeta).pipe(
    Effect.tap((hechos) =>
      hechos === undefined
        ? Effect.logInfo("Archivo de páginas: nada nuevo que empaquetar")
        : Effect.logInfo(
            `Archivo de páginas: ${describirPaquetes(hechos.rutas)} con ${hechos.lecturas} ` +
              `lecturas, ${hechos.paginas} páginas nuevas y ${hechos.contenidos} contenidos nuevos`,
          ),
    ),
    Effect.catch((fallo) =>
      Effect.as(
        Effect.logWarning(`No se ha podido empaquetar el archivo de páginas: ${fallo.motivo}`),
        undefined,
      ),
    ),
  );
  const enR2 = yield* subirPaquetes(carpeta, archivo.value.tamanoDePaquete);
  if (enR2.tipo !== "sin-subir" && enR2.paquetes.length > 0) {
    yield* Effect.logInfo(`Archivo de páginas en R2: ${enR2.paquetes.join(", ")}`);
  }
  if (enR2.tipo === "fallido") {
    yield* Effect.logWarning(
      `No se han podido subir los paquetes del archivo a R2: ${enR2.motivo}. ` +
        "Los que faltan se suben la noche siguiente",
    );
  }
  const hecha: CopiaDelArchivo = { paquetes, enR2 };
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
        return aplicarLeida(
          archivada.clave,
          { ...lectura.ficha, pagina: archivada.huella },
          archivada.leidaEn,
        );
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
