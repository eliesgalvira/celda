import type { Emplazamiento } from "@celda/dominio/emplazamiento";
import { fusionar } from "@celda/dominio/fusion";
import { Fuente, type Observacion } from "@celda/dominio/observacion";
import { describirError, Extractor } from "@celda/ingesta/extractor";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import refs from "../confect/_generated/refs";
import { SIN_CAMBIOS } from "../confect/tables/ejecuciones";

/** Cuánto hace cada ejecución, aparte del extractor. */
export interface OpcionesProceso {
  /** Fichas que se leen como mucho en una ejecución. */
  readonly maxFichas: number;
  /** Una ficha leída hace más que esto se vuelve a leer. */
  readonly rotacion: Duration.Duration;
  /** Registros por mutación al guardar el listado. */
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

/** Documentos por página al leer, lejos del límite de 4096 lecturas por función de Convex. */
const PAGINA = 1000;
/** Emplazamientos por mutación al escribir la fusión. */
const LOTE_FUSION = 100;

/** Una página leída por clave. */
interface Pagina<A> {
  readonly elementos: ReadonlyArray<A>;
  readonly ultima: string | null;
}

const trozos = <A>(elementos: ReadonlyArray<A>, tamano: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(elementos.length / tamano) }, (_, i) =>
    elementos.slice(i * tamano, (i + 1) * tamano),
  );

/**
 * Vuelve a fusionar todas las observaciones vigentes de todas las fuentes y escribe solo los
 * emplazamientos y estaciones base que cambian, con `version` igual a `fecha`. Lee por páginas
 * y escribe por lotes; cada lote es idempotente, así que se puede repetir si se corta.
 */
export const fusionarTodo = Effect.fn("Ingesta.fusionarTodo")(function* (fecha: number) {
  const mutacion = yield* MutationRunner.MutationRunner;
  const consulta = yield* QueryRunner.QueryRunner;

  const observaciones: Array<Observacion> = [];
  for (const fuente of Fuente.literals) {
    let despuesDe: string | null = null;
    do {
      const pagina: Pagina<Observacion> = yield* consulta(
        refs.internal.ingesta.observacionesVigentes,
        {
          fuente,
          despuesDe,
          limite: PAGINA,
        },
      );
      observaciones.push(...pagina.elementos);
      despuesDe = pagina.ultima;
    } while (despuesDe !== null);
  }
  const emplazamientos: ReadonlyArray<Emplazamiento> = fusionar(observaciones);
  const nuevas = new Set(emplazamientos.map((e) => e.clave));

  const sobrantes: Array<string> = [];
  let despuesDe: string | null = null;
  do {
    const pagina: Pagina<string> = yield* consulta(refs.internal.ingesta.clavesDeEmplazamientos, {
      despuesDe,
      limite: PAGINA,
    });
    sobrantes.push(...pagina.elementos.filter((clave) => !nuevas.has(clave)));
    despuesDe = pagina.ultima;
  } while (despuesDe !== null);

  const cuentas = { creados: 0, cambiados: 0, retirados: 0 };
  for (const claves of trozos(sobrantes, LOTE_FUSION)) {
    const { retirados } = yield* mutacion(refs.internal.ingesta.retirarEmplazamientos, { claves });
    cuentas.retirados += retirados;
  }
  for (const lote of trozos(emplazamientos, LOTE_FUSION)) {
    const escritos = yield* mutacion(refs.internal.ingesta.escribirEmplazamientos, {
      fecha,
      emplazamientos: lote,
    });
    cuentas.creados += escritos.creados;
    cuentas.cambiados += escritos.cambiados;
  }
  return cuentas;
}, Effect.orDie);

/**
 * Una ejecución de ingesta de la fuente del `Extractor`:
 *
 * 1. Abre la ejecución. Si el interruptor está apagado queda omitida y no pide nada.
 * 2. Recorre el listado. Si falla, la ejecución queda fallida sin tocar los datos, porque sin
 *    el listado completo no se sabe qué ha desaparecido.
 * 3. Guarda el listado por lotes: solo escribe las observaciones nuevas o cambiadas.
 * 4. Lee las fichas pendientes (nuevas, cambiadas o de hace más de `rotacion`).
 * 5. Cierra el barrido: cuenta una ausencia a lo que no ha traído el listado.
 * 6. Vuelve a fusionar y apunta los cambios y los errores.
 *
 * Los pasos son idempotentes, así que repetir una ejecución cortada deja lo mismo que una
 * completa. Todos los datos llevan la fecha de inicio de la ejecución.
 */
export const ejecutarIngesta = Effect.fn("Ingesta.ejecutar")(function* (opciones: OpcionesProceso) {
  const extractor = yield* Extractor;
  const mutacion = yield* MutationRunner.MutationRunner;
  const consulta = yield* QueryRunner.QueryRunner;
  const { fuente } = extractor;
  const inicio = yield* Clock.currentTimeMillis;

  const arranque = yield* mutacion(refs.internal.ingesta.iniciar, { fuente, fecha: inicio });
  const { ejecucion } = arranque;
  if (arranque.tipo === "omitida") {
    return yield* consulta(refs.internal.ingesta.ejecucion, { id: ejecucion });
  }

  const listado = yield* Effect.result(extractor.listado());
  if (Result.isFailure(listado)) {
    yield* mutacion(refs.internal.ingesta.fallar, {
      ejecucion,
      fin: yield* Clock.currentTimeMillis,
      cambios: SIN_CAMBIOS,
      errores: [describirError(listado.failure)],
    });
    return yield* consulta(refs.internal.ingesta.ejecucion, { id: ejecucion });
  }
  const { registros, avisos } = listado.success;

  const observaciones = { creados: 0, cambiados: 0 };
  const fichas = { leidas: 0, cambiadas: 0 };
  for (const lote of trozos(registros, opciones.lote)) {
    const escritos = yield* mutacion(refs.internal.ingesta.aplicarListado, {
      fuente,
      fecha: inicio,
      registros: lote,
    });
    observaciones.creados += escritos.creados;
    observaciones.cambiados += escritos.cambiados;
  }

  const pendientes = yield* consulta(refs.internal.ingesta.pendientesDeFicha, {
    fuente,
    leidasAntesDe: inicio - Duration.toMillis(opciones.rotacion),
    limite: opciones.maxFichas,
  });
  const errores: Array<string> = [...avisos];
  let fallos = 0;
  for (const registro of pendientes) {
    const bandas = yield* Effect.result(extractor.ficha(registro));
    if (Result.isFailure(bandas)) {
      errores.push(describirError(bandas.failure));
      fallos++;
      if (fallos >= opciones.fallosSeguidos || bandas.failure._tag === "LimiteDePeticiones") {
        errores.push("Fichas pendientes para la próxima ejecución");
        break;
      }
      continue;
    }
    fallos = 0;
    const cambiada = yield* mutacion(refs.internal.ingesta.aplicarFicha, {
      fuente,
      clave: registro.clave,
      fecha: inicio,
      bandas: bandas.success,
    });
    fichas.leidas++;
    fichas.cambiadas += cambiada ? 1 : 0;
  }

  const { retirados } = yield* mutacion(refs.internal.ingesta.cerrarBarrido, {
    ejecucion,
    vistas: registros.map((r) => r.clave),
  });
  const emplazamientos = yield* fusionarTodo(inicio);
  yield* mutacion(refs.internal.ingesta.completar, {
    ejecucion,
    fin: yield* Clock.currentTimeMillis,
    registros: registros.length,
    cambios: { observaciones: { ...observaciones, retirados }, fichas, emplazamientos },
    errores,
  });
  return yield* consulta(refs.internal.ingesta.ejecucion, { id: ejecucion });
}, Effect.orDie);
