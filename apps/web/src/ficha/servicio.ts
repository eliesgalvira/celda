import type { Ficha } from "@celda/dominio/ficha";
import { leerCapaDeProvincia, leerLoteDeProvincia } from "@celda/dominio/provincias";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";

import type { ProvinciaCargada } from "../capa/nacional.ts";
import {
  CapaEmplazamientos,
  descargarFichero,
  descargarResumen,
  leerVigente,
  origenDeCapas,
} from "../capa/servicio.ts";

/** La ficha no se ha podido leer: el origen no responde o lo que ha llegado no es una ficha. */
export class FichaNoLeida extends Schema.TaggedError<FichaNoLeida>()("FichaNoLeida", {
  motivo: Schema.String,
}) {}

/** El origen ya no tiene el lote de esa versión. */
class LoteRetirado extends Schema.TaggedError<LoteRetirado>()("LoteRetirado", {
  fichero: Schema.String,
}) {}

/** Un emplazamiento cuya ficha se pide: su clave y la provincia en cuya capa va. */
export interface FichaPedida {
  readonly clave: string;
  readonly provincia: string;
}

/**
 * Las fichas publicadas de los emplazamientos. `leer` da la ficha de un emplazamiento de la capa
 * de su provincia, o `None` si esa capa no tiene ningún emplazamiento con esa clave.
 */
export class FichasPublicadas extends Context.Service<
  FichasPublicadas,
  {
    readonly leer: (pedida: FichaPedida) => Effect.Effect<Option.Option<Ficha>, FichaNoLeida>;
    /**
     * Descarga ya el lote de las fichas de estos emplazamientos, sin abrir ninguna, para que
     * abrirlas después no espere a la red. Pide como mucho `LOTES_PRECARGADOS` lotes, los que más
     * emplazamientos tienen. No falla: si no llega, abrir la ficha lo vuelve a intentar.
     */
    readonly precargar: (pedidas: ReadonlyArray<FichaPedida>) => Effect.Effect<void>;
  }
>()("@celda/web/ficha/servicio/FichasPublicadas") {}

/**
 * Cuántos lotes se precargan de una vez. De cerca, lo que se ve cae en uno o dos lotes; más lejos,
 * los marcadores sueltos caen en muchos y no se sabe cuál se va a abrir.
 */
export const LOTES_PRECARGADOS = 2;

/** Qué fichero de lote tiene cada clave en cada provincia cargada. */
const lotesPorProvincia = new WeakMap<ProvinciaCargada, ReadonlyMap<string, string>>();

const loteDe = (provincia: ProvinciaCargada, clave: string): Option.Option<string> => {
  let lotes = lotesPorProvincia.get(provincia);
  if (lotes === undefined) {
    const { capa } = provincia;
    lotes = new Map(
      capa.emplazamientos.flatMap((e) => {
        const fichero = capa.lotes[e.lote ?? -1];
        return fichero === undefined ? [] : [[e.clave, fichero] as const];
      }),
    );
    lotesPorProvincia.set(provincia, lotes);
  }
  return Option.fromNullishOr(lotes.get(clave));
};

const noLeida = (motivo: string) => new FichaNoLeida({ motivo });

/**
 * Las fichas del origen estático, en lotes de emplazamientos vecinos de cada provincia (ADR 0004
 * y 0016):
 *
 * - Espera a la capa de la provincia, que dice en qué lote está cada emplazamiento, y lee ese
 *   lote. Los lotes se nombran por su contenido, así que un lote leído es el de esa capa.
 * - Guarda cada lote leído: abrir otra ficha del mismo lote no pide nada, y dos lecturas a la vez
 *   del mismo lote hacen una sola petición.
 * - Si el origen ya no tiene el lote, porque la pestaña lleva abierta desde antes de varias
 *   publicaciones, lee la ficha de la versión vigente. Esa ficha puede ser más reciente que el
 *   mapa, y la marca de agua lo dice.
 *
 * Una lectura interrumpida, porque se ha cambiado de emplazamiento, cancela su petición.
 */
export const fichasDelOrigen = Layer.effect(
  FichasPublicadas,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const capas = yield* CapaEmplazamientos;
    const origen = yield* Effect.orDie(origenDeCapas);
    const leidos = new Map<string, ReadonlyMap<string, Ficha>>();
    const turnos = new Map<string, Semaphore.Semaphore>();

    const descargarLote = (cliente: HttpClient.HttpClient, provincia: string, fichero: string) =>
      Effect.gen(function* () {
        const texto = yield* descargarFichero(cliente, origen, fichero).pipe(
          Effect.mapError((error) => noLeida(error.motivo)),
        );
        if (Option.isNone(texto)) return yield* new LoteRetirado({ fichero });
        const fichas = yield* Effect.fromResult(leerLoteDeProvincia(texto.value, provincia)).pipe(
          Effect.mapError((error) => noLeida(error.message)),
        );
        return new Map(fichas.map((ficha) => [ficha.clave, ficha]));
      });

    /** El lote, de lo ya leído o del origen, una sola petición aunque lo pidan varios a la vez. */
    const loteLeido = (provincia: string, fichero: string) => {
      let turno = turnos.get(fichero);
      if (turno === undefined) {
        turno = Semaphore.makeUnsafe(1);
        turnos.set(fichero, turno);
      }
      return turno.withPermits(1)(
        Effect.suspend(() => {
          const guardado = leidos.get(fichero);
          return guardado === undefined
            ? Effect.tap(descargarLote(http, provincia, fichero), (fichas) =>
                Effect.sync(() => {
                  leidos.set(fichero, fichas);
                }),
              )
            : Effect.succeed(guardado);
        }),
      );
    };

    /** La ficha en la versión vigente, cuando la del mapa ya no está en el origen. */
    const fichaDeLaVigente = (pedida: FichaPedida, anterior: string) =>
      Effect.gen(function* () {
        const vigente = yield* leerVigente(http, origen);
        if (vigente.version === anterior) {
          return yield* noLeida(`el origen no tiene las fichas de ${anterior}`);
        }
        const resumen = yield* descargarResumen(http, origen, vigente);
        const fichero = resumen.provincias.find((p) => p.codigo === pedida.provincia)?.fichero;
        const texto =
          fichero === undefined
            ? Option.none<string>()
            : yield* descargarFichero(http, origen, fichero);
        if (Option.isNone(texto)) return Option.none<Ficha>();
        const capa = yield* Effect.fromResult(leerCapaDeProvincia(texto.value, pedida.provincia));
        const emplazamiento = capa.emplazamientos.find((e) => e.clave === pedida.clave);
        const lote = capa.lotes[emplazamiento?.lote ?? -1];
        if (lote === undefined) return Option.none<Ficha>();
        const fichas = yield* loteLeido(pedida.provincia, lote);
        return Option.fromNullishOr(fichas.get(pedida.clave));
      }).pipe(
        Effect.catchTags({
          LoteRetirado: (error) => Effect.fail(noLeida(`${error.fichero} no está en el origen`)),
          SinCapaPublicada: () => Effect.fail(noLeida("el origen no tiene ninguna capa")),
          OrigenNoResponde: (error) => Effect.fail(noLeida(error.motivo)),
          CapaNoDescargada: (error) => Effect.fail(noLeida(error.motivo)),
          CapaIlegible: (error) => Effect.fail(noLeida(error.motivo)),
          VersionDistinta: (error) => Effect.fail(noLeida(error.message)),
        }),
      );

    const leer = Effect.fn("FichasPublicadas.leer")(function* (pedida: FichaPedida) {
      const provincia = yield* capas
        .provincia(pedida.provincia)
        .pipe(Effect.mapError(() => noLeida("no ha llegado la capa de su provincia")));
      const fichero = loteDe(provincia, pedida.clave);
      if (Option.isNone(fichero)) return Option.none<Ficha>();
      return yield* Effect.map(loteLeido(pedida.provincia, fichero.value), (fichas) =>
        Option.fromNullishOr(fichas.get(pedida.clave)),
      ).pipe(Effect.catchTag("LoteRetirado", () => fichaDeLaVigente(pedida, provincia.version)));
    });

    const precargar = Effect.fn("FichasPublicadas.precargar")(
      function* (pedidas: ReadonlyArray<FichaPedida>) {
        const cuantas = new Map<string, { provincia: string; cuantas: number }>();
        for (const pedida of pedidas) {
          const provincia = yield* capas.provincia(pedida.provincia);
          const fichero = Option.getOrUndefined(loteDe(provincia, pedida.clave));
          if (fichero === undefined) continue;
          const antes = cuantas.get(fichero)?.cuantas ?? 0;
          cuantas.set(fichero, { provincia: pedida.provincia, cuantas: antes + 1 });
        }
        const lotes = [...cuantas]
          .sort((a, b) => b[1].cuantas - a[1].cuantas)
          .slice(0, LOTES_PRECARGADOS);
        yield* Effect.forEach(lotes, ([fichero, { provincia }]) => loteLeido(provincia, fichero), {
          concurrency: "unbounded",
          discard: true,
        });
      },
      Effect.catch((error) =>
        Effect.logDebug("No se ha podido precargar un lote de fichas", error),
      ),
    );

    return FichasPublicadas.of({ leer, precargar });
  }),
);
