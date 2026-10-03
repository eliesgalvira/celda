import type { Emplazamiento } from "@celda/dominio/emplazamiento";
import { fusionar } from "@celda/dominio/fusion";
import { Fuente, type Observacion } from "@celda/dominio/observacion";
import * as Proceso from "@celda/ingesta/proceso";
import { BaseDeIngesta, type OpcionesProceso } from "@celda/ingesta/proceso";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import refs from "../confect/_generated/refs";
import { Id } from "../confect/_generated/id";
import { publicarTrasLaIngesta } from "./publicacion";

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

/** El identificador de una ejecución que devuelve `BaseDeIngesta.iniciar`. */
const decodificarEjecucion = Schema.decodeUnknownEffect(Id("ejecuciones"));

/**
 * La `BaseDeIngesta` sobre las tablas de Convex, con sus funciones internas. Cada llamada es una
 * mutación o una consulta, así que el proceso se prueba igual en memoria que en el backend real.
 */
export const baseEnConvex = Effect.gen(function* () {
  const mutacion = yield* MutationRunner.MutationRunner;
  const consulta = yield* QueryRunner.QueryRunner;
  const contexto = yield* Effect.context<MutationRunner.MutationRunner | QueryRunner.QueryRunner>();
  const ejecucion = (id: string) => Effect.orDie(decodificarEjecucion(id));
  return BaseDeIngesta.of({
    iniciar: (fuente, fecha) =>
      Effect.orDie(mutacion(refs.internal.ingesta.iniciar, { fuente, fecha })),
    aplicarListado: (fuente, fecha, registros) =>
      Effect.orDie(mutacion(refs.internal.ingesta.aplicarListado, { fuente, fecha, registros })),
    pendientesDeFicha: (fuente, leidasAntesDe, limite) =>
      Effect.orDie(
        consulta(refs.internal.ingesta.pendientesDeFicha, { fuente, leidasAntesDe, limite }),
      ),
    aplicarFicha: (fuente, clave, fecha, bandas) =>
      Effect.orDie(mutacion(refs.internal.ingesta.aplicarFicha, { fuente, clave, fecha, bandas })),
    cerrarBarrido: (id, vistas) =>
      Effect.flatMap(ejecucion(id), (ejecucion) =>
        Effect.orDie(mutacion(refs.internal.ingesta.cerrarBarrido, { ejecucion, vistas })),
      ),
    fusionar: (fecha) => fusionarTodo(fecha).pipe(Effect.provideContext(contexto)),
    completar: (id, cierre) =>
      Effect.flatMap(ejecucion(id), (ejecucion) =>
        Effect.orDie(mutacion(refs.internal.ingesta.completar, { ejecucion, ...cierre })),
      ),
    fallar: (id, cierre) =>
      Effect.flatMap(ejecucion(id), (ejecucion) =>
        Effect.orDie(mutacion(refs.internal.ingesta.fallar, { ejecucion, ...cierre })),
      ),
  });
});

/**
 * Una ejecución de ingesta de la fuente del `Extractor` sobre Convex (`ejecutarIngesta` de
 * `@celda/ingesta/proceso`). Al acabar una completada publica la capa y las fichas de la
 * instantánea nueva. Sin cambios no escribe nada, y un fallo al publicar no deshace la
 * ejecución: la siguiente lo vuelve a intentar.
 */
export const ejecutarIngesta = Effect.fn("Ingesta.ejecutarEnConvex")(function* (
  opciones: OpcionesProceso,
) {
  const consulta = yield* QueryRunner.QueryRunner;
  const { ejecucion, estado } = yield* Proceso.ejecutarIngesta(opciones).pipe(
    Effect.provideService(BaseDeIngesta, yield* baseEnConvex),
  );
  if (estado === "completada") {
    yield* publicarTrasLaIngesta;
  }
  return yield* consulta(refs.internal.ingesta.ejecucion, {
    id: yield* decodificarEjecucion(ejecucion),
  });
}, Effect.orDie);
