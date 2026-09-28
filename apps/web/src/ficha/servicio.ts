import { type CapaLeida, ficheroDeLote } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { leerLote } from "@celda/dominio/loteDeFichas";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { CapaEmplazamientos, descargarCapa, leerVigente, origenDeCapas } from "../capa/servicio.ts";

/** La ficha no se ha podido leer: el origen no responde o lo que ha llegado no es una ficha. */
export class FichaNoLeida extends Schema.TaggedError<FichaNoLeida>()("FichaNoLeida", {
  motivo: Schema.String,
}) {}

/** El origen ya no tiene el lote de esa versión. */
class LoteRetirado extends Schema.TaggedError<LoteRetirado>()("LoteRetirado", {
  url: Schema.String,
}) {}

/**
 * Las fichas publicadas de los emplazamientos. `leer` da la ficha de un emplazamiento de la capa
 * que dibuja el mapa, o `None` si esa capa no tiene ningún emplazamiento con esa clave.
 */
export class FichasPublicadas extends Context.Service<
  FichasPublicadas,
  {
    readonly leer: (clave: string) => Effect.Effect<Option.Option<Ficha>, FichaNoLeida>;
    /**
     * Descarga ya el lote de las fichas de estas claves, sin abrir ninguna, para que abrirlas
     * después no espere a la red. Pide como mucho `LOTES_PRECARGADOS` lotes, los que más claves
     * tienen. No falla: si no llega, abrir la ficha lo vuelve a intentar.
     */
    readonly precargar: (claves: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("@celda/web/ficha/servicio/FichasPublicadas") {}

/**
 * Cuántos lotes se precargan de una vez. De cerca, lo que se ve cae en uno o dos lotes; más lejos,
 * los marcadores sueltos caen en muchos y no se sabe cuál se va a abrir.
 */
export const LOTES_PRECARGADOS = 2;

/** Qué lote de fichas tiene cada clave en cada capa leída. */
const lotesPorCapa = new WeakMap<CapaLeida, ReadonlyMap<string, number>>();

const loteDe = (capa: CapaLeida, clave: string): Option.Option<number> => {
  let lotes = lotesPorCapa.get(capa);
  if (lotes === undefined) {
    lotes = new Map(
      capa.emplazamientos.flatMap((e) => (e.lote === undefined ? [] : [[e.clave, e.lote]])),
    );
    lotesPorCapa.set(capa, lotes);
  }
  return Option.fromNullishOr(lotes.get(clave));
};

const noLeida = (motivo: string) => new FichaNoLeida({ motivo });

/**
 * Las fichas del origen estático, en lotes de emplazamientos vecinos de la misma versión que la
 * capa (ADR 0004):
 *
 * - Espera a la capa del mapa, que dice en qué lote está cada emplazamiento, y lee ese lote.
 * - Guarda cada lote leído, que no cambia nunca: abrir otra ficha del mismo lote no pide nada, y
 *   dos lecturas a la vez del mismo lote hacen una sola petición.
 * - Si el origen ya no tiene el lote de esa versión, porque la pestaña lleva abierta desde antes
 *   de otra publicación, lee la ficha de la versión vigente. Esa ficha puede ser más reciente que
 *   el mapa, y la marca de agua lo dice.
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

    const descargarLote = (version: string, lote: number) =>
      Effect.gen(function* () {
        const url = `${origen}/${ficheroDeLote(version, lote)}`;
        const respuesta = yield* http
          .get(url)
          .pipe(Effect.mapError((error) => noLeida(error.message)));
        if (respuesta.status === 404) {
          return yield* new LoteRetirado({ url });
        }
        const texto = yield* HttpClientResponse.filterStatusOk(respuesta).pipe(
          Effect.flatMap((ok) => ok.text),
          Effect.mapError((error) => noLeida(error.message)),
        );
        const leido = yield* Effect.fromResult(leerLote(texto, version, lote)).pipe(
          Effect.mapError((error) => noLeida(error.message)),
        );
        return new Map(leido.fichas.map((ficha) => [ficha.clave, ficha]));
      });

    /** El lote, de lo ya leído o del origen, una sola petición aunque lo pidan varios a la vez. */
    const loteLeido = (version: string, lote: number) => {
      const clave = ficheroDeLote(version, lote);
      let turno = turnos.get(clave);
      if (turno === undefined) {
        turno = Semaphore.makeUnsafe(1);
        turnos.set(clave, turno);
      }
      return turno.withPermits(1)(
        Effect.suspend(() => {
          const guardado = leidos.get(clave);
          return guardado === undefined
            ? Effect.tap(descargarLote(version, lote), (fichas) =>
                Effect.sync(() => {
                  leidos.set(clave, fichas);
                }),
              )
            : Effect.succeed(guardado);
        }),
      );
    };

    const fichaDe = (
      capa: CapaLeida,
      clave: string,
    ): Effect.Effect<Option.Option<Ficha>, FichaNoLeida | LoteRetirado> =>
      Option.match(loteDe(capa, clave), {
        // Sin lote puede ser que no exista o que la capa sea de antes de publicar las fichas.
        onNone: () =>
          capa.emplazamientos.some((e) => e.clave === clave)
            ? Effect.fail(noLeida(`la capa ${capa.version} no dice dónde está la ficha`))
            : Effect.succeed(Option.none<Ficha>()),
        onSome: (lote) =>
          Effect.map(loteLeido(capa.version, lote), (fichas) =>
            Option.fromNullishOr(fichas.get(clave)),
          ),
      });

    /** La ficha en la versión vigente, cuando la del mapa ya no está en el origen. */
    const fichaDeLaVigente = (clave: string, anterior: string) =>
      Effect.gen(function* () {
        const vigente = yield* leerVigente(http, origen);
        if (vigente.version === anterior) {
          return yield* noLeida(`el origen no tiene las fichas de ${anterior}`);
        }
        return yield* fichaDe(yield* descargarCapa(http, origen, vigente), clave);
      }).pipe(
        Effect.catchTags({
          LoteRetirado: (error) => Effect.fail(noLeida(`${error.url} no está en el origen`)),
          SinCapaPublicada: () => Effect.fail(noLeida("el origen no tiene ninguna capa")),
          OrigenNoResponde: (error) => Effect.fail(noLeida(error.motivo)),
          CapaNoDescargada: (error) => Effect.fail(noLeida(error.motivo)),
          CapaIlegible: (error) => Effect.fail(noLeida(error.motivo)),
          VersionDistinta: (error) => Effect.fail(noLeida(error.message)),
        }),
      );

    const leer = Effect.fn("FichasPublicadas.leer")(function* (clave: string) {
      const capa = yield* capas.cargar.pipe(
        Effect.mapError(() => noLeida("no ha llegado la capa del mapa")),
      );
      return yield* fichaDe(capa, clave).pipe(
        Effect.catchTag("LoteRetirado", () => fichaDeLaVigente(clave, capa.version)),
      );
    });

    const precargar = Effect.fn("FichasPublicadas.precargar")(
      function* (claves: ReadonlyArray<string>) {
        const capa = yield* capas.cargar;
        const cuantas = new Map<number, number>();
        for (const clave of claves) {
          const lote = Option.getOrUndefined(loteDe(capa, clave));
          if (lote !== undefined) cuantas.set(lote, (cuantas.get(lote) ?? 0) + 1);
        }
        const lotes = [...cuantas]
          .sort((a, b) => b[1] - a[1])
          .slice(0, LOTES_PRECARGADOS)
          .map(([lote]) => lote);
        yield* Effect.forEach(lotes, (lote) => loteLeido(capa.version, lote), {
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
