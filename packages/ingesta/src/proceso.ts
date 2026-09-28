import type { Banda } from "@celda/dominio/banda";
import type { Fuente } from "@celda/dominio/observacion";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { type Cambios, type Cuentas, SIN_CAMBIOS } from "./ejecucion.ts";
import { describirError, type ErrorDeExtractor, Extractor, type Registro } from "./extractor.ts";

/** Cuánto hace cada ejecución, aparte del extractor. */
export interface OpcionesProceso {
  /** Fichas que se leen como mucho en una ejecución. */
  readonly maxFichas: number;
  /** Una ficha leída hace más que esto se vuelve a leer. */
  readonly rotacion: Duration.Duration;
  /** Registros por escritura al guardar el listado. */
  readonly lote: number;
  /** Fallos seguidos de fichas tras los que se dejan para la próxima ejecución. */
  readonly fallosSeguidos: number;
}

/**
 * Por defecto: unas 250 fichas por noche, así que las ~2400 de la caja de Barcelona se leen
 * en diez noches (investigación del registro oficial, apartado 6).
 */
export const OPCIONES_PROCESO: OpcionesProceso = {
  maxFichas: 250,
  rotacion: Duration.days(14),
  lote: 200,
  fallosSeguidos: 3,
};

export const opcionesProcesoDesdeConfig: Config.Config<OpcionesProceso> = Config.Int(
  "CELDA_INGESTA_MAX_FICHAS",
).pipe(
  Config.withDefault(OPCIONES_PROCESO.maxFichas),
  Config.map((maxFichas) => ({ ...OPCIONES_PROCESO, maxFichas })),
);

/** Cómo empieza una ejecución: omitida si el interruptor de su fuente está apagado. */
export interface Arranque {
  readonly tipo: "omitida" | "iniciada";
  /** Identificador de la ejecución en la base. */
  readonly ejecucion: string;
}

/** Lo que se apunta al cerrar una ejecución. */
export interface Cierre {
  /** Fin de la ejecución. Los datos llevan la fecha de su inicio. */
  readonly fin: number;
  readonly cambios: Cambios;
  readonly errores: ReadonlyArray<string>;
}

/**
 * Donde guarda la ingesta su estado entre ejecuciones: las observaciones de cada fuente, los
 * emplazamientos fusionados y el registro de ejecuciones. Hay dos: las tablas de Convex y la
 * base SQLite de la ingesta nocturna (ADR 0015). Cada operación es idempotente, así que una
 * ejecución cortada se repite sin más.
 */
export class BaseDeIngesta extends Context.Service<
  BaseDeIngesta,
  {
    /**
     * Abre una ejecución de `fuente`. Las que seguían en curso de esa fuente quedan
     * interrumpidas. Con el interruptor apagado, queda omitida con el motivo en sus errores.
     */
    readonly iniciar: (fuente: Fuente, fecha: number) => Effect.Effect<Arranque>;
    /** Guarda unos registros del listado (`trasListado`) y cuenta los creados y cambiados. */
    readonly aplicarListado: (
      fuente: Fuente,
      fecha: number,
      registros: ReadonlyArray<Registro>,
    ) => Effect.Effect<{ readonly creados: number; readonly cambiados: number }>;
    /**
     * Las observaciones vigentes cuya ficha toca leer: primero las pendientes, en el orden en que
     * se crearon, y luego las leídas antes de `leidasAntesDe`, de la más antigua a la más nueva.
     */
    readonly pendientesDeFicha: (
      fuente: Fuente,
      leidasAntesDe: number,
      limite: number,
    ) => Effect.Effect<ReadonlyArray<Registro>>;
    /** Guarda las bandas de una ficha (`trasFicha`); `true` si han cambiado. */
    readonly aplicarFicha: (
      fuente: Fuente,
      clave: string,
      fecha: number,
      bandas: ReadonlyArray<Banda>,
    ) => Effect.Effect<boolean>;
    /**
     * Cuenta una ausencia (`trasAusencia`) a las observaciones de la fuente de la ejecución que no
     * están en `vistas`. No hace nada si la ejecución ya no está en curso.
     */
    readonly cerrarBarrido: (
      ejecucion: string,
      vistas: ReadonlyArray<string>,
    ) => Effect.Effect<{ readonly retirados: number }>;
    /**
     * Vuelve a fusionar las observaciones vigentes de todas las fuentes y guarda solo los
     * emplazamientos que cambian, con `fecha` como versión.
     */
    readonly fusionar: (fecha: number) => Effect.Effect<Cuentas>;
    readonly completar: (
      ejecucion: string,
      cierre: Cierre & { readonly registros: number },
    ) => Effect.Effect<void>;
    readonly fallar: (ejecucion: string, cierre: Cierre) => Effect.Effect<void>;
  }
>()("@celda/ingesta/proceso/BaseDeIngesta") {}

/** Cómo ha acabado una ejecución. */
export interface Ejecutada {
  readonly ejecucion: string;
  readonly estado: "omitida" | "fallida" | "completada";
}

const trozos = <A>(elementos: ReadonlyArray<A>, tamano: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(elementos.length / tamano) }, (_, i) =>
    elementos.slice(i * tamano, (i + 1) * tamano),
  );

/** Lo que necesita `leerFichas`. */
export interface LecturaDeFichas {
  /** Los registros cuya ficha toca leer, en orden. */
  readonly pendientes: ReadonlyArray<Registro>;
  readonly ficha: (registro: Registro) => Effect.Effect<ReadonlyArray<Banda>, ErrorDeExtractor>;
  /** Guarda las bandas de una ficha; `true` si han cambiado. */
  readonly aplicar: (clave: string, bandas: ReadonlyArray<Banda>) => Effect.Effect<boolean>;
  readonly fallosSeguidos: number;
}

/** Lo que ha hecho `leerFichas`. */
export interface FichasLeidas {
  readonly leidas: number;
  readonly cambiadas: number;
  readonly errores: ReadonlyArray<string>;
}

/**
 * Lee las fichas pendientes una a una y guarda sus bandas. Tras `fallosSeguidos` fallos
 * seguidos, o al gastar el tope de peticiones, deja las demás para la próxima ejecución.
 */
export const leerFichas = Effect.fn("Ingesta.leerFichas")(function* (lectura: LecturaDeFichas) {
  const errores: Array<string> = [];
  let leidas = 0;
  let cambiadas = 0;
  let fallos = 0;
  for (const registro of lectura.pendientes) {
    const bandas = yield* Effect.result(lectura.ficha(registro));
    if (Result.isFailure(bandas)) {
      errores.push(describirError(bandas.failure));
      fallos++;
      if (fallos >= lectura.fallosSeguidos || bandas.failure._tag === "LimiteDePeticiones") {
        errores.push("Fichas pendientes para la próxima ejecución");
        break;
      }
      continue;
    }
    fallos = 0;
    const cambiada = yield* lectura.aplicar(registro.clave, bandas.success);
    leidas++;
    cambiadas += cambiada ? 1 : 0;
  }
  const hecho: FichasLeidas = { leidas, cambiadas, errores };
  return hecho;
});

/**
 * Una ejecución de ingesta de la fuente del `Extractor`, sobre la `BaseDeIngesta`:
 *
 * 1. Abre la ejecución. Si el interruptor está apagado queda omitida y no pide nada.
 * 2. Recorre el listado. Si falla, la ejecución queda fallida sin tocar los datos, porque sin
 *    el listado completo no se sabe qué ha desaparecido.
 * 3. Guarda el listado por lotes: solo escribe las observaciones nuevas o cambiadas.
 * 4. Lee las fichas pendientes (nuevas, cambiadas o de hace más de `rotacion`).
 * 5. Cierra el barrido: cuenta una ausencia a lo que no ha traído el listado.
 * 6. Vuelve a fusionar y apunta los cambios y los errores.
 *
 * No publica: eso lo decide quien la lanza. Los pasos son idempotentes, así que repetir una
 * ejecución cortada deja lo mismo que una completa. Todos los datos llevan la fecha de inicio de
 * la ejecución.
 */
export const ejecutarIngesta = Effect.fn("Ingesta.ejecutar")(function* (opciones: OpcionesProceso) {
  const extractor = yield* Extractor;
  const base = yield* BaseDeIngesta;
  const { fuente } = extractor;
  const inicio = yield* Clock.currentTimeMillis;

  const arranque = yield* base.iniciar(fuente, inicio);
  const { ejecucion } = arranque;
  if (arranque.tipo === "omitida") {
    return { ejecucion, estado: "omitida" } satisfies Ejecutada;
  }

  const listado = yield* Effect.result(extractor.listado);
  if (Result.isFailure(listado)) {
    yield* base.fallar(ejecucion, {
      fin: yield* Clock.currentTimeMillis,
      cambios: SIN_CAMBIOS,
      errores: [describirError(listado.failure)],
    });
    return { ejecucion, estado: "fallida" } satisfies Ejecutada;
  }
  const { registros, avisos } = listado.success;

  const observaciones = { creados: 0, cambiados: 0 };
  for (const lote of trozos(registros, opciones.lote)) {
    const escritos = yield* base.aplicarListado(fuente, inicio, lote);
    observaciones.creados += escritos.creados;
    observaciones.cambiados += escritos.cambiados;
  }

  const leidas = yield* leerFichas({
    pendientes: yield* base.pendientesDeFicha(
      fuente,
      inicio - Duration.toMillis(opciones.rotacion),
      opciones.maxFichas,
    ),
    ficha: extractor.ficha,
    aplicar: (clave, bandas) => base.aplicarFicha(fuente, clave, inicio, bandas),
    fallosSeguidos: opciones.fallosSeguidos,
  });
  const errores = [...avisos, ...leidas.errores];
  const fichas = { leidas: leidas.leidas, cambiadas: leidas.cambiadas };

  const { retirados } = yield* base.cerrarBarrido(
    ejecucion,
    registros.map((r) => r.clave),
  );
  const emplazamientos = yield* base.fusionar(inicio);
  yield* base.completar(ejecucion, {
    fin: yield* Clock.currentTimeMillis,
    registros: registros.length,
    cambios: { observaciones: { ...observaciones, retirados }, fichas, emplazamientos },
    errores,
  });
  return { ejecucion, estado: "completada" } satisfies Ejecutada;
});
