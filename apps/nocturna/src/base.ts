import { Caja as CajaEsquema, Cuadro, cuadroDe } from "@celda/dominio/barrido";
import { compararTexto } from "@celda/dominio/banda";
import { emplazamientoDeCapa } from "@celda/dominio/capa";
import { Emplazamiento } from "@celda/dominio/emplazamiento";
import { fichaDe } from "@celda/dominio/ficha";
import { fusionar } from "@celda/dominio/fusion";
import { Fuente } from "@celda/dominio/observacion";
import {
  type BarridoAbierto,
  BaseDeBarrido,
  type EstadoDeZona,
  ZonaEnLaEjecucion,
} from "@celda/ingesta/barrido";
import {
  Cambios,
  erroresDeOmitida,
  EstadoEjecucion,
  type Interruptor,
  SIN_CAMBIOS,
} from "@celda/ingesta/ejecucion";
import {
  ObservacionGuardada,
  observacionDe,
  registroDe,
  trasAusencia,
  trasFicha,
  trasListado,
} from "@celda/ingesta/guardado";
import {
  DatosNoDisponibles,
  DatosPublicables,
  ResultadoPublicacion,
} from "@celda/publicacion/publicar";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlError from "effect/unstable/sql/SqlError";

/** Dónde está la base y cómo están los interruptores de las fuentes. */
export interface OpcionesBase {
  /** El fichero SQLite. Su carpeta se crea si no existe. */
  readonly fichero: string;
  readonly interruptores: Readonly<Record<Fuente, Interruptor>>;
}

/**
 * El esquema de la base, por versiones (`PRAGMA user_version`). Cada versión es una lista de
 * sentencias; una base nueva las aplica todas y una antigua, las que le faltan.
 *
 * - `observaciones`: lo último que dice cada fuente de cada estación base (`ObservacionGuardada`
 *   en `datos`), con cuándo se leyó su ficha y si está retirada fuera del JSON para buscar.
 * - `emplazamientos`: los de la última fusión, con la fecha en que cambió cada uno.
 * - `ejecuciones`: cada pasada de un extractor, con sus cambios, sus errores y cómo acabó la
 *   publicación de su noche.
 * - `publicaciones`: cada intento de publicar, con su resultado.
 * - `versiones` y `ficheros_publicados`: lo publicado, con la huella de cada fichero.
 *
 * La versión 2 trae el barrido por zonas (ADR 0014):
 *
 * - en `observaciones`, el cuadro en que cae cada una y cuándo la vio un listado por última vez;
 * - `cuadros`: las cajas en que se dividió cada cuadro la última vez, para pedirlas directamente;
 * - `barridos`: cada barrido de una zona, con sus cuadros, y `cuadros_barridos`, los que ya se han
 *   recorrido, para retomar uno cortado;
 * - en `ejecuciones`, lo que hizo cada zona.
 */
/**
 * La parte entera por abajo de una coordenada de la observación, en SQL: `CAST` redondea hacia
 * el cero, así que a los negativos con decimales hay que restarles uno. Da su cuadro, como
 * `cuadroDe`.
 */
const sueloDe = (eje: "longitud" | "latitud") => {
  const valor = `json_extract(datos, '$.posicion.${eje}')`;
  return `(CAST(${valor} AS INTEGER) - (${valor} < CAST(${valor} AS INTEGER)))`;
};

export const ESQUEMA: ReadonlyArray<ReadonlyArray<string>> = [
  [
    `CREATE TABLE observaciones (
      id INTEGER PRIMARY KEY,
      fuente TEXT NOT NULL,
      clave TEXT NOT NULL,
      ficha_leida_en INTEGER,
      retirada_en INTEGER,
      datos TEXT NOT NULL,
      UNIQUE (fuente, clave)
    )`,
    `CREATE INDEX observaciones_por_ficha ON observaciones (fuente, ficha_leida_en, id)`,
    `CREATE TABLE emplazamientos (
      clave TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      datos TEXT NOT NULL
    )`,
    `CREATE TABLE ejecuciones (
      id INTEGER PRIMARY KEY,
      fuente TEXT NOT NULL,
      inicio INTEGER NOT NULL,
      fin INTEGER,
      estado TEXT NOT NULL,
      registros INTEGER,
      cambios TEXT NOT NULL,
      errores TEXT NOT NULL,
      publicacion TEXT
    )`,
    `CREATE INDEX ejecuciones_por_fuente ON ejecuciones (fuente, inicio)`,
    `CREATE TABLE publicaciones (
      id INTEGER PRIMARY KEY,
      fecha INTEGER NOT NULL,
      resultado TEXT NOT NULL
    )`,
    `CREATE TABLE versiones (
      version TEXT PRIMARY KEY,
      fecha INTEGER NOT NULL,
      url TEXT NOT NULL,
      emplazamientos INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      publicada_en INTEGER NOT NULL
    )`,
    `CREATE TABLE ficheros_publicados (
      fichero TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      huella TEXT NOT NULL,
      bytes INTEGER NOT NULL
    )`,
  ],
  [
    `ALTER TABLE observaciones ADD COLUMN cuadro TEXT`,
    `ALTER TABLE observaciones ADD COLUMN vista_en INTEGER`,
    `UPDATE observaciones SET cuadro = ${sueloDe("longitud")} || ',' || ${sueloDe("latitud")}`,
    `CREATE INDEX observaciones_por_cuadro ON observaciones (fuente, cuadro, retirada_en)`,
    `CREATE TABLE cuadros (
      cuadro TEXT PRIMARY KEY,
      cajas TEXT NOT NULL,
      actualizado INTEGER NOT NULL
    )`,
    `CREATE TABLE barridos (
      id INTEGER PRIMARY KEY,
      fuente TEXT NOT NULL,
      zona TEXT NOT NULL,
      cuadros TEXT NOT NULL,
      inicio INTEGER NOT NULL,
      fin INTEGER,
      estado TEXT NOT NULL,
      ejecucion INTEGER NOT NULL,
      error TEXT
    )`,
    `CREATE INDEX barridos_por_zona ON barridos (fuente, zona, estado)`,
    `CREATE TABLE cuadros_barridos (
      barrido INTEGER NOT NULL,
      cuadro TEXT NOT NULL,
      registros INTEGER NOT NULL,
      PRIMARY KEY (barrido, cuadro)
    )`,
    `ALTER TABLE ejecuciones ADD COLUMN zonas TEXT`,
  ],
];

const ObservacionEnJson = Schema.fromJsonString(ObservacionGuardada);
const ZonasEnJson = Schema.fromJsonString(Schema.Array(ZonaEnLaEjecucion));
const EmplazamientoEnJson = Schema.fromJsonString(Emplazamiento);

const FilaObservacion = Schema.Struct({ id: Schema.Int, datos: ObservacionEnJson });
const FilaEmplazamiento = Schema.Struct({
  clave: Schema.String,
  version: Schema.Finite,
  datos: EmplazamientoEnJson,
});

/** Una ejecución tal como la guarda la base. */
export const EjecucionGuardada = Schema.Struct({
  id: Schema.Int,
  fuente: Fuente,
  inicio: Schema.Finite,
  fin: Schema.NullOr(Schema.Finite),
  estado: EstadoEjecucion,
  registros: Schema.NullOr(Schema.Int),
  cambios: Schema.fromJsonString(Cambios),
  errores: Schema.fromJsonString(Schema.Array(Schema.String)),
  /** Cómo acabó la publicación de su noche, si era una ejecución completada. */
  publicacion: Schema.NullOr(Schema.fromJsonString(ResultadoPublicacion)),
  /** Lo que hizo cada zona de barrido. Nulo en las ejecuciones de antes del barrido por zonas. */
  zonas: Schema.NullOr(ZonasEnJson),
});
export type EjecucionGuardada = typeof EjecucionGuardada.Type;

const FilaBarrido = Schema.Struct({
  id: Schema.Int,
  fuente: Fuente,
  inicio: Schema.Finite,
  cuadros: Schema.fromJsonString(Schema.Array(Cuadro)),
});
const FilaCajas = Schema.Struct({
  cuadro: Cuadro,
  cajas: Schema.fromJsonString(Schema.Array(CajaEsquema)),
});
const FilaZona = Schema.Struct({
  zona: Schema.String,
  completado: Schema.NullOr(Schema.Finite),
  aMedias: Schema.Int,
});

const FilaPublicacion = Schema.Struct({
  fecha: Schema.Finite,
  resultado: Schema.fromJsonString(ResultadoPublicacion),
});
const Cuenta = Schema.Struct({ n: Schema.Int });
const Maximo = Schema.Struct({ v: Schema.NullOr(Schema.Finite) });

const decodificar = <S extends Schema.Top>(esquema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(esquema));
const codificarObservacion = Schema.encodeEffect(ObservacionEnJson);
const codificarEmplazamiento = Schema.encodeEffect(EmplazamientoEnJson);
const codificarCambios = Schema.encodeEffect(Schema.fromJsonString(Cambios));
const codificarErrores = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const codificarResultado = Schema.encodeEffect(Schema.fromJsonString(ResultadoPublicacion));
const codificarZonas = Schema.encodeEffect(ZonasEnJson);
const codificarCuadros = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Cuadro)));
const codificarCajas = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(CajaEsquema)));

const mismoEmplazamiento = Schema.toEquivalence(Emplazamiento);

/** Registros por consulta al guardar el listado de un cuadro. */
const LOTE = 200;

const trozos = <A>(elementos: ReadonlyArray<A>, tamano: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(elementos.length / tamano) }, (_, i) =>
    elementos.slice(i * tamano, (i + 1) * tamano),
  );

/** El último intento de publicar. */
export interface IntentoDePublicacion {
  readonly fecha: number;
  readonly resultado: ResultadoPublicacion;
}

/** Lo que el mantenedor quiere saber de una fuente. */
export interface ResumenDeFuente {
  readonly fuente: Fuente;
  readonly interruptor: Interruptor;
  readonly ultima: EjecucionGuardada | undefined;
  /** Observaciones que no se han retirado. */
  readonly vigentes: number;
  /** Fichas que no se han leído nunca, o que cambiaron en el listado. */
  readonly sinLeer: number;
  /** Fichas leídas antes de la fecha de rotación, que se vuelven a leer. */
  readonly porReleer: number;
  /** Las zonas que ha barrido alguna vez, por nombre. */
  readonly zonas: ReadonlyArray<ResumenDeZona>;
}

/** Lo que el mantenedor quiere saber de una zona de barrido. */
export interface ResumenDeZona extends EstadoDeZona {
  readonly zona: string;
}

/** El estado de la base para la orden `estado`. */
export interface Resumen {
  readonly fuentes: ReadonlyArray<ResumenDeFuente>;
  readonly emplazamientos: number;
  /** Fecha de la versión de los datos, o `null` sin emplazamientos. */
  readonly version: number | null;
  /** La última versión registrada como publicada. */
  readonly publicada: string | undefined;
  readonly ultimoIntento: IntentoDePublicacion | undefined;
}

/**
 * Lo que la ingesta nocturna hace con su base además de ingerir y publicar: apuntar cómo ha ido
 * cada publicación, resumir el estado y copiarse.
 */
export class BaseNocturna extends Context.Service<
  BaseNocturna,
  {
    readonly fichero: string;
    /** Apunta un intento de publicar y, en las ejecuciones de su noche, cómo ha ido. */
    readonly apuntarPublicacion: (
      intento: IntentoDePublicacion,
      ejecuciones: ReadonlyArray<string>,
    ) => Effect.Effect<void>;
    /** El estado de cada fuente, de los emplazamientos y de lo publicado. */
    readonly resumen: (leidasAntesDe: number) => Effect.Effect<Resumen>;
    /** Una copia coherente de la base en `destino`, que no puede existir (`VACUUM INTO`). */
    readonly copiar: (destino: string) => Effect.Effect<void>;
  }
>()("@celda/nocturna/base/BaseNocturna") {}

/**
 * Aplica las versiones del esquema que le faltan a la base. Una base al día no toma el cerrojo
 * de escritura, así que la orden `estado` se puede lanzar en mitad de una noche. Si falta algo,
 * vuelve a leer la versión dentro de la transacción: si dos procesos abren a la vez una base
 * nueva, el segundo ya la encuentra al día.
 */
const migrar = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [antes] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
  if ((antes?.user_version ?? 0) >= ESQUEMA.length) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const [fila] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
      const actual = fila?.user_version ?? 0;
      for (const [indice, sentencias] of ESQUEMA.entries()) {
        if (indice < actual) continue;
        for (const sentencia of sentencias) {
          yield* sql.unsafe(sentencia);
        }
        yield* sql.unsafe(`PRAGMA user_version = ${indice + 1}`);
      }
    }),
  );
});

/**
 * La base SQLite de la ingesta nocturna (ADR 0015), con el módulo `node:sqlite` de Node 24 a
 * través del adaptador de Effect. Da la `BaseDeBarrido` del proceso, los `DatosPublicables` de
 * la publicación y la `BaseNocturna`. Toda escritura de un paso va en una transacción, así que un
 * corte a mitad deja el paso entero o nada.
 */
export const baseNocturna = (opciones: OpcionesBase) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Sin su esquema la base no sirve para nada: un fallo aquí para el programa.
      yield* Effect.orDie(migrar);

      const observacionesDe = Effect.fn("BaseNocturna.observacionesDe")(function* (
        fuente: Fuente,
        claves: ReadonlyArray<string>,
      ) {
        if (claves.length === 0) return new Map<string, typeof FilaObservacion.Type>();
        const filas = yield* decodificar(FilaObservacion)(
          yield* sql`SELECT id, datos FROM observaciones
            WHERE fuente = ${fuente} AND clave IN ${sql.in(claves)}`,
        );
        return new Map(filas.map((fila) => [fila.datos.clave, fila]));
      });

      const guardarObservacion = Effect.fn("BaseNocturna.guardarObservacion")(function* (
        id: number | undefined,
        o: ObservacionGuardada,
      ) {
        const datos = yield* codificarObservacion(o);
        if (id === undefined) {
          yield* sql`INSERT INTO observaciones ${sql.insert({
            fuente: o.fuente,
            clave: o.clave,
            ficha_leida_en: o.fichaLeidaEn,
            retirada_en: o.retiradaEn,
            cuadro: cuadroDe(o.posicion),
            datos,
          })}`;
          return;
        }
        yield* sql`UPDATE observaciones
          SET ficha_leida_en = ${o.fichaLeidaEn}, retirada_en = ${o.retiradaEn},
            cuadro = ${cuadroDe(o.posicion)}, datos = ${datos}
          WHERE id = ${id}`;
      });

      const versionDeLosDatos = Effect.gen(function* () {
        // Un emplazamiento retirado se borra y no deja versión: cuenta la fecha de la ejecución
        // que lo retiró, como en `datos:version` de Convex.
        const [cambiado] = yield* decodificar(Maximo)(
          yield* sql`SELECT max(version) AS v FROM emplazamientos`,
        );
        const [retirado] = yield* decodificar(Maximo)(
          yield* sql`SELECT max(inicio) AS v FROM ejecuciones WHERE estado = 'completada'
            AND json_extract(cambios, '$.emplazamientos.retirados') > 0`,
        );
        const fechas = [cambiado?.v ?? null, retirado?.v ?? null].filter((v) => v !== null);
        return fechas.length === 0 ? null : Math.max(...fechas);
      });

      const base = BaseDeBarrido.of({
        iniciar: Effect.fn("BaseNocturna.iniciar")(function* (fuente, fecha) {
          const interruptor = opciones.interruptores[fuente];
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE ejecuciones SET estado = 'interrumpida', fin = ${fecha}
                  WHERE fuente = ${fuente} AND estado = 'en curso'`;
              const omitida = !interruptor.activo;
              const [fila] = yield* sql<{
                readonly id: number;
              }>`INSERT INTO ejecuciones ${sql.insert({
                fuente,
                inicio: fecha,
                fin: omitida ? fecha : null,
                estado: omitida ? "omitida" : "en curso",
                registros: null,
                cambios: yield* codificarCambios(SIN_CAMBIOS),
                errores: yield* codificarErrores(omitida ? erroresDeOmitida(interruptor) : []),
                publicacion: null,
              })} RETURNING id`;
              return {
                tipo: omitida ? ("omitida" as const) : ("iniciada" as const),
                ejecucion: String(fila?.id ?? 0),
              };
            }),
          );
        }, Effect.orDie),

        estadoDeZonas: Effect.fn("BaseNocturna.estadoDeZonas")(function* (fuente) {
          const filas = yield* decodificar(FilaZona)(
            yield* sql`SELECT zona,
                max(CASE WHEN estado = 'completado' THEN inicio END) AS completado,
                max(estado = 'en curso') AS aMedias
              FROM barridos WHERE fuente = ${fuente} GROUP BY zona`,
          );
          return new Map(
            filas.map((fila): [string, EstadoDeZona] => [
              fila.zona,
              { completado: fila.completado, aMedias: fila.aMedias > 0 },
            ]),
          );
        }, Effect.orDie),

        abrirBarrido: Effect.fn("BaseNocturna.abrirBarrido")(function* (
          ejecucion,
          fuente,
          zona,
          fecha,
        ) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const [aMedias] = yield* decodificar(FilaBarrido)(
                yield* sql`SELECT id, fuente, inicio, cuadros FROM barridos
                    WHERE fuente = ${fuente} AND zona = ${zona.nombre} AND estado = 'en curso'
                    ORDER BY id DESC LIMIT 1`,
              );
              let barrido: typeof FilaBarrido.Type;
              if (aMedias === undefined) {
                const [fila] = yield* sql<{ readonly id: number }>`INSERT INTO barridos
                    ${sql.insert({
                      fuente,
                      zona: zona.nombre,
                      cuadros: yield* codificarCuadros(zona.cuadros),
                      inicio: fecha,
                      fin: null,
                      estado: "en curso",
                      ejecucion: Number(ejecucion),
                      error: null,
                    })} RETURNING id`;
                barrido = { id: fila?.id ?? 0, fuente, inicio: fecha, cuadros: zona.cuadros };
              } else {
                yield* sql`UPDATE barridos SET ejecucion = ${Number(ejecucion)}
                    WHERE id = ${aMedias.id}`;
                barrido = aMedias;
              }
              const hechos = yield* sql<{ readonly cuadro: string }>`SELECT cuadro
                  FROM cuadros_barridos WHERE barrido = ${barrido.id}`;
              const cajas =
                barrido.cuadros.length === 0
                  ? []
                  : yield* decodificar(FilaCajas)(
                      yield* sql`SELECT cuadro, cajas FROM cuadros
                          WHERE cuadro IN ${sql.in(barrido.cuadros)}`,
                    );
              const abierto: BarridoAbierto = {
                barrido: String(barrido.id),
                inicio: barrido.inicio,
                cuadros: barrido.cuadros,
                hechos: new Set(hechos.map((fila) => fila.cuadro)),
                cajas: new Map(cajas.map((fila) => [fila.cuadro, fila.cajas])),
              };
              return abierto;
            }),
          );
        }, Effect.orDie),

        vigentesEn: Effect.fn("BaseNocturna.vigentesEn")(function* (fuente, cuadro) {
          const [fila] = yield* decodificar(Cuenta)(
            yield* sql`SELECT count(*) AS n FROM observaciones
                WHERE fuente = ${fuente} AND cuadro = ${cuadro} AND retirada_en IS NULL`,
          );
          return fila?.n ?? 0;
        }, Effect.orDie),

        aplicarCuadro: Effect.fn("BaseNocturna.aplicarCuadro")(function* (
          barrido,
          cuadro,
          fecha,
          recorrido,
        ) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const [fila] = yield* decodificar(FilaBarrido)(
                yield* sql`SELECT id, fuente, inicio, cuadros FROM barridos
                    WHERE id = ${Number(barrido)}`,
              );
              let creados = 0;
              let cambiados = 0;
              if (fila === undefined) return { creados, cambiados };
              for (const lote of trozos(recorrido.registros, LOTE)) {
                const claves = lote.map((registro) => registro.clave);
                const previas = yield* observacionesDe(fila.fuente, claves);
                for (const registro of lote) {
                  const previa = previas.get(registro.clave);
                  const { guardar, cuenta } = trasListado(
                    previa?.datos,
                    registro,
                    fila.fuente,
                    fecha,
                  );
                  if (guardar !== undefined) {
                    yield* guardarObservacion(previa?.id, guardar);
                  }
                  creados += cuenta === "creada" ? 1 : 0;
                  cambiados += cuenta === "cambiada" ? 1 : 0;
                }
                yield* sql`UPDATE observaciones SET vista_en = ${fecha}
                    WHERE fuente = ${fila.fuente} AND clave IN ${sql.in(claves)}`;
              }
              yield* sql`INSERT INTO cuadros ${sql.insert({
                cuadro,
                cajas: yield* codificarCajas(recorrido.cajas),
                actualizado: fecha,
              })} ON CONFLICT (cuadro) DO UPDATE SET cajas = excluded.cajas,
                  actualizado = excluded.actualizado`;
              yield* sql`INSERT INTO cuadros_barridos ${sql.insert({
                barrido: fila.id,
                cuadro,
                registros: recorrido.registros.length,
              })} ON CONFLICT DO NOTHING`;
              return { creados, cambiados };
            }),
          );
        }, Effect.orDie),

        cerrarBarrido: Effect.fn("BaseNocturna.cerrarBarrido")(function* (barrido, fecha, fin) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const [fila] = yield* decodificar(FilaBarrido)(
                yield* sql`SELECT id, fuente, inicio, cuadros FROM barridos
                    WHERE id = ${Number(barrido)} AND estado = 'en curso'`,
              );
              if (fila === undefined) return { retirados: 0 };
              const ausentes =
                fila.cuadros.length === 0
                  ? []
                  : yield* decodificar(FilaObservacion)(
                      yield* sql`SELECT id, datos FROM observaciones
                          WHERE fuente = ${fila.fuente} AND retirada_en IS NULL
                            AND cuadro IN ${sql.in(fila.cuadros)}
                            AND (vista_en IS NULL OR vista_en < ${fila.inicio})`,
                    );
              let retirados = 0;
              for (const { id, datos } of ausentes) {
                const { guardada, retirada } = trasAusencia(datos, fecha);
                yield* guardarObservacion(id, guardada);
                retirados += retirada ? 1 : 0;
              }
              yield* sql`UPDATE barridos SET estado = 'completado', fin = ${fin}
                  WHERE id = ${fila.id}`;
              return { retirados };
            }),
          );
        }, Effect.orDie),

        fallarBarrido: Effect.fn("BaseNocturna.fallarBarrido")(function* (barrido, fin, motivo) {
          yield* sql`UPDATE barridos SET estado = 'fallido', fin = ${fin}, error = ${motivo}
              WHERE id = ${Number(barrido)} AND estado = 'en curso'`;
        }, Effect.orDie),

        pendientesDeFicha: Effect.fn("BaseNocturna.pendientesDeFicha")(function* (
          fuente,
          leidasAntesDe,
          limite,
        ) {
          // Las pendientes (nulas) van primero, en el orden en que se crearon, como en el
          // índice `por_ficha` de Convex.
          const filas = yield* decodificar(FilaObservacion)(
            yield* sql`SELECT id, datos FROM observaciones
                WHERE fuente = ${fuente} AND retirada_en IS NULL
                  AND (ficha_leida_en IS NULL OR ficha_leida_en < ${leidasAntesDe})
                ORDER BY ficha_leida_en ASC, id ASC
                LIMIT ${limite}`,
          );
          return filas.map((fila) => registroDe(fila.datos));
        }, Effect.orDie),

        aplicarFicha: Effect.fn("BaseNocturna.aplicarFicha")(function* (
          fuente,
          clave,
          fecha,
          bandas,
        ) {
          const previa = (yield* observacionesDe(fuente, [clave])).get(clave);
          if (previa === undefined) return false;
          const { guardada, cambiada } = trasFicha(previa.datos, bandas, fecha);
          yield* guardarObservacion(previa.id, guardada);
          return cambiada;
        }, Effect.orDie),

        fusionar: Effect.fn("BaseNocturna.fusionar")(function* (fecha) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const vigentes = yield* decodificar(FilaObservacion)(
                yield* sql`SELECT id, datos FROM observaciones WHERE retirada_en IS NULL`,
              );
              const nuevos = fusionar(vigentes.map((fila) => observacionDe(fila.datos)));
              const guardados = new Map(
                (yield* decodificar(FilaEmplazamiento)(
                  yield* sql`SELECT clave, version, datos FROM emplazamientos`,
                )).map((fila) => [fila.clave, fila.datos]),
              );
              const cuentas = { creados: 0, cambiados: 0, retirados: 0 };
              const claves = new Set(nuevos.map((e) => e.clave));
              for (const clave of guardados.keys()) {
                if (claves.has(clave)) continue;
                yield* sql`DELETE FROM emplazamientos WHERE clave = ${clave}`;
                cuentas.retirados++;
              }
              for (const emplazamiento of nuevos) {
                const previo = guardados.get(emplazamiento.clave);
                if (previo !== undefined && mismoEmplazamiento(previo, emplazamiento)) continue;
                const datos = yield* codificarEmplazamiento(emplazamiento);
                yield* sql`INSERT INTO emplazamientos ${sql.insert({
                  clave: emplazamiento.clave,
                  version: fecha,
                  datos,
                })} ON CONFLICT (clave) DO UPDATE SET version = excluded.version,
                    datos = excluded.datos`;
                if (previo === undefined) cuentas.creados++;
                else cuentas.cambiados++;
              }
              return cuentas;
            }),
          );
        }, Effect.orDie),

        completar: Effect.fn("BaseNocturna.completar")(function* (
          ejecucion,
          { fin, registros, cambios, errores, zonas },
        ) {
          yield* sql`UPDATE ejecuciones SET estado = 'completada', fin = ${fin},
              registros = ${registros}, cambios = ${yield* codificarCambios(cambios)},
              errores = ${yield* codificarErrores(errores)}, zonas = ${yield* codificarZonas(zonas)}
              WHERE id = ${Number(ejecucion)}`;
        }, Effect.orDie),

        fallar: Effect.fn("BaseNocturna.fallar")(function* (
          ejecucion,
          { fin, cambios, errores, zonas },
        ) {
          yield* sql`UPDATE ejecuciones SET estado = 'fallida', fin = ${fin},
              cambios = ${yield* codificarCambios(cambios)},
              errores = ${yield* codificarErrores(errores)}, zonas = ${yield* codificarZonas(zonas)}
              WHERE id = ${Number(ejecucion)}`;
        }, Effect.orDie),
      });

      const noDisponible = (error: { readonly message: string }) =>
        new DatosNoDisponibles({ motivo: `la base SQLite: ${error.message}` });

      const fichaDeClave = Effect.fn("BaseNocturna.ficha")(function* (clave: string) {
        const [fila] = yield* decodificar(FilaEmplazamiento)(
          yield* sql`SELECT clave, version, datos FROM emplazamientos WHERE clave = ${clave}`,
        );
        if (fila === undefined) return [];
        const estaciones = yield* Effect.forEach(fila.datos.estaciones, (estacion) =>
          Effect.map(
            Effect.forEach(estacion.observaciones, ({ fuente, clave: claveFuente }) =>
              Effect.map(observacionesDe(fuente, [claveFuente]), (encontradas) => [
                ...encontradas.values(),
              ]),
            ),
            (encontradas) => ({
              estacion,
              observaciones: encontradas.flat().map((encontrada) => encontrada.datos),
            }),
          ),
        );
        return [fichaDe(fila.datos, fila.version, estaciones)];
      });

      const datos = DatosPublicables.of({
        version: versionDeLosDatos.pipe(Effect.mapError(noDisponible)),
        emplazamientos: Effect.gen(function* () {
          const filas = yield* decodificar(FilaEmplazamiento)(
            yield* sql`SELECT clave, version, datos FROM emplazamientos ORDER BY clave`,
          );
          return filas.map((fila) => emplazamientoDeCapa(fila.datos, fila.datos.estaciones));
        }).pipe(Effect.mapError(noDisponible)),
        fichas: (claves) =>
          Effect.map(Effect.forEach(claves, fichaDeClave), (fichas) => fichas.flat()).pipe(
            Effect.mapError(noDisponible),
          ),
        registrar: (publicada) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO versiones ${sql.insert({
                  version: publicada.version,
                  fecha: publicada.fecha,
                  url: publicada.url,
                  emplazamientos: publicada.emplazamientos,
                  bytes: publicada.bytes,
                  publicada_en: publicada.publicadaEn,
                })} ON CONFLICT (version) DO UPDATE SET url = excluded.url`;
                for (const fichero of publicada.ficheros) {
                  yield* sql`INSERT INTO ficheros_publicados ${sql.insert({
                    fichero: fichero.fichero,
                    version: publicada.version,
                    huella: fichero.huella,
                    bytes: fichero.bytes,
                  })} ON CONFLICT (fichero) DO UPDATE SET huella = excluded.huella,
                    bytes = excluded.bytes`;
                }
              }),
            )
            .pipe(Effect.mapError(noDisponible)),
      });

      const cuenta = (consulta: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>) =>
        Effect.map(Effect.flatMap(consulta, decodificar(Cuenta)), ([fila]) => fila?.n ?? 0);

      const nocturna = BaseNocturna.of({
        fichero: opciones.fichero,
        apuntarPublicacion: Effect.fn("BaseNocturna.apuntarPublicacion")(function* (
          { fecha, resultado },
          ejecuciones,
        ) {
          const texto = yield* codificarResultado(resultado);
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO publicaciones ${sql.insert({ fecha, resultado: texto })}`;
              if (ejecuciones.length > 0) {
                yield* sql`UPDATE ejecuciones SET publicacion = ${texto}
                    WHERE id IN ${sql.in(ejecuciones.map(Number))}`;
              }
            }),
          );
        }, Effect.orDie),

        resumen: Effect.fn("BaseNocturna.resumen")(function* (leidasAntesDe) {
          const fuentes = yield* Effect.forEach(Fuente.literals, (fuente) =>
            Effect.gen(function* () {
              const [ultima] = yield* decodificar(EjecucionGuardada)(
                yield* sql`SELECT * FROM ejecuciones WHERE fuente = ${fuente}
                    ORDER BY inicio DESC, id DESC LIMIT 1`,
              );
              const resumen: ResumenDeFuente = {
                fuente,
                interruptor: opciones.interruptores[fuente],
                ultima,
                vigentes: yield* cuenta(sql`SELECT count(*) AS n FROM observaciones
                    WHERE fuente = ${fuente} AND retirada_en IS NULL`),
                sinLeer: yield* cuenta(sql`SELECT count(*) AS n FROM observaciones
                    WHERE fuente = ${fuente} AND retirada_en IS NULL AND ficha_leida_en IS NULL`),
                porReleer: yield* cuenta(sql`SELECT count(*) AS n FROM observaciones
                    WHERE fuente = ${fuente} AND retirada_en IS NULL
                      AND ficha_leida_en < ${leidasAntesDe}`),
                zonas: [...(yield* base.estadoDeZonas(fuente))]
                  .map(([zona, estado]) => ({ zona, ...estado }))
                  .sort((a, b) => compararTexto(a.zona, b.zona)),
              };
              return resumen;
            }),
          );
          const [intento] = yield* decodificar(FilaPublicacion)(
            yield* sql`SELECT fecha, resultado FROM publicaciones ORDER BY id DESC LIMIT 1`,
          );
          const [publicada] = yield* sql<{
            readonly version: string;
          }>`SELECT version FROM versiones ORDER BY fecha DESC LIMIT 1`;
          const resumen: Resumen = {
            fuentes,
            emplazamientos: yield* cuenta(sql`SELECT count(*) AS n FROM emplazamientos`),
            version: yield* versionDeLosDatos,
            publicada: publicada?.version,
            ultimoIntento: intento,
          };
          return resumen;
        }, Effect.orDie),

        copiar: Effect.fn("BaseNocturna.copiar")(function* (destino) {
          yield* sql`VACUUM INTO ${destino}`;
        }, Effect.orDie),
      });

      return Context.make(BaseDeBarrido, base).pipe(
        Context.add(DatosPublicables, datos),
        Context.add(BaseNocturna, nocturna),
      );
    }),
  ).pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* Effect.orDie(
            fs.makeDirectory(path.dirname(opciones.fichero), { recursive: true }),
          );
          return SqliteClient.layer({ filename: opciones.fichero });
        }),
      ),
    ),
  );
