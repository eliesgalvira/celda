import type { AportacionCompartible, TipoCompartible } from "@celda/dominio/aportacion";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { AlmacenLocal, type AlmacenNoDisponible } from "../ubicacion/almacen.ts";

/**
 * Compartir aportaciones con el buzón de Celda (ADR 0007 y 0020). La aportación se guarda antes en
 * el dispositivo, así que si el buzón no la recibe se queda ahí para enviarla más tarde.
 */

/** Dónde se ha llegado a un límite: el del dispositivo, el de su red o el de todo el buzón. */
export const AmbitoDelLimite = Schema.Literals(["dispositivo", "ip", "total"]);
export type AmbitoDelLimite = typeof AmbitoDelLimite.Type;

/** El buzón ha rechazado el envío por un límite. `reintentarA` es la hora local en que se puede. */
export class LimiteDelBuzon extends Schema.TaggedError<LimiteDelBuzon>()("LimiteDelBuzon", {
  ambito: AmbitoDelLimite,
  reintentarA: Schema.Finite,
}) {}

/** El buzón no está abierto: esta web no tiene su dirección o el despliegue no tiene su clave. */
export class BuzonCerrado extends Schema.TaggedError<BuzonCerrado>()("BuzonCerrado", {}) {}

/**
 * El buzón no ha contestado: sin conexión, o con el despliegue apagado por sus umbrales de uso.
 */
export class BuzonSinRespuesta extends Schema.TaggedError<BuzonSinRespuesta>()(
  "BuzonSinRespuesta",
  { motivo: Schema.String },
) {}

/** La moderación ha vetado este dispositivo o la red desde la que envía. */
export class EnvioVetado extends Schema.TaggedError<EnvioVetado>()("EnvioVetado", {
  que: Schema.Literals(["identidad", "ip"]),
}) {}

/** El buzón no acepta la aportación: no cumple el esquema o no es verosímil. */
export class EnvioNoValido extends Schema.TaggedError<EnvioNoValido>()("EnvioNoValido", {
  motivo: Schema.String,
}) {}

/** El buzón ya no reconoce la identidad del dispositivo: hay que pedir otra. */
export class IdentidadCaducada extends Schema.TaggedError<IdentidadCaducada>()(
  "IdentidadCaducada",
  {},
) {}

/** Lo que el buzón puede contestar en lugar de recibir la aportación. */
export type FalloDelBuzon =
  | LimiteDelBuzon
  | BuzonCerrado
  | BuzonSinRespuesta
  | EnvioVetado
  | EnvioNoValido;

/** Por qué no se ha compartido una aportación. */
export type FalloAlCompartir = FalloDelBuzon | AlmacenNoDisponible;

/**
 * El buzón al otro lado: el de Convex en la web (`convex.ts`, que se carga al compartir la primera
 * vez) o uno de prueba. Los límites llegan ya con la hora local en que se puede reintentar.
 */
export interface BuzonRemoto {
  readonly pedirIdentidad: Effect.Effect<string, FalloDelBuzon>;
  readonly enviar: (
    identidad: string,
    aportacion: AportacionCompartible,
  ) => Effect.Effect<{ readonly nueva: boolean }, FalloDelBuzon | IdentidadCaducada>;
}

/** Lo que devuelve compartir: cuándo lo recibió el buzón, según el reloj del dispositivo. */
export interface Compartida {
  readonly compartidaEl: number;
}

/**
 * El servicio `Sincronizacion` del ADR 0007: envía lo que la persona decide compartir y apunta en
 * el dispositivo qué se ha enviado.
 */
export class Sincronizacion extends Context.Service<
  Sincronizacion,
  {
    /**
     * Guarda la aportación en el dispositivo y la envía al buzón con su identificador como clave
     * idempotente: enviarla dos veces guarda una. Si el buzón la recibe, apunta cuándo.
     */
    readonly compartir: (
      aportacion: AportacionCompartible,
    ) => Effect.Effect<Compartida, FalloAlCompartir>;
  }
>()("@celda/web/buzon/sincronizacion/Sincronizacion") {}

/**
 * La sincronización sobre un buzón. `remoto` se pide la primera vez que se comparte: en la web,
 * así se descarga el cliente de Convex solo entonces. Tras un límite no vuelve a llamar al buzón
 * hasta la hora que dijo, porque cada intento rechazado también gasta llamadas del plan gratuito.
 */
export const sincronizacionCon = (
  remoto: Effect.Effect<BuzonRemoto, BuzonCerrado | BuzonSinRespuesta>,
): Layer.Layer<Sincronizacion, never, AlmacenLocal> =>
  Layer.effect(
    Sincronizacion,
    Effect.gen(function* () {
      const almacen = yield* AlmacenLocal;
      // Se guarda el buzón en cuanto se consigue; un fallo al cargarlo se reintenta la vez siguiente.
      const cargado = yield* Ref.make(Option.none<BuzonRemoto>());
      const buzon = Effect.flatMap(Ref.get(cargado), (actual) =>
        Option.match(actual, {
          onSome: Effect.succeed,
          onNone: () => Effect.tap(remoto, (nuevo) => Ref.set(cargado, Option.some(nuevo))),
        }),
      );
      const esperas = yield* Ref.make<ReadonlyMap<TipoCompartible, LimiteDelBuzon>>(new Map());

      const identidad = Effect.fn("Sincronizacion.identidad")(function* (remota: BuzonRemoto) {
        const guardada = yield* almacen.leerIdentidad;
        if (Option.isSome(guardada)) return guardada.value;
        const nueva = yield* remota.pedirIdentidad;
        yield* almacen.guardarIdentidad(Option.some(nueva));
        return nueva;
      });

      /** Envía con la identidad guardada; si el buzón ya no la reconoce, pide otra una vez. */
      const enviar = Effect.fn("Sincronizacion.enviar")(function* (
        remota: BuzonRemoto,
        aportacion: AportacionCompartible,
      ) {
        const primera = yield* identidad(remota);
        return yield* remota.enviar(primera, aportacion).pipe(
          Effect.catchTag("IdentidadCaducada", () =>
            Effect.gen(function* () {
              yield* almacen.guardarIdentidad(Option.none());
              const otra = yield* identidad(remota);
              return yield* remota
                .enviar(otra, aportacion)
                .pipe(
                  Effect.catchTag("IdentidadCaducada", () =>
                    Effect.fail(
                      new BuzonSinRespuesta({ motivo: "el buzón no reconoce la identidad" }),
                    ),
                  ),
                );
            }),
          ),
        );
      });

      const compartir = Effect.fn("Sincronizacion.compartir")(function* (
        aportacion: AportacionCompartible,
      ) {
        yield* almacen.guardar(aportacion);
        const ahora = yield* Clock.currentTimeMillis;
        const espera = (yield* Ref.get(esperas)).get(aportacion.tipo);
        if (espera !== undefined && espera.reintentarA > ahora) return yield* espera;
        const remota = yield* buzon;
        yield* enviar(remota, aportacion).pipe(
          Effect.tapError((fallo) =>
            fallo._tag === "LimiteDelBuzon"
              ? Ref.update(esperas, (actuales) => new Map(actuales).set(aportacion.tipo, fallo))
              : Effect.void,
          ),
        );
        const compartidaEl = yield* Clock.currentTimeMillis;
        yield* almacen.apuntarCompartida(aportacion.id, compartidaEl);
        return { compartidaEl };
      });

      return Sincronizacion.of({ compartir });
    }),
  );

/**
 * La sincronización de la web, con el buzón de Convex en `direccion` (`VITE_CELDA_CONVEX_URL`).
 * El cliente de Convex va en su propio trozo y se descarga al compartir la primera vez: una visita
 * al mapa no lo descarga ni abre ninguna conexión (ADR 0020). Sin dirección, el buzón está cerrado.
 */
export const sincronizacionDelNavegador = (
  direccion: string | undefined,
): Layer.Layer<Sincronizacion, never, AlmacenLocal> =>
  sincronizacionCon(
    direccion === undefined || direccion === ""
      ? Effect.fail(new BuzonCerrado())
      : Effect.tryPromise({
          try: () => import("./convex.ts"),
          catch: () =>
            new BuzonSinRespuesta({ motivo: "no se ha podido cargar el cliente del buzón" }),
        }).pipe(Effect.map((modulo) => modulo.buzonDeConvex(direccion))),
  );
