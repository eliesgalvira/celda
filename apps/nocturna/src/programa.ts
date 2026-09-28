import type { Fuente } from "@celda/dominio/observacion";
import {
  ejecutarBarrido,
  type OpcionesBarrido,
  type ZonaEnLaEjecucion,
} from "@celda/ingesta/barrido";
import { ejecutarBarridoDePuntos, type OpcionesPuntos } from "@celda/ingesta/barridoDePuntos";
import type { ExtractorDePuntos, ExtractorPorCajas } from "@celda/ingesta/extractor";
import type { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import {
  DatosPublicables,
  describirFallo,
  type FalloPublicacion,
  publicar,
  type ResultadoPublicacion,
} from "@celda/publicacion/publicar";
import type { ZonasDePublicacion } from "@celda/publicacion/zonas";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { BaseNocturna } from "./base.ts";
import { describirResumen } from "./estado.ts";

/**
 * Los extractores de la noche, uno por fuente que ya tiene extractor. Cada ejecución construye el
 * suyo desde su capa, así que su tope de peticiones cuenta desde el principio de la ejecución.
 */
export class Extractores extends Context.Service<
  Extractores,
  {
    readonly registroOficial: Layer.Layer<ExtractorPorCajas>;
    readonly antenasMoviles: Layer.Layer<ExtractorDePuntos>;
  }
>()("@celda/nocturna/programa/Extractores") {}

/** Un intento de publicar, y si merece la pena repetirlo al cabo de un rato. */
export interface Intento {
  readonly resultado: ResultadoPublicacion;
  readonly reintentar: boolean;
}

/** Publica la base en el almacén de la configuración, o no hace nada si no hay almacén. */
export class Publicador extends Context.Service<
  Publicador,
  { readonly publicar: Effect.Effect<Intento> }
>()("@celda/nocturna/programa/Publicador") {}

/**
 * Fallos que pueden desaparecer solos: el almacén o la base no responden (un bloqueo de LaLiga
 * corta R2) o los datos se movieron a mitad. Los demás darían lo mismo al cabo de una hora.
 */
const PASAJEROS: ReadonlySet<FalloPublicacion["_tag"]> = new Set([
  "AlmacenNoDisponible",
  "DatosNoDisponibles",
  "InstantaneaMovida",
]);

/** El publicador sobre los `DatosPublicables` de la base y el almacén del contexto. */
export const publicadorEn = (zonas: ZonasDePublicacion, porLote?: number) =>
  Layer.effect(
    Publicador,
    Effect.map(Effect.context<DatosPublicables | AlmacenDeFicheros>(), (contexto) =>
      Publicador.of({
        publicar: publicar(zonas, porLote).pipe(
          Effect.map((publicada): Intento => ({ resultado: publicada, reintentar: false })),
          Effect.catch((fallo) =>
            Effect.succeed<Intento>({
              resultado: { tipo: "fallida", motivo: describirFallo(fallo) },
              reintentar: PASAJEROS.has(fallo._tag),
            }),
          ),
          Effect.provideContext(contexto),
        ),
      }),
    ),
  );

/** Sin almacén configurado no se publica nada, y se apunta así. */
export const sinAlmacen = Layer.succeed(
  Publicador,
  Publicador.of({
    publicar: Effect.succeed({ resultado: { tipo: "sin-almacen" }, reintentar: false }),
  }),
);

/** Dónde se guardan las copias de seguridad de la base y cuántas se conservan. */
export interface OpcionesCopias {
  readonly carpeta: string;
  readonly conservar: number;
}

/** Lo que hace la noche, aparte de los extractores. */
export interface OpcionesNoche {
  readonly proceso: OpcionesBarrido;
  /** Lo que hace antenasmoviles.es: sus zonas y cuántos detalles lee. */
  readonly puntos: OpcionesPuntos;
  /** Si publicar falla por algo pasajero, cuánto se espera para repetirlo una vez. */
  readonly reintento: Duration.Duration;
  readonly copias: OpcionesCopias;
}

/** Una ejecución de la noche, de una fuente. */
export interface EjecucionDeLaNoche {
  readonly fuente: Fuente;
  readonly ejecucion: string;
  readonly estado: "omitida" | "fallida" | "completada";
  readonly zonas: ReadonlyArray<ZonaEnLaEjecucion>;
}

/** Lo que ha hecho una noche. */
export interface Noche {
  readonly ejecuciones: ReadonlyArray<EjecucionDeLaNoche>;
  readonly publicacion: ResultadoPublicacion;
  /** La copia de seguridad que se ha hecho, o `undefined` si ha fallado. */
  readonly copia: string | undefined;
}

const COPIA = /^ingesta-.+\.sqlite$/u;

/**
 * Copia la base a la carpeta de copias (`ingesta-<fecha>.sqlite`) y borra las más viejas hasta
 * dejar `conservar`. Devuelve la ruta de la copia.
 */
export const copiarBase = Effect.fn("Nocturna.copiarBase")(function* (opciones: OpcionesCopias) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* BaseNocturna;
  const ahora = DateTime.makeUnsafe(yield* Clock.currentTimeMillis);
  const destino = path.join(
    opciones.carpeta,
    `ingesta-${DateTime.formatIso(ahora).replaceAll(":", "-")}.sqlite`,
  );
  yield* fs.makeDirectory(opciones.carpeta, { recursive: true });
  if (!(yield* fs.exists(destino))) {
    yield* base.copiar(destino);
  }
  // El nombre lleva la fecha ISO: en orden alfabético, las más nuevas van al final.
  const copias = (yield* fs.readDirectory(opciones.carpeta))
    .filter((nombre) => COPIA.test(nombre))
    .toSorted()
    .toReversed();
  yield* Effect.forEach(
    copias.slice(Math.max(opciones.conservar, 1)),
    (vieja) => fs.remove(path.join(opciones.carpeta, vieja)),
    { discard: true },
  );
  return destino;
});

/** Publica una vez y lo apunta en la base, con las ejecuciones de su noche. */
const publicarYApuntar = Effect.fn("Nocturna.publicar")(function* (
  ejecuciones: ReadonlyArray<string>,
) {
  const publicador = yield* Publicador;
  const base = yield* BaseNocturna;
  const intento = yield* publicador.publicar;
  const { resultado } = intento;
  yield* base.apuntarPublicacion({ fecha: yield* Clock.currentTimeMillis, resultado }, ejecuciones);
  if (resultado.tipo === "fallida") {
    yield* Effect.logWarning(`Publicación fallida: ${resultado.motivo}`);
  } else if (resultado.tipo === "sin-almacen") {
    yield* Effect.logInfo("Sin almacén de ficheros: no se publica nada");
  } else {
    yield* Effect.logInfo(
      `${resultado.version}: ${resultado.tipo}, ${resultado.escritos} ficheros escritos`,
    );
  }
  return intento;
});

/** Una ejecución con el extractor que da `capa`, construido para ella sola. */
const ejecutarCon = <I, A, E, R>(capa: Layer.Layer<I>, ejecucion: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.flatMap(Layer.build(capa), (extractor) =>
      ejecucion.pipe(Effect.provideContext(extractor)),
    ),
  );

const describirZona = (z: ZonaEnLaEjecucion): string =>
  `Zona ${z.zona}: ${z.estado}, ${z.cuadros} cuadros, ${z.peticiones} peticiones, ` +
  `${Math.round(z.bytes / 1000)} kB, ${z.registros} registros, observaciones ` +
  `+${z.observaciones.creados} ~${z.observaciones.cambiados} -${z.observaciones.retirados}` +
  (z.error === undefined ? "" : ` (${z.error})`);

/**
 * La noche entera:
 *
 * 1. Una ejecución de ingesta por fuente, con su interruptor. El registro oficial barre sus zonas
 *    de barrido, lee las fichas pendientes y fusiona (`ejecutarBarrido`). antenasmoviles.es lee
 *    su listado una vez, guarda los puntos de sus zonas, lee el detalle de las ER5 pendientes y
 *    fusiona (`ejecutarBarridoDePuntos`).
 * 2. Publica la capa y las fichas. Sin cambios no escribe nada, y si la noche anterior no pudo
 *    publicar, lo hace ahora. Si falla por algo pasajero, lo apunta, espera `reintento` y lo
 *    intenta otra vez; si vuelve a fallar, queda para la noche siguiente. Los datos ya están en
 *    la base.
 * 3. Copia la base a la carpeta de copias y deja las `conservar` últimas.
 *
 * Una noche cortada a mitad deja su ejecución en curso; la siguiente la da por interrumpida y la
 * rehace, porque cada paso es idempotente. Un barrido de zona cortado se retoma por el primer
 * cuadro que no llegó a guardarse.
 */
export const noche = Effect.fn("Nocturna.noche")(function* (opciones: OpcionesNoche) {
  const extractores = yield* Extractores;
  const registro = yield* ejecutarCon(
    extractores.registroOficial,
    ejecutarBarrido(opciones.proceso),
  );
  const puntos = yield* ejecutarCon(
    extractores.antenasMoviles,
    ejecutarBarridoDePuntos(opciones.puntos),
  );
  const ejecuciones: ReadonlyArray<EjecucionDeLaNoche> = [
    { fuente: "registro-oficial", ...registro },
    { fuente: "antenasmoviles", ...puntos },
  ];
  for (const { fuente, estado, zonas } of ejecuciones) {
    yield* Effect.logInfo(`Ejecución de ${fuente}: ${estado}`);
    for (const zona of zonas) {
      yield* Effect.logInfo(describirZona(zona));
    }
  }
  const completadas = ejecuciones.filter((e) => e.estado === "completada").map((e) => e.ejecucion);

  let intento = yield* publicarYApuntar(completadas);
  if (intento.reintentar) {
    yield* Effect.logInfo(`Se vuelve a publicar dentro de ${Duration.format(opciones.reintento)}`);
    yield* Effect.sleep(opciones.reintento);
    intento = yield* publicarYApuntar(completadas);
  }

  const copia = yield* copiarBase(opciones.copias).pipe(
    Effect.tap((destino) => Effect.logInfo(`Copia de la base en ${destino}`)),
    Effect.catch((fallo) =>
      Effect.as(Effect.logWarning(`No se ha podido copiar la base: ${fallo.message}`), undefined),
    ),
  );
  const hecha: Noche = { ejecuciones, publicacion: intento.resultado, copia };
  return hecha;
});

/** Publica a mano, sin ingerir nada, y lo apunta en la base. */
export const publicarAMano = Effect.map(publicarYApuntar([]), (intento) => intento.resultado);

/** Escribe el estado de la base: cada fuente, lo publicado y el último intento de publicar. */
export const estado = Effect.fn("Nocturna.estado")(function* (rotacion: Duration.Duration) {
  const base = yield* BaseNocturna;
  const ahora = yield* Clock.currentTimeMillis;
  const resumen = yield* base.resumen(ahora - Duration.toMillis(rotacion));
  yield* Console.log(describirResumen(base.fichero, resumen));
  return resumen;
});
