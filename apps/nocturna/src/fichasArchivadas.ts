import type { FichaLeida } from "@celda/ingesta/extractor";
import { lecturaDeFicha } from "@celda/ingesta/registro-oficial/normalizar";
import { decodificarLatin1 } from "@celda/ingesta/texto";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeZlib from "node:zlib";

/**
 * Leer las fichas del archivo de páginas por su SHA-256 (ADR 0027). Lo usan el archivo de la
 * noche (`archivo.ts`) y la versión 11 de la base, que abre el archivo solo para leer.
 */

/** El archivo no se ha podido abrir o no responde. */
export class ArchivoNoDisponible extends Schema.TaggedError<ArchivoNoDisponible>()(
  "ArchivoNoDisponible",
  { motivo: Schema.String },
) {}

/** Un contenido del archivo, comprimido. */
const FilaContenido = Schema.Struct({ huella: Schema.String, gzip: Schema.Uint8Array });
const decodificarContenidos = Schema.decodeUnknownEffect(Schema.Array(FilaContenido));

/** Contenidos por consulta. */
const POR_CONSULTA = 500;

/**
 * Lo que se lee hoy de las fichas de unos contenidos del archivo abierto en `sql`, por su
 * SHA-256, con la lectura de hoy (`lecturaDeFicha`). Una que no está en el archivo, o que hoy no
 * se lee como ficha, falta.
 */
export const fichasDeContenidos = Effect.fn("Archivo.fichasDeContenidos")(function* (
  sql: SqlClient.SqlClient,
  huellas: ReadonlyArray<string>,
) {
  const fichas = new Map<string, FichaLeida>();
  for (let desde = 0; desde < huellas.length; desde += POR_CONSULTA) {
    const trozo = huellas.slice(desde, desde + POR_CONSULTA);
    const filas = yield* sql`SELECT huella, gzip FROM contenidos
          WHERE huella IN ${sql.in(trozo)}`.pipe(
      Effect.flatMap(decodificarContenidos),
      Effect.mapError((error) => new ArchivoNoDisponible({ motivo: error.message })),
    );
    for (const fila of filas) {
      const html = yield* Effect.try({
        try: () => decodificarLatin1(new Uint8Array(NodeZlib.gunzipSync(fila.gzip))),
        catch: () => new ArchivoNoDisponible({ motivo: `no se puede descomprimir ${fila.huella}` }),
      });
      const lectura = lecturaDeFicha(html);
      if (lectura.resultado === "leida") fichas.set(fila.huella, lectura.ficha);
    }
  }
  const leidas: ReadonlyMap<string, FichaLeida> = fichas;
  return leidas;
});

/**
 * El archivo de páginas en `fichero`, abierto solo para leer, mientras dure el ámbito. No crea el
 * fichero si no existe ni lo pasa a WAL: falla con `ArchivoNoDisponible`.
 */
export const abrirParaLeer = (fichero: string) =>
  Layer.build(SqliteClient.layer({ filename: fichero, readonly: true, disableWAL: true })).pipe(
    Effect.map((contexto) => Context.get(contexto, SqlClient.SqlClient)),
    Effect.tap((sql) => sql`SELECT 1 FROM contenidos LIMIT 1`),
    Effect.mapError((error) => new ArchivoNoDisponible({ motivo: `${fichero}: ${error.message}` })),
  );
