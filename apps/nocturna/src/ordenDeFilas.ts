import { Fuente } from "@celda/dominio/observacion";
import type { FichaCruda, FichaLeida } from "@celda/ingesta/extractor";
import { ObservacionGuardada, huellaDeFicha } from "@celda/ingesta/guardado";
import {
  corregirElOrden,
  type HechoLeido,
  type LoQueDiceLaFicha,
  leerHecho,
  paginasDe,
} from "@celda/ingesta/hechos";
import { huella } from "@celda/ingesta/huella";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { abrirParaLeer, type ArchivoNoDisponible, fichasDeContenidos } from "./fichasArchivadas.ts";

/**
 * La versión 11 de la base (ADR 0027) corrige el historial que dejó comparar las filas de la ficha
 * en el orden de la página. El registro da las filas de «Características técnicas» y de «Niveles
 * medidos en el entorno» en otro orden de una petición a otra, con lo mismo en ellas, y hasta esta
 * versión eso contaba como un cambio de la ficha. Quedaba un hecho de ficha con `cambia`, se movía
 * la fecha de la observación y la ficha publicada decía «cambio de ficha».
 *
 * Se hace al abrir la base, en la transacción de la versión, y sin ninguna orden:
 *
 * 1. Cada hecho de ficha con `cambia` se compara con lo que había antes sin mirar el orden
 *    (`corregirElOrden`). Si dice lo mismo, pasa a `cambia` falso, y la observación vuelve a la
 *    fecha que tenía antes de él si era la de ese hecho.
 * 2. La huella de la ficha de cada observación (`huellaDeFicha`) pasa a la que no mira el orden,
 *    sacada de las filas de la página de su último hecho de ficha. Sin esto, la siguiente lectura
 *    de cada ficha escribiría un hecho sin cambio.
 *
 * Las páginas salen del archivo de páginas, que se abre solo para leer. Si no está o no responde,
 * el paso 1 compara con lo que guarda la base (el punto de partida, lo leído de un hecho y la
 * observación de hoy para el último hecho de ficha) y el paso 2 no se hace, así que la siguiente
 * lectura de cada ficha deja un hecho sin cambio, que no se publica. Lo que no se puede comparar
 * se queda como está y lo dice el diario.
 */

/** Registros por trozo al corregir sus hechos. */
const REGISTROS_POR_TROZO = 200;

/** Observaciones por trozo al poner al día sus huellas. */
const OBSERVACIONES_POR_TROZO = 1000;

/** Cuántos registros sin comparar dice el diario uno a uno. */
const PRIMEROS_SIN_COMPARAR = 20;

/**
 * La huella de las tablas de una ficha como se calculaba hasta la versión 11, con las filas en el
 * orden de la página. Solo sirve para comprobar que la huella guardada es la de una página.
 */
export const huellaEnElOrdenDeLaPagina = (cruda: FichaCruda): string =>
  huella(
    [
      cruda.caracteristicas.map((f) => [f.operador, f.referencia, f.bandaMhz].join("\u001f")),
      cruda.niveles.map((f) => [f.distancia, f.acimut, f.valor].join("\u001f")),
    ]
      .map((filas) => filas.join("\u001e"))
      .join("\u001d"),
  );

const FilaRegistro = Schema.Struct({ fuente: Fuente, clave: Schema.String });
const FilaHecho = Schema.Struct({
  fuente: Fuente,
  clave: Schema.String,
  version: Schema.Int,
  tipo: Schema.String,
  fecha: Schema.Finite,
  datos: Schema.String,
});
const FilaObservacion = Schema.Struct({
  id: Schema.Int,
  fuente: Fuente,
  datos: Schema.fromJsonString(ObservacionGuardada),
});
const FilaHuella = Schema.Struct({
  id: Schema.Int,
  huella: Schema.String,
  pagina: Schema.NullOr(Schema.String),
});
const decodificar = <S extends Schema.Top>(esquema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(esquema));
const codificarObservacion = Schema.encodeEffect(Schema.fromJsonString(ObservacionGuardada));

const trozos = <A>(elementos: ReadonlyArray<A>, tamano: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(elementos.length / tamano) }, (_, i) =>
    elementos.slice(i * tamano, (i + 1) * tamano),
  );

/** Un hecho de ficha con `cambia` que no se ha podido comparar, con el motivo. */
interface SinComparar {
  readonly clave: string;
  readonly motivo: string;
}

/** Lo que ha hecho la corrección, para el diario y las pruebas. */
export interface OrdenCorregido {
  /** Si se han leído las páginas del archivo. */
  readonly conArchivo: boolean;
  /** Hechos de ficha que han pasado a `cambia` falso. */
  readonly hechos: number;
  /** Observaciones que han vuelto a su fecha de antes. */
  readonly fechas: number;
  /** Observaciones con la huella de su ficha al día. */
  readonly huellas: number;
  /** Hechos de ficha con `cambia` que no se han podido comparar. */
  readonly sinComparar: ReadonlyArray<SinComparar>;
}

/** Lo que se lee hoy de unas páginas del archivo, por su SHA-256. */
type Paginas = (huellas: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, FichaLeida>>;

const sinArchivo = (motivo: string) =>
  Effect.as(
    Effect.logWarning(
      `Versión 11 de la base: ${motivo}. Los hechos de ficha se comparan con lo que guarda la ` +
        "base y las huellas de las fichas se quedan como estaban",
    ),
    undefined,
  );

/** El archivo de páginas abierto solo para leer, o `undefined` si no está o no se abre. */
const abrirArchivo = Effect.fn("Base.abrirArchivoParaElOrden")(function* (
  archivo: string | undefined,
) {
  if (archivo === undefined) return yield* sinArchivo("no hay archivo de páginas");
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* Effect.orElseSucceed(fs.exists(archivo), () => false))) {
    return yield* sinArchivo(`no está el archivo de páginas ${archivo}`);
  }
  return yield* abrirParaLeer(archivo).pipe(
    Effect.catch((error) => sinArchivo(`no se puede leer el archivo de páginas (${error.motivo})`)),
  );
});

/**
 * Las páginas del archivo abierto. Si deja de responder, lo dice el diario una vez y desde ahí no
 * da ninguna.
 */
const lectorDePaginas = (abierto: SqlClient.SqlClient | undefined) => {
  let falla = false;
  const paginas: Paginas = (huellas) =>
    abierto === undefined || falla || huellas.length === 0
      ? Effect.succeed(new Map())
      : fichasDeContenidos(abierto, huellas).pipe(
          Effect.catch((error: ArchivoNoDisponible) => {
            falla = true;
            return Effect.as(
              Effect.logWarning(
                `Versión 11 de la base: el archivo de páginas no responde (${error.motivo}). ` +
                  "Lo que falta se compara con lo que guarda la base",
              ),
              new Map<string, FichaLeida>(),
            );
          }),
        );
  return { paginas, responde: () => abierto !== undefined && !falla };
};

/**
 * Corrige los hechos de ficha de un registro que solo cambian el orden (`corregirElOrden`) y
 * devuelve su observación a la fecha de antes. Dice cuántos hechos ha corregido, si ha cambiado la
 * fecha y por qué no ha podido comparar algo.
 */
const corregirRegistro = Effect.fn("Base.corregirRegistro")(function* (
  sql: SqlClient.SqlClient,
  suyos: ReadonlyArray<typeof FilaHecho.Type>,
  leidos: ReadonlyArray<HechoLeido>,
  observacion: typeof FilaObservacion.Type | undefined,
  fichas: ReadonlyMap<string, FichaLeida>,
) {
  const medidas = observacion?.datos.medidasDeExposicion;
  const ultima: LoQueDiceLaFicha | undefined =
    observacion === undefined || medidas === undefined
      ? undefined
      : { bandas: observacion.datos.bandas, medidasDeExposicion: medidas };
  const correccion = corregirElOrden(leidos, fichas, ultima);
  const motivos = correccion.sinComparar.map((s) => s.motivo);
  let hechos = 0;
  for (const indice of correccion.sinCambio) {
    const hecho = suyos[indice];
    if (hecho === undefined) continue;
    yield* sql`UPDATE hechos SET datos = json_set(datos, '$.cambia', json('false'))
      WHERE fuente = ${hecho.fuente} AND clave = ${hecho.clave} AND version = ${hecho.version}`;
    hechos++;
  }
  const { fechaAntes, fechaDespues } = correccion;
  if (
    observacion === undefined ||
    fechaDespues === undefined ||
    fechaDespues === fechaAntes ||
    observacion.datos.fecha === fechaDespues
  ) {
    return { hechos, fecha: false, motivos };
  }
  // Solo si la fecha de la observación es la que daba su historial. Si no, no se sabe de dónde
  // sale y se queda como está.
  if (observacion.datos.fecha !== fechaAntes) {
    const motivo = `la observación tiene la fecha ${observacion.datos.fecha} y su historial da ${fechaAntes}`;
    return { hechos, fecha: false, motivos: [...motivos, motivo] };
  }
  const datos = yield* codificarObservacion({ ...observacion.datos, fecha: fechaDespues });
  yield* sql`UPDATE observaciones SET datos = ${datos} WHERE id = ${observacion.id}`;
  return { hechos, fecha: true, motivos };
});

/** El paso 1: los hechos de ficha con `cambia`, por trozos de registros de la misma fuente. */
const corregirHechos = Effect.fn("Base.corregirHechos")(function* (
  sql: SqlClient.SqlClient,
  conCambio: ReadonlyArray<typeof FilaRegistro.Type>,
  paginas: Paginas,
) {
  const cuenta = { hechos: 0, fechas: 0 };
  const sinComparar: Array<SinComparar> = [];
  for (const fuente of new Set(conCambio.map((r) => r.fuente))) {
    const claves = conCambio.filter((r) => r.fuente === fuente).map((r) => r.clave);
    for (const trozo of trozos(claves, REGISTROS_POR_TROZO)) {
      const filas = yield* decodificar(FilaHecho)(
        yield* sql`SELECT fuente, clave, version, tipo, fecha, datos FROM hechos
          WHERE fuente = ${fuente} AND clave IN ${sql.in(trozo)} ORDER BY clave, version`,
      );
      const observaciones = new Map(
        (yield* decodificar(FilaObservacion)(
          yield* sql`SELECT id, fuente, datos FROM observaciones
            WHERE fuente = ${fuente} AND clave IN ${sql.in(trozo)}`,
        )).map((fila) => [fila.datos.clave, fila]),
      );
      const porClave = new Map<string, Array<typeof FilaHecho.Type>>();
      for (const fila of filas) {
        porClave.set(fila.clave, [...(porClave.get(fila.clave) ?? []), fila]);
      }
      const leidos = new Map(
        [...porClave].map(([clave, suyos]) => [
          clave,
          Result.all(suyos.map((h) => leerHecho(h.tipo, h.fecha, h.datos))),
        ]),
      );
      const fichas = yield* paginas([
        ...new Set(
          [...leidos.values()].flatMap((l) => (Result.isSuccess(l) ? paginasDe(l.success) : [])),
        ),
      ]);
      for (const clave of trozo) {
        const leido = leidos.get(clave) ?? Result.succeed([]);
        if (Result.isFailure(leido)) {
          sinComparar.push({ clave, motivo: leido.failure });
          continue;
        }
        const corregido = yield* corregirRegistro(
          sql,
          porClave.get(clave) ?? [],
          leido.success,
          observaciones.get(clave),
          fichas,
        );
        cuenta.hechos += corregido.hechos;
        cuenta.fechas += corregido.fecha ? 1 : 0;
        sinComparar.push(...corregido.motivos.map((motivo) => ({ clave, motivo })));
      }
    }
  }
  return { ...cuenta, sinComparar };
});

/**
 * El paso 2: la huella de cada ficha, con las filas de la página de su último hecho de ficha, si
 * la huella guardada es la de esas filas en el orden de la página. Dice cuántas cambian.
 */
const ponerAlDiaLasHuellas = Effect.fn("Base.ponerAlDiaLasHuellas")(function* (
  sql: SqlClient.SqlClient,
  paginas: Paginas,
) {
  let huellas = 0;
  for (let desde = 0; ;) {
    const filas = yield* decodificar(FilaHuella)(
      yield* sql`SELECT o.id, json_extract(o.datos, '$.huellaDeFicha') AS huella,
          (SELECT json_extract(h.datos, '$.ficha.pagina') FROM hechos h
            WHERE h.fuente = o.fuente AND h.clave = o.clave AND h.tipo = 'ficha'
            ORDER BY h.version DESC LIMIT 1) AS pagina
        FROM observaciones o
        WHERE o.id > ${desde} AND json_extract(o.datos, '$.huellaDeFicha') IS NOT NULL
        ORDER BY o.id LIMIT ${OBSERVACIONES_POR_TROZO}`,
    );
    const ultima = filas.at(-1);
    if (ultima === undefined) return huellas;
    desde = ultima.id;
    const fichas = yield* paginas([...new Set(filas.flatMap((f) => f.pagina ?? []))]);
    for (const fila of filas) {
      const cruda = fila.pagina === null ? undefined : fichas.get(fila.pagina)?.cruda;
      if (cruda === undefined || huellaEnElOrdenDeLaPagina(cruda) !== fila.huella) continue;
      const nueva = huellaDeFicha(cruda);
      if (nueva === fila.huella) continue;
      yield* sql`UPDATE observaciones SET datos = json_set(datos, '$.huellaDeFicha', ${nueva})
        WHERE id = ${fila.id}`;
      huellas++;
    }
  }
});

/**
 * Corrige los hechos de ficha que solo cambian el orden de las filas y pone al día las huellas,
 * dentro de la transacción de quien la llama. Lee las páginas del archivo en `archivo`, si lo hay.
 * Se puede repetir, y la segunda vez no cambia nada.
 */
export const corregirOrdenDeFilas = Effect.fn("Base.corregirOrdenDeFilas")(function* (
  sql: SqlClient.SqlClient,
  archivo: string | undefined,
) {
  const conCambio = yield* decodificar(FilaRegistro)(
    yield* sql`SELECT DISTINCT fuente, clave FROM hechos
      WHERE tipo = 'ficha' AND json_extract(datos, '$.cambia') = 1
      ORDER BY fuente, clave`,
  );
  const [conHuella] = yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM observaciones
    WHERE json_extract(datos, '$.huellaDeFicha') IS NOT NULL`;
  if (conCambio.length === 0 && (conHuella?.n ?? 0) === 0) {
    const nada: OrdenCorregido = {
      conArchivo: false,
      hechos: 0,
      fechas: 0,
      huellas: 0,
      sinComparar: [],
    };
    return nada;
  }
  const abierto = yield* abrirArchivo(archivo);
  const { paginas, responde } = lectorDePaginas(abierto);
  const { hechos, fechas, sinComparar } = yield* corregirHechos(sql, conCambio, paginas);
  const huellas = abierto === undefined ? 0 : yield* ponerAlDiaLasHuellas(sql, paginas);
  const hecha: OrdenCorregido = { conArchivo: responde(), hechos, fechas, huellas, sinComparar };
  yield* Effect.logInfo(
    `Versión 11 de la base: ${hechos} hechos de ficha que solo cambiaban el orden de las filas ` +
      `pasan a no cambiar nada, ${fechas} observaciones vuelven a su fecha de antes y ${huellas} ` +
      `huellas de ficha se ponen al día. Sin comparar: ${sinComparar.length}`,
  );
  for (const { clave, motivo } of sinComparar.slice(0, PRIMEROS_SIN_COMPARAR)) {
    yield* Effect.logWarning(`Versión 11 de la base, sin comparar: ${clave}: ${motivo}`);
  }
  return hecha;
});
