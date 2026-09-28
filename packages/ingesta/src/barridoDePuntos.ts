import {
  type Cuadro,
  cuadroDe,
  type ZonaDeBarrido,
  ZONAS_DE_BARRIDO,
} from "@celda/dominio/barrido";
import type { Fuente } from "@celda/dominio/observacion";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { BaseDeBarrido, type Barrida, type ZonaEnLaEjecucion } from "./barrido.ts";
import { type Cuentas, SIN_CAMBIOS } from "./ejecucion.ts";
import {
  describirError,
  ExtractorDePuntos,
  type ObservacionDePunto,
  type Punto,
} from "./extractor.ts";

/** Qué hace cada noche una fuente que lista puntos, como antenasmoviles.es (#48). */
export interface OpcionesPuntos {
  /** Las zonas de barrido cuyos puntos se guardan. El listado es de toda España. */
  readonly zonas: ReadonlyArray<ZonaDeBarrido>;
  /** Detalles que se leen como mucho en una noche. */
  readonly maxDetalles: number;
  /** Fallos seguidos de detalles tras los que se dejan para la noche siguiente. */
  readonly fallosSeguidos: number;
}

/**
 * Por defecto: Cataluña y 100 detalles por noche, que a una petición cada 5 s son unos 8 minutos.
 * Las ER5 de Cataluña se leen la primera vez en unas pocas noches; las de toda España, 7.285, en
 * unas 73 (investigación 08, apartado 5).
 */
export const OPCIONES_PUNTOS: OpcionesPuntos = {
  zonas: ZONAS_DE_BARRIDO.filter((zona) => zona.nombre === "cataluna"),
  maxDetalles: 100,
  fallosSeguidos: 3,
};

/** Lo que cambia al guardar los puntos de una zona. */
export interface PuntosAplicados {
  /** El barrido de la zona, abierto hasta que se cierra o falla. */
  readonly barrido: string;
  readonly creados: number;
  readonly cambiados: number;
  /** Observaciones retiradas porque su punto ha dejado de ser una ER5. */
  readonly observacionesRetiradas: number;
}

/** Lo que retira el cierre del barrido de una zona. */
export interface PuntosRetirados {
  readonly puntos: number;
  readonly observaciones: number;
}

/**
 * Donde guarda su estado una fuente que lista puntos: sus puntos, con la huella de su fila y su
 * zona de barrido, y las observaciones que salen de sus detalles. La implementa la base SQLite de
 * la ingesta nocturna. Las ejecuciones, la fusión y los barridos de cada zona son los de
 * `BaseDeBarrido`.
 */
export class BaseDePuntos extends Context.Service<
  BaseDePuntos,
  {
    /** Puntos vigentes de la fuente en unos cuadros. */
    readonly vigentesEn: (fuente: Fuente, cuadros: ReadonlyArray<Cuadro>) => Effect.Effect<number>;
    /**
     * En una transacción: abre un barrido de la zona para la ejecución, guarda sus puntos y los da
     * por vistos. Un punto nuevo, o con otra huella, queda pendiente de leer su detalle; uno sin
     * cambios no se escribe. Un punto que deja de ser ER5 pierde sus observaciones: el detalle de
     * un punto que copia el registro no se lee.
     */
    readonly aplicarZona: (
      ejecucion: string,
      fuente: Fuente,
      zona: ZonaDeBarrido,
      fecha: number,
      puntos: ReadonlyArray<Punto>,
    ) => Effect.Effect<PuntosAplicados>;
    /**
     * Cierra el barrido de una zona: cuenta una ausencia a los puntos vigentes de sus cuadros que
     * no se han visto desde que empezó. Al segundo barrido seguido sin verlo, el punto se retira
     * con sus observaciones.
     */
    readonly cerrarZona: (
      barrido: string,
      fecha: number,
      fin: number,
    ) => Effect.Effect<PuntosRetirados>;
    /** Apunta el barrido fallido de una zona, que no cuenta ausencias. */
    readonly fallarZona: (
      ejecucion: string,
      fuente: Fuente,
      zona: ZonaDeBarrido,
      fecha: number,
      motivo: string,
    ) => Effect.Effect<void>;
    /**
     * Las ER5 vigentes de unos cuadros cuyo detalle no se ha leído, porque son nuevas o han
     * cambiado: primero las que no dicen su compañía, y dentro de cada prioridad, en el orden en que
     * se guardaron.
     */
    readonly pendientesDeDetalle: (
      fuente: Fuente,
      cuadros: ReadonlyArray<Cuadro>,
      limite: number,
    ) => Effect.Effect<ReadonlyArray<Punto>>;
    /**
     * Guarda lo que dice el detalle de un punto: crea o cambia sus observaciones, retira las que ya
     * no salen y apunta cuándo se leyó. Una observación igual a la guardada no se escribe.
     */
    readonly aplicarDetalle: (
      fuente: Fuente,
      punto: string,
      fecha: number,
      observaciones: ReadonlyArray<ObservacionDePunto>,
    ) => Effect.Effect<Cuentas>;
  }
>()("@celda/ingesta/barridoDePuntos/BaseDePuntos") {}

/** Errores tras los que no tiene sentido pedir más detalles a la fuente esta noche. */
const PARAN_LOS_DETALLES: ReadonlySet<string> = new Set([
  "LimiteDePeticiones",
  "FuenteNoDisponible",
  "ProhibidoPorRobots",
]);

const SIN_CUENTAS: Cuentas = { creados: 0, cambiados: 0, retirados: 0 };

/** Lo que va haciendo una zona en la ejecución. */
interface ZonaEnCurso {
  readonly zona: ZonaDeBarrido;
  readonly puntos: Array<Punto>;
  estado: ZonaEnLaEjecucion["estado"];
  error: string | undefined;
  barrido: string | undefined;
  peticiones: number;
  readonly observaciones: { creados: number; cambiados: number; retirados: number };
}

const zonaHecha = (z: ZonaEnCurso): ZonaEnLaEjecucion => {
  const hecha: ZonaEnLaEjecucion = {
    zona: z.zona.nombre,
    estado: z.estado,
    cuadros: z.zona.cuadros.length,
    peticiones: z.peticiones,
    bytes: 0,
    registros: z.puntos.length,
    observaciones: { ...z.observaciones },
  };
  return z.error === undefined ? hecha : { ...hecha, error: z.error };
};

/**
 * Guarda los puntos de cada zona y cierra los barridos de las que se han guardado. Una zona sin
 * ningún punto cuando la base tiene puntos vigentes en ella falla y no cuenta ausencias. Los
 * barridos se cierran cuando ya se han guardado todas: un punto que se ha movido a otra zona ya
 * está visto allí. Devuelve los puntos creados, cambiados y retirados.
 */
const guardarZonas = Effect.fn("BarridoDePuntos.zonas")(function* (
  ejecucion: string,
  fuente: Fuente,
  zonas: ReadonlyArray<ZonaEnCurso>,
  inicio: number,
  errores: Array<string>,
) {
  const puntos = yield* BaseDePuntos;
  const cuentas = { ...SIN_CUENTAS };
  for (const z of zonas) {
    const vigentes = z.puntos.length === 0 ? yield* puntos.vigentesEn(fuente, z.zona.cuadros) : 0;
    if (vigentes > 0) {
      z.estado = "fallido";
      z.error = `ZonaVacia: el listado no trae ningún punto de la zona y la base tiene ${vigentes} vigentes en ella`;
      errores.push(`Zona ${z.zona.nombre}: ${z.error}`);
      yield* puntos.fallarZona(ejecucion, fuente, z.zona, inicio, z.error);
      continue;
    }
    const aplicados = yield* puntos.aplicarZona(ejecucion, fuente, z.zona, inicio, z.puntos);
    z.barrido = aplicados.barrido;
    z.observaciones.retirados += aplicados.observacionesRetiradas;
    cuentas.creados += aplicados.creados;
    cuentas.cambiados += aplicados.cambiados;
  }
  for (const z of zonas) {
    if (z.barrido === undefined) continue;
    const retirados = yield* puntos.cerrarZona(z.barrido, inicio, yield* Clock.currentTimeMillis);
    z.estado = "completado";
    cuentas.retirados += retirados.puntos;
    z.observaciones.retirados += retirados.observaciones;
  }
  return cuentas;
});

/** Lo que necesita `leerDetalles` de la ejecución. */
interface LecturaDeDetalles {
  readonly inicio: number;
  /** La zona de cada cuadro, para apuntarle sus peticiones y sus cambios. */
  readonly deCuadro: ReadonlyMap<Cuadro, ZonaEnCurso>;
  readonly errores: Array<string>;
  readonly fallosSeguidos: number;
}

/**
 * Lee el detalle de los puntos pendientes uno a uno y guarda sus observaciones. Tras
 * `fallosSeguidos` fallos seguidos, un 403, el tope de peticiones o `robots.txt`, deja los demás
 * para la próxima ejecución. Devuelve los detalles leídos y cuántos han cambiado algo.
 */
const leerDetalles = Effect.fn("BarridoDePuntos.detalles")(function* (
  pendientes: ReadonlyArray<Punto>,
  lectura: LecturaDeDetalles,
) {
  const extractor = yield* ExtractorDePuntos;
  const puntos = yield* BaseDePuntos;
  const detalles = { leidas: 0, cambiadas: 0 };
  let fallos = 0;
  for (const punto of pendientes) {
    const z = lectura.deCuadro.get(cuadroDe(punto.posicion));
    if (z !== undefined) z.peticiones++;
    const detalle = yield* Effect.result(extractor.detalle(punto));
    if (Result.isFailure(detalle)) {
      lectura.errores.push(describirError(detalle.failure));
      fallos++;
      if (fallos >= lectura.fallosSeguidos || PARAN_LOS_DETALLES.has(detalle.failure._tag)) {
        lectura.errores.push("Detalles pendientes para la próxima ejecución");
        break;
      }
      continue;
    }
    fallos = 0;
    lectura.errores.push(...detalle.success.avisos);
    const escritos = yield* puntos.aplicarDetalle(
      extractor.fuente,
      punto.clave,
      lectura.inicio,
      detalle.success.observaciones,
    );
    if (z !== undefined) {
      z.observaciones.creados += escritos.creados;
      z.observaciones.cambiados += escritos.cambiados;
      z.observaciones.retirados += escritos.retirados;
    }
    detalles.leidas++;
    detalles.cambiadas += escritos.creados + escritos.cambiados + escritos.retirados > 0 ? 1 : 0;
  }
  return detalles;
});

/**
 * Una ejecución de una fuente que lista puntos por zonas de barrido (ADR 0014 y #48), sobre la
 * `BaseDeBarrido` y la `BaseDePuntos`:
 *
 * 1. Abre la ejecución. Si el interruptor está apagado queda omitida y no pide nada.
 * 2. Lee el listado una vez; el extractor ya lo filtra a los cuadros de las zonas. Si falla, o si
 *    la fuente devuelve un 403 o una página HTML, la ejecución queda fallida sin tocar los datos:
 *    es la fuente bloqueando a Celda, no unas zonas vacías.
 * 3. Guarda los puntos de cada zona en su transacción. Una zona sin ningún punto cuando la base
 *    tiene puntos vigentes en ella falla y no cuenta ausencias; las demás siguen.
 * 4. Cierra los barridos de las zonas guardadas: un punto que falta en dos barridos seguidos de su
 *    zona se retira con sus observaciones.
 * 5. Lee el detalle de las ER5 pendientes, nuevas o cambiadas, `maxDetalles` como mucho. Los puntos
 *    que copian el registro no se leen, y no hay repaso de los ya leídos. Un 403, el tope de
 *    peticiones o `robots.txt` dejan el resto para la noche siguiente.
 * 6. Vuelve a fusionar y apunta los cambios, los errores y lo que ha hecho cada zona.
 *
 * Cada paso es idempotente: una noche cortada se repite sin más, y los detalles pendientes siguen
 * pendientes. Los datos llevan la fecha de inicio de la ejecución.
 */
export const ejecutarBarridoDePuntos = Effect.fn("Ingesta.barridoDePuntos")(function* (
  opciones: OpcionesPuntos,
) {
  const extractor = yield* ExtractorDePuntos;
  const base = yield* BaseDeBarrido;
  const puntos = yield* BaseDePuntos;
  const { fuente } = extractor;
  const inicio = yield* Clock.currentTimeMillis;

  const arranque = yield* base.iniciar(fuente, inicio);
  const { ejecucion } = arranque;
  if (arranque.tipo === "omitida") {
    const omitida: Barrida = { ejecucion, estado: "omitida", zonas: [] };
    return omitida;
  }

  const zonas: ReadonlyArray<ZonaEnCurso> = opciones.zonas.map((zona) => ({
    zona,
    puntos: [],
    estado: "pendiente",
    error: undefined,
    barrido: undefined,
    peticiones: 0,
    observaciones: { ...SIN_CUENTAS },
  }));
  const deCuadro = new Map<Cuadro, ZonaEnCurso>(
    zonas.flatMap((z) => z.zona.cuadros.map((cuadro): [Cuadro, ZonaEnCurso] => [cuadro, z])),
  );
  const errores: Array<string> = [];

  // Sin zonas no hay nada que leer: la ejecución no pide nada a la fuente.
  const listado =
    zonas.length === 0
      ? Result.succeed({ puntos: [], avisos: [] })
      : yield* Effect.result(extractor.puntos);
  if (Result.isFailure(listado)) {
    const motivo = describirError(listado.failure);
    for (const z of zonas) {
      z.estado = "fallido";
      z.error = motivo;
      yield* puntos.fallarZona(ejecucion, fuente, z.zona, inicio, motivo);
    }
    yield* base.fallar(ejecucion, {
      fin: yield* Clock.currentTimeMillis,
      cambios: SIN_CAMBIOS,
      errores: [motivo],
      zonas: zonas.map(zonaHecha),
    });
    const fallida: Barrida = { ejecucion, estado: "fallida", zonas: zonas.map(zonaHecha) };
    return fallida;
  }
  errores.push(...listado.success.avisos);
  for (const punto of listado.success.puntos) {
    deCuadro.get(cuadroDe(punto.posicion))?.puntos.push(punto);
  }

  const cuentasPuntos = yield* guardarZonas(ejecucion, fuente, zonas, inicio, errores);
  const barridas = zonas.filter((z) => z.estado === "completado");
  const detalles = yield* leerDetalles(
    yield* puntos.pendientesDeDetalle(
      fuente,
      barridas.flatMap((z) => z.zona.cuadros),
      opciones.maxDetalles,
    ),
    { inicio, deCuadro, errores, fallosSeguidos: opciones.fallosSeguidos },
  );

  const emplazamientos = yield* base.fusionar(inicio);
  const sumar = (campo: keyof Cuentas) =>
    zonas.reduce((suma, z) => suma + z.observaciones[campo], 0);
  const hechas = zonas.map(zonaHecha);
  const cierre = {
    fin: yield* Clock.currentTimeMillis,
    cambios: {
      observaciones: {
        creados: sumar("creados"),
        cambiados: sumar("cambiados"),
        retirados: sumar("retirados"),
      },
      fichas: detalles,
      emplazamientos,
      puntos: cuentasPuntos,
    },
    errores,
    zonas: hechas,
  };
  const barrida = zonas.length === 0 || barridas.length > 0;
  if (barrida) {
    yield* base.completar(ejecucion, {
      ...cierre,
      registros: barridas.reduce((suma, z) => suma + z.puntos.length, 0),
    });
  } else {
    yield* base.fallar(ejecucion, cierre);
  }
  const hecha: Barrida = { ejecucion, estado: barrida ? "completada" : "fallida", zonas: hechas };
  return hecha;
});
