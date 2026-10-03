// La orden es su propio punto de entrada y monta aquí sus capas, una vez.
// @effect-diagnostics strictEffectProvide:off
import { ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import { ficheroDeCuadros, PasadaDeBorde } from "@celda/dominio/cuadrosDelRegistro";
import { municipiosDeEspana } from "@celda/publicacion/zonas";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { derivarCuadros, type ListadoDeEspana } from "../cuadros.ts";

/**
 * Rehace `packages/dominio/datos/cuadros-del-registro.json` con el listado propio del registro
 * oficial de toda España (ADR 0019, #55): los registros vigentes de una base de la ingesta nocturna
 * que tenga barridas las siete zonas y, si se le da, la pasada por los cuadros de borde
 * (`celda-nocturna cuadros-de-borde`). La base se abre solo para leer.
 *
 *     pnpm run cuadros <ingesta.sqlite> [pasada-de-borde.json]
 *
 * Escribe el fichero y dice los registros de cada zona, los cuadros nuevos y los que cambian de
 * zona. `ZONAS_DE_BARRIDO` se pone al día a mano con eso: una prueba de `@celda/dominio` comprueba
 * que coincide con el fichero.
 */

const DESTINO = new URL(
  "../../../../packages/dominio/datos/cuadros-del-registro.json",
  import.meta.url,
);

const Posicion = Schema.Struct({ longitud: Schema.Finite, latitud: Schema.Finite });
const UltimoBarrido = Schema.Struct({ zona: Schema.String, inicio: Schema.Finite });
const decodificarPosiciones = Schema.decodeUnknownEffect(Schema.Array(Posicion));
const decodificarBarridos = Schema.decodeUnknownEffect(Schema.Array(UltimoBarrido));
const decodificarBorde = Schema.decodeEffect(Schema.fromJsonString(PasadaDeBorde));

const dia = (milisegundos: number) =>
  DateTime.formatIsoDate(DateTime.makeUnsafe(milisegundos)).split("-").toReversed().join("/");

/** Los registros vigentes del registro oficial en la base, si tiene barridas las siete zonas. */
const listadoDeLaBase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const barridos = yield* decodificarBarridos(
    yield* sql`SELECT zona, max(inicio) AS inicio FROM barridos
      WHERE fuente = 'registro-oficial' AND estado = 'completado' GROUP BY zona`,
  );
  const barridas = new Set(barridos.map((b) => b.zona));
  const faltan = ZONAS_DE_BARRIDO.filter((zona) => !barridas.has(zona.nombre));
  if (faltan.length > 0) {
    return yield* Effect.die(
      `La base no tiene el listado de toda España: le falta un barrido completo de ` +
        faltan.map((zona) => zona.nombre).join(", "),
    );
  }
  const posiciones = yield* decodificarPosiciones(
    yield* sql`SELECT json_extract(datos, '$.posicion.longitud') AS longitud,
        json_extract(datos, '$.posicion.latitud') AS latitud
      FROM observaciones WHERE fuente = 'registro-oficial' AND retirada_en IS NULL`,
  );
  const barrido = Math.min(...barridos.map((b) => b.inicio));
  const listado: ListadoDeEspana = {
    fuente:
      `Los ${posiciones.length.toLocaleString("es-ES")} registros vigentes del listado del ` +
      `registro oficial en la base de la ingesta nocturna, con las siete zonas barridas desde el ` +
      `${dia(barrido)}`,
    barrido,
    posiciones,
  };
  return listado;
});

const derivar = Effect.gen(function* () {
  const [base, borde] = process.argv.slice(2);
  if (base === undefined) {
    return yield* Effect.die("Uso: cuadros <ingesta.sqlite> [pasada-de-borde.json]");
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const listado = yield* listadoDeLaBase.pipe(
    Effect.provide(SqliteClient.layer({ filename: path.resolve(base), readonly: true })),
  );
  const pasada =
    borde === undefined
      ? null
      : yield* decodificarBorde(yield* fs.readFileString(path.resolve(borde)));
  const indice = yield* municipiosDeEspana;
  const cuadros = yield* Effect.fromResult(derivarCuadros(listado, pasada, indice));
  const destino = yield* path.fromFileUrl(DESTINO);
  yield* fs.writeFileString(destino, ficheroDeCuadros(cuadros));

  const antes = new Map(
    ZONAS_DE_BARRIDO.flatMap((zona) => zona.cuadros.map((cuadro) => [cuadro, zona.nombre])),
  );
  const ahora = new Map(cuadros.cuadros.map((c) => [c.cuadro, c.zona]));
  const lineas = [
    `${cuadros.registros} registros en ${cuadros.cuadros.length} cuadros, escritos en ${destino}`,
    ...ZONAS_DE_BARRIDO.map((zona) => {
      const suyos = cuadros.cuadros.filter((c) => c.zona === zona.nombre);
      const registros = suyos.reduce((suma, c) => suma + c.registros, 0);
      return `- ${zona.nombre}: ${registros} registros, ${suyos.length} cuadros: ${suyos.map((c) => `"${c.cuadro}"`).join(", ")}`;
    }),
    `Cuadros nuevos: ${[...ahora.keys()].filter((c) => !antes.has(c)).join(" ") || "ninguno"}`,
    `Cuadros sin registros: ${[...antes.keys()].filter((c) => !ahora.has(c)).join(" ") || "ninguno"}`,
    `Cuadros que cambian de zona: ${
      [...ahora]
        .filter(([c, zona]) => antes.has(c) && antes.get(c) !== zona)
        .map(([c, zona]) => `${c} (${antes.get(c)} → ${zona})`)
        .join(", ") || "ninguno"
    }`,
  ];
  if (pasada !== null) {
    const conRegistros = pasada.cuadros.filter((c) => c.registros > 0);
    lineas.push(
      `Pasada de borde: ${pasada.cuadros.length} cuadros pedidos, ${pasada.peticiones} peticiones, ` +
        `${conRegistros.length} con registros: ` +
        (conRegistros.map((c) => `${c.cuadro} (${c.registros})`).join(", ") || "ninguno"),
      ...pasada.errores.map((error) => `  error: ${error}`),
    );
  }
  yield* Effect.logInfo(lineas.join("\n"));
});

NodeRuntime.runMain(derivar.pipe(Effect.provide(NodeServices.layer)));
