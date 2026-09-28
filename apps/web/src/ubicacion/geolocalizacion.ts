import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { TipoDeDispositivo } from "../medir/dispositivo.ts";
import type { LecturaGps, MotivoFalloGps, Permiso } from "./estado.ts";

/** La ubicación no ha llegado, y por qué. */
export class UbicacionNoDisponible extends Schema.TaggedError<UbicacionNoDisponible>()(
  "UbicacionNoDisponible",
  {
    motivo: Schema.Literals([
      "denegado",
      "sin-senal",
      "sin-fuente",
      "tiempo-agotado",
      "no-disponible",
    ]),
  },
) {}

/**
 * El GPS del dispositivo. La posición se calcula y se queda en el dispositivo: este servicio no
 * la guarda ni la envía a ninguna parte.
 */
export class Geolocalizacion extends Context.Service<
  Geolocalizacion,
  {
    /** El estado del permiso ahora y cada vez que cambie. Leerlo no hace preguntar nada. */
    readonly permiso: Stream.Stream<Permiso>;
    /**
     * Pide la ubicación (el navegador pregunta si hace falta) y da cada lectura nueva. Falla si
     * la primera no llega a tiempo, aunque el navegador no diga nada, o si después se bloquea el
     * permiso; un fallo pasajero posterior no corta el flujo. Dejar de consumirlo apaga el GPS.
     */
    readonly seguir: Stream.Stream<LecturaGps, UbicacionNoDisponible>;
  }
>()("@celda/web/ubicacion/geolocalizacion") {}

/** Cuánto se espera la primera lectura desde que hay permiso. */
export const ESPERA_PRIMERA_MS = 20_000;

/**
 * Cuánto se espera como mucho la primera lectura desde que se pide, aunque el navegador siga
 * diciendo que va a preguntar: hay navegadores que no cambian el estado del permiso cuando se
 * concede solo esta vez.
 */
export const ESPERA_MAXIMA_MS = 60_000;

/**
 * El motivo de un `GeolocationPositionError` según su código. En un ordenador, «no se puede
 * calcular» (2) y «se ha agotado el tiempo» (3) quieren decir lo mismo: el navegador no tiene de
 * dónde sacar la posición.
 */
export const motivoDeCodigo = (codigo: number, tipo: TipoDeDispositivo): MotivoFalloGps => {
  if (codigo === 1) return "denegado";
  if (tipo === "ordenador") return "sin-fuente";
  if (codigo === 3) return "tiempo-agotado";
  return "sin-senal";
};

const PERMISOS: Readonly<Record<PermissionState, Permiso>> = {
  granted: "concedido",
  prompt: "preguntar",
  denied: "denegado",
};

/** Lo que el servicio usa del navegador: la API de geolocalización y la de permisos. */
export type NavegadorConUbicacion = Pick<Navigator, "geolocation" | "permissions">;

/** El permiso con la API Permissions, si el navegador la tiene; si no, «desconocido». */
const permisoDelNavegador = (navegador: NavegadorConUbicacion): Stream.Stream<Permiso> =>
  Stream.callback<Permiso>((cola) =>
    Effect.gen(function* () {
      const estado = yield* Effect.tryPromise(() =>
        navegador.permissions.query({ name: "geolocation" }),
      ).pipe(Effect.option);
      if (estado._tag === "None") {
        Queue.offerUnsafe(cola, "desconocido");
        return;
      }
      const permiso = estado.value;
      const avisar = () => Queue.offerUnsafe(cola, PERMISOS[permiso.state]);
      avisar();
      yield* Effect.acquireRelease(
        Effect.sync(() => permiso.addEventListener("change", avisar)),
        () => Effect.sync(() => permiso.removeEventListener("change", avisar)),
      );
    }),
  );

/**
 * Las lecturas con `watchPosition`; al cerrar el flujo se llama a `clearWatch`. La espera de la
 * primera lectura es propia: la opción `timeout` no basta, porque hay navegadores que no llaman
 * a nada si no encuentran la posición, y entonces «Buscando tu ubicación» no acabaría nunca.
 */
const lecturasDelNavegador = (
  geolocalizacion: Geolocation,
  permiso: Stream.Stream<Permiso>,
  tipo: TipoDeDispositivo,
): Stream.Stream<LecturaGps, UbicacionNoDisponible> =>
  Stream.callback<LecturaGps, UbicacionNoDisponible>((cola) =>
    Effect.gen(function* () {
      let leidas = 0;
      const fallar = (motivo: MotivoFalloGps) =>
        Queue.failCauseUnsafe(cola, Cause.fail(new UbicacionNoDisponible({ motivo })));
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          geolocalizacion.watchPosition(
            (posicion) => {
              leidas += 1;
              Queue.offerUnsafe(cola, {
                posicion: {
                  longitud: posicion.coords.longitude,
                  latitud: posicion.coords.latitude,
                },
                precision: posicion.coords.accuracy,
                fecha: posicion.timestamp,
              });
            },
            (error) => {
              const motivo = motivoDeCodigo(error.code, tipo);
              // Con la ubicación ya dada, un fallo pasajero no la quita; un bloqueo sí.
              if (leidas === 0 || motivo === "denegado") fallar(motivo);
            },
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: ESPERA_PRIMERA_MS },
          ),
        ),
        (vigilancia) => Effect.sync(() => geolocalizacion.clearWatch(vigilancia)),
      );
      // La espera cuenta desde que hay permiso, para no cortar mientras la persona decide.
      const hayPermiso = Stream.runHead(Stream.filter(permiso, (actual) => actual !== "preguntar"));
      yield* Effect.andThen(hayPermiso, Effect.sleep(ESPERA_PRIMERA_MS)).pipe(
        Effect.timeoutOrElse({ duration: ESPERA_MAXIMA_MS, orElse: () => Effect.void }),
        Effect.andThen(
          Effect.sync(() => {
            if (leidas === 0) fallar(tipo === "ordenador" ? "sin-fuente" : "tiempo-agotado");
          }),
        ),
        Effect.forkScoped,
      );
    }),
  );

/**
 * El GPS del navegador. Sin la API de geolocalización (un navegador sin ella o una página sin
 * https), cada petición falla con `no-disponible`.
 */
export const geolocalizacionDelNavegador = (
  navegador: NavegadorConUbicacion,
  tipo: TipoDeDispositivo,
  seguro: boolean = globalThis.isSecureContext,
): Layer.Layer<Geolocalizacion> => {
  const permiso = permisoDelNavegador(navegador);
  return Layer.succeed(
    Geolocalizacion,
    Geolocalizacion.of({
      permiso,
      seguir:
        "geolocation" in navegador && seguro
          ? lecturasDelNavegador(navegador.geolocation, permiso, tipo)
          : Stream.fail(new UbicacionNoDisponible({ motivo: "no-disponible" })),
    }),
  );
};
