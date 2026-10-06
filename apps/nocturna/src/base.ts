import { Caja as CajaEsquema, Cuadro, cuadroDe, ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import { compararTexto } from "@celda/dominio/banda";
import { type EmplazamientoDeCapa, emplazamientoDeCapa } from "@celda/dominio/capa";
import { Emplazamiento, type Estado } from "@celda/dominio/emplazamiento";
import { fichaDe } from "@celda/dominio/ficha";
import { fusionar } from "@celda/dominio/fusion";
import {
  AceptadaParaPublicar,
  correccionesDeFicha,
  emplazamientoDe,
} from "@celda/dominio/moderacion";
import { Fuente, type Observacion } from "@celda/dominio/observacion";
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
import type { FichaEnCola } from "@celda/ingesta/fichas";
import { Registro } from "@celda/ingesta/extractor";
import { VERSION_DE_LECTURA } from "@celda/ingesta/registro-oficial/normalizar";
import {
  ObservacionGuardada,
  observacionDe,
  registroDe,
  trasAusencia,
  trasFicha,
  trasListado,
  trasSinFicha,
} from "@celda/ingesta/guardado";
import { zonasBarridas } from "@celda/publicacion/cobertura";
import {
  DatosNoDisponibles,
  DatosPublicables,
  ResultadoPublicacion,
} from "@celda/publicacion/publicar";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Clock from "effect/Clock";
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
 *
 * La versión 3 trajo `puntos`, los marcadores de una web de antenas que el ADR 0019 retira.
 *
 * La versión 4 trae la cola de fichas en la ventana (ticket 41): en `observaciones`, los fallos
 * seguidos de la ficha, hasta cuándo espera antes de volver a pedirla y el último error.
 *
 * La versión 5 retira esa web (ADR 0019, #55): borra la tabla `puntos` y las observaciones, los
 * barridos y las ejecuciones de las fuentes que ya no están en `Fuente`. Con su interruptor siempre
 * apagado, solo eran ejecuciones omitidas.
 *
 * La versión 6 trae lo aceptado en la moderación (ADR 0020, #57): `aportaciones_aceptadas`, con
 * cada corrección propuesta o corroboración aceptada que la noche ha leído del buzón, su
 * emplazamiento, el seudónimo de quien la envió (para contar a cada persona una vez), cuándo se
 * aceptó y la fecha de la ejecución que la trajo. Ni la identidad ni la huella de la IP salen del
 * buzón.
 *
 * La versión 7 trae, en `observaciones`, la versión de la lectura con que se leyó cada ficha
 * (`VERSION_DE_LECTURA`, #73). Las leídas antes se quedan con la 1, la que solo sacaba las bandas,
 * y vuelven a la cola para traer sus medidas de exposición del ministerio.
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

/** Las fuentes de hoy, como lista de SQL: `('registro-oficial', …)`. */
const FUENTES = `(${Fuente.literals.map((fuente) => `'${fuente}'`).join(", ")})`;

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
  [
    `CREATE TABLE puntos (
      id INTEGER PRIMARY KEY,
      fuente TEXT NOT NULL,
      clave TEXT NOT NULL,
      cuadro TEXT NOT NULL,
      prioridad INTEGER NOT NULL,
      detalle_leido_en INTEGER,
      vista_en INTEGER,
      retirado_en INTEGER,
      datos TEXT NOT NULL,
      UNIQUE (fuente, clave)
    )`,
    `CREATE INDEX puntos_por_detalle ON puntos (fuente, detalle_leido_en, prioridad, id)`,
    `CREATE INDEX puntos_por_cuadro ON puntos (fuente, cuadro, retirado_en)`,
  ],
  [
    `ALTER TABLE observaciones ADD COLUMN ficha_fallos INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE observaciones ADD COLUMN ficha_espera_hasta INTEGER`,
    `ALTER TABLE observaciones ADD COLUMN ficha_error TEXT`,
  ],
  [
    `DELETE FROM observaciones WHERE fuente NOT IN ${FUENTES}`,
    `DELETE FROM cuadros_barridos
      WHERE barrido IN (SELECT id FROM barridos WHERE fuente NOT IN ${FUENTES})`,
    `DELETE FROM barridos WHERE fuente NOT IN ${FUENTES}`,
    `DELETE FROM ejecuciones WHERE fuente NOT IN ${FUENTES}`,
    `DROP TABLE puntos`,
  ],
  [
    `CREATE TABLE aportaciones_aceptadas (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      emplazamiento TEXT,
      persona TEXT NOT NULL,
      aceptada_en INTEGER NOT NULL,
      importada_en INTEGER NOT NULL,
      datos TEXT NOT NULL
    )`,
    `CREATE INDEX aportaciones_aceptadas_por_emplazamiento
      ON aportaciones_aceptadas (emplazamiento, tipo)`,
    `CREATE INDEX aportaciones_aceptadas_por_aceptacion ON aportaciones_aceptadas (aceptada_en)`,
  ],
  [`ALTER TABLE observaciones ADD COLUMN ficha_leida_con INTEGER NOT NULL DEFAULT 1`],
];

const ObservacionEnJson = Schema.fromJsonString(ObservacionGuardada);
const ZonasEnJson = Schema.fromJsonString(Schema.Array(ZonaEnLaEjecucion));
const EmplazamientoEnJson = Schema.fromJsonString(Emplazamiento);
const decodificarEmplazamiento = Schema.decodeEffect(EmplazamientoEnJson);

const FilaObservacion = Schema.Struct({ id: Schema.Int, datos: ObservacionEnJson });
/** Una ficha de la cola: solo lo que dice el listado de su observación, sin lo de su ficha. */
const FilaDeCola = Schema.Struct({
  id: Schema.Int,
  cuadro: Schema.NullOr(Schema.String),
  ficha_leida_en: Schema.NullOr(Schema.Finite),
  ficha_fallos: Schema.Int,
  ficha_espera_hasta: Schema.NullOr(Schema.Finite),
  datos: Schema.fromJsonString(Registro),
});
const ContenidoEnJson = Schema.fromJsonString(AceptadaParaPublicar.fields.contenido);
const codificarAportacion = Schema.encodeEffect(ContenidoEnJson);

/** Una aportación aceptada tal como la guarda la base. */
const FilaAceptada = Schema.Struct({
  id: Schema.String,
  persona: Schema.String,
  aceptada_en: Schema.Finite,
  importada_en: Schema.Finite,
  datos: ContenidoEnJson,
});

/** Las correcciones de la ficha que salen de las filas aceptadas de su emplazamiento. */
const correccionesDeFilas = (filas: ReadonlyArray<typeof FilaAceptada.Type>) =>
  correccionesDeFicha(
    filas.map((f) => ({
      id: f.id,
      persona: f.persona,
      aceptadaEl: f.aceptada_en,
      contenido: f.datos,
    })),
  );

/** Un emplazamiento que la comunidad corrige deja de estar verificado (CONTEXT.md, «Estado»). */
const corregido = (estado: Estado): Estado => (estado === "verificado" ? "corregido" : estado);

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

/** Una ficha que espera tras un fallo, para la orden `estado`. */
export const FichaEnEspera = Schema.Struct({
  clave: Schema.String,
  /** Fallos seguidos: el próximo intento es el siguiente. */
  fallos: Schema.Int,
  esperaHasta: Schema.Finite,
  /** El último error, o nulo en una base de antes de apuntarlo. */
  motivo: Schema.NullOr(Schema.String),
});
export type FichaEnEspera = typeof FichaEnEspera.Type;

/** Cuántas fichas espera la orden `estado` enseñar, de las que esperan tras un fallo. */
export const PRIMERAS_EN_ESPERA = 10;

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

/**
 * Filas por página al leer todas las observaciones o todos los emplazamientos. Con toda España
 * son unas 70.000 y 42.000: leídas de una vez, el JSON de todas y lo decodificado de todas
 * estarían a la vez en memoria (#50).
 */
const PAGINA = 2000;

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
  /**
   * Fichas leídas antes de la fecha de rotación, o con una versión de la lectura anterior, que se
   * vuelven a leer.
   */
  readonly porReleer: number;
  /** Fichas que esperan tras un fallo para volver a pedirse. */
  readonly enEspera: number;
  /** Las primeras que se volverán a pedir, como mucho `PRIMERAS_EN_ESPERA`. */
  readonly primerasEnEspera: ReadonlyArray<FichaEnEspera>;
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
    /**
     * El estado de cada fuente, de los emplazamientos y de lo publicado. Las fichas en espera son
     * las que esperan a esta hora.
     */
    readonly resumen: (leidasAntesDe: number) => Effect.Effect<Resumen>;
    /** Una copia coherente de la base en `destino`, que no puede existir (`VACUUM INTO`). */
    readonly copiar: (destino: string) => Effect.Effect<void>;
    /**
     * La hora de aceptación de la última aportación aceptada que tiene la base, o `null` si no
     * tiene ninguna: la noche sigue leyendo el buzón desde ahí.
     */
    readonly ultimaAceptada: Effect.Effect<number | null>;
    /**
     * Guarda, en una transacción, las aportaciones aceptadas que aún no tenía, con la fecha de la
     * ejecución que las trae. Las que ya tenía no cambian. Devuelve cuántas eran nuevas.
     */
    readonly guardarAceptadas: (
      aceptadas: ReadonlyArray<AceptadaParaPublicar>,
      fecha: number,
    ) => Effect.Effect<number>;
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

      /**
       * Guarda una observación. Con `sinFallos`, su ficha vuelve a la cola sin espera y con la
       * versión de la lectura de hoy: se acaba de leer, o el listado ha cambiado y hay que leerla
       * otra vez, y entonces la versión no cuenta porque no tiene fecha de lectura.
       */
      const guardarObservacion = Effect.fn("BaseNocturna.guardarObservacion")(function* (
        id: number | undefined,
        o: ObservacionGuardada,
        sinFallos: boolean = false,
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
        if (sinFallos) {
          yield* sql`UPDATE observaciones
            SET ficha_leida_en = ${o.fichaLeidaEn}, retirada_en = ${o.retiradaEn},
              cuadro = ${cuadroDe(o.posicion)}, datos = ${datos}, ficha_fallos = 0,
              ficha_espera_hasta = NULL, ficha_error = NULL, ficha_leida_con = ${VERSION_DE_LECTURA}
            WHERE id = ${id}`;
          return;
        }
        yield* sql`UPDATE observaciones
          SET ficha_leida_en = ${o.fichaLeidaEn}, retirada_en = ${o.retiradaEn},
            cuadro = ${cuadroDe(o.posicion)}, datos = ${datos}
          WHERE id = ${id}`;
      });

      const versionDeLosDatos = Effect.gen(function* () {
        // Un emplazamiento retirado se borra y no deja versión: cuenta la fecha de la ejecución
        // que lo retiró. Si no, una noche que solo retirase emplazamientos daría el mismo nombre
        // de capa con otro contenido.
        const [cambiado] = yield* decodificar(Maximo)(
          yield* sql`SELECT max(version) AS v FROM emplazamientos`,
        );
        const [retirado] = yield* decodificar(Maximo)(
          yield* sql`SELECT max(inicio) AS v FROM ejecuciones WHERE estado = 'completada'
            AND json_extract(cambios, '$.emplazamientos.retirados') > 0`,
        );
        // Lo aceptado en la moderación cambia la ficha de su emplazamiento, si está: cuenta la
        // fecha de la ejecución que lo trajo.
        const [aceptado] = yield* decodificar(Maximo)(
          yield* sql`SELECT max(importada_en) AS v FROM aportaciones_aceptadas
            WHERE tipo <> 'propia' AND emplazamiento IN (SELECT clave FROM emplazamientos)`,
        );
        const fechas = [cambiado?.v ?? null, retirado?.v ?? null, aceptado?.v ?? null].filter(
          (v) => v !== null,
        );
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
                    yield* guardarObservacion(previa?.id, guardar, cuenta !== undefined);
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

        colaDeFichas: Effect.fn("BaseNocturna.colaDeFichas")(function* (fuente, leidasAntesDe) {
          const filas = yield* decodificar(FilaDeCola)(
            yield* sql`SELECT id, cuadro, ficha_leida_en, ficha_fallos, ficha_espera_hasta,
                json_remove(datos, '$.bandas', '$.medidasDeExposicion') AS datos
                FROM observaciones
                WHERE fuente = ${fuente} AND retirada_en IS NULL
                  AND (ficha_leida_en IS NULL OR ficha_leida_en < ${leidasAntesDe}
                    OR ficha_leida_con < ${VERSION_DE_LECTURA})`,
          );
          return filas.map((fila): FichaEnCola => ({
            registro: registroDe(fila.datos),
            orden: fila.id,
            cuadro: fila.cuadro ?? "",
            leidaEn: fila.ficha_leida_en,
            fallos: fila.ficha_fallos,
            esperaHasta: fila.ficha_espera_hasta,
          }));
        }, Effect.orDie),

        aplicarFicha: Effect.fn("BaseNocturna.aplicarFicha")(function* (
          fuente,
          clave,
          fecha,
          leida,
        ) {
          const previa = (yield* observacionesDe(fuente, [clave])).get(clave);
          if (previa === undefined) return false;
          const { guardada, cambiada } = trasFicha(previa.datos, leida, fecha);
          yield* guardarObservacion(previa.id, guardada, true);
          return cambiada;
        }, Effect.orDie),

        fallarFicha: Effect.fn("BaseNocturna.fallarFicha")(function* (fuente, clave, fallo) {
          const { sinFichaEnRegistro } = fallo;
          yield* sql.withTransaction(
            Effect.gen(function* () {
              if (sinFichaEnRegistro !== undefined) {
                const previa = (yield* observacionesDe(fuente, [clave])).get(clave);
                if (previa !== undefined) {
                  yield* guardarObservacion(
                    previa.id,
                    trasSinFicha(previa.datos, sinFichaEnRegistro),
                  );
                }
              }
              yield* sql`UPDATE observaciones SET ficha_fallos = ${fallo.fallos},
                  ficha_espera_hasta = ${fallo.esperaHasta}, ficha_error = ${fallo.motivo}
                  WHERE fuente = ${fuente} AND clave = ${clave}`;
            }),
          );
        }, Effect.orDie),

        fusionar: Effect.fn("BaseNocturna.fusionar")(function* (fecha) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              // Por páginas, y cada una pasa a observación antes de leer la siguiente.
              const vigentes: Array<Observacion> = [];
              for (let desde = 0; ;) {
                const pagina = yield* decodificar(FilaObservacion)(
                  yield* sql`SELECT id, datos FROM observaciones
                      WHERE retirada_en IS NULL AND id > ${desde} ORDER BY id LIMIT ${PAGINA}`,
                );
                for (const fila of pagina) vigentes.push(observacionDe(fila.datos));
                const ultima = pagina.at(-1);
                if (ultima === undefined) break;
                desde = ultima.id;
              }
              const nuevos = fusionar(vigentes);
              vigentes.length = 0;
              // Los guardados en su JSON: casi todos salen iguales al codificar el nuevo, y solo
              // los que no se decodifican para compararlos.
              const guardados = new Map(
                (yield* sql<{
                  readonly clave: string;
                  readonly datos: string;
                }>`SELECT clave, datos FROM emplazamientos`).map((fila) => [
                  fila.clave,
                  fila.datos,
                ]),
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
                const datos = yield* codificarEmplazamiento(emplazamiento);
                if (
                  previo !== undefined &&
                  (previo === datos ||
                    mismoEmplazamiento(yield* decodificarEmplazamiento(previo), emplazamiento))
                ) {
                  continue;
                }
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
        const ficha = fichaDe(fila.datos, fila.version, estaciones);
        const aceptadas = yield* decodificar(FilaAceptada)(
          yield* sql`SELECT id, persona, aceptada_en, importada_en, datos
            FROM aportaciones_aceptadas WHERE emplazamiento = ${clave} AND tipo <> 'propia'`,
        );
        const correcciones = correccionesDeFilas(aceptadas).get(clave) ?? [];
        if (correcciones.length === 0) return [ficha];
        // Lo aceptado va al lado del registro, que sigue igual (ADR 0020), y la ficha cambia con la
        // noche que lo trajo.
        return [
          {
            ...ficha,
            estado: corregido(ficha.estado),
            correcciones,
            version: Math.max(ficha.version, ...aceptadas.map((a) => a.importada_en)),
          },
        ];
      });

      const datos = DatosPublicables.of({
        version: versionDeLosDatos.pipe(Effect.mapError(noDisponible)),
        // Las zonas que se han empezado a barrer alguna vez, con su último barrido completo.
        cobertura: Effect.map(base.estadoDeZonas("registro-oficial"), (estados) =>
          zonasBarridas(
            ZONAS_DE_BARRIDO.filter((zona) => estados.has(zona.nombre)),
            new Map([...estados].map(([zona, estado]) => [zona, estado.completado])),
          ),
        ),
        // Por páginas, y cada una pasa a lo que guarda la capa antes de leer la siguiente.
        emplazamientos: Effect.gen(function* () {
          const corregidos = new Set(
            correccionesDeFilas(
              yield* decodificar(FilaAceptada)(
                yield* sql`SELECT id, persona, aceptada_en, importada_en, datos
                  FROM aportaciones_aceptadas
                  WHERE emplazamiento IS NOT NULL AND tipo <> 'propia'`,
              ),
            ).keys(),
          );
          const deCapa: Array<EmplazamientoDeCapa> = [];
          for (let desde = ""; ;) {
            const pagina = yield* decodificar(FilaEmplazamiento)(
              yield* sql`SELECT clave, version, datos FROM emplazamientos
                  WHERE clave > ${desde} ORDER BY clave LIMIT ${PAGINA}`,
            );
            for (const fila of pagina) {
              const datos = corregidos.has(fila.clave)
                ? { ...fila.datos, estado: corregido(fila.datos.estado) }
                : fila.datos;
              deCapa.push(emplazamientoDeCapa(datos, datos.estaciones));
            }
            const ultima = pagina.at(-1);
            if (ultima === undefined) break;
            desde = ultima.clave;
          }
          return deCapa;
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
          const ahora = yield* Clock.currentTimeMillis;
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
                      AND (ficha_leida_en < ${leidasAntesDe}
                        OR (ficha_leida_en IS NOT NULL AND ficha_leida_con < ${VERSION_DE_LECTURA}))`),
                enEspera: yield* cuenta(sql`SELECT count(*) AS n FROM observaciones
                    WHERE fuente = ${fuente} AND retirada_en IS NULL
                      AND ficha_espera_hasta > ${ahora}`),
                primerasEnEspera: yield* decodificar(FichaEnEspera)(
                  yield* sql`SELECT clave, ficha_fallos AS fallos,
                      ficha_espera_hasta AS esperaHasta, ficha_error AS motivo
                    FROM observaciones
                    WHERE fuente = ${fuente} AND retirada_en IS NULL
                      AND ficha_espera_hasta > ${ahora}
                    ORDER BY ficha_espera_hasta, id LIMIT ${PRIMERAS_EN_ESPERA}`,
                ),
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

        ultimaAceptada: Effect.map(
          Effect.flatMap(
            sql`SELECT max(aceptada_en) AS v FROM aportaciones_aceptadas`,
            decodificar(Maximo),
          ),
          ([fila]) => fila?.v ?? null,
        ).pipe(Effect.orDie, Effect.withSpan("BaseNocturna.ultimaAceptada")),

        guardarAceptadas: Effect.fn("BaseNocturna.guardarAceptadas")(function* (aceptadas, fecha) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              let nuevas = 0;
              for (const aceptada of aceptadas) {
                const filas = yield* sql<{ readonly id: string }>`INSERT INTO aportaciones_aceptadas
                  ${sql.insert({
                    id: aceptada.id,
                    tipo: aceptada.contenido.tipo,
                    emplazamiento: emplazamientoDe(aceptada.contenido),
                    persona: aceptada.persona,
                    aceptada_en: aceptada.aceptadaEl,
                    importada_en: fecha,
                    datos: yield* codificarAportacion(aceptada.contenido),
                  })} ON CONFLICT (id) DO NOTHING RETURNING id`;
                nuevas += filas.length;
              }
              return nuevas;
            }),
          );
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
