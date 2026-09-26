import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { LecturaGps, MotivoFalloGps, Permiso } from "./estado.ts";

/** La ubicación no ha llegado, y por qué. */
export class UbicacionNoDisponible extends Schema.TaggedError<UbicacionNoDisponible>()(
  "UbicacionNoDisponible",
  { motivo: Schema.Literals(["denegado", "sin-senal", "tiempo-agotado", "no-disponible"]) },
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
     * la primera no llega, o si después se bloquea el permiso; un fallo pasajero posterior no
     * corta el flujo. Dejar de consumirlo apaga el GPS.
     */
    readonly seguir: Stream.Stream<LecturaGps, UbicacionNoDisponible>;
  }
>()("@celda/web/ubicacion/geolocalizacion") {}

/** Cuánto se espera la primera lectura antes de decir que no llega. */
const ESPERA_PRIMERA_MS = 20_000;

/** El motivo de un `GeolocationPositionError` según su código. */
export const motivoDeCodigo = (codigo: number): MotivoFalloGps => {
  if (codigo === 1) return "denegado";
  if (codigo === 3) return "tiempo-agotado";
  return "sin-senal";
};

const PERMISOS: Readonly<Record<PermissionState, Permiso>> = {
  granted: "concedido",
  prompt: "preguntar",
  denied: "denegado",
};

/** El permiso con la API Permissions, si el navegador la tiene; si no, «desconocido». */
const permisoDelNavegador = (navegador: Navigator): Stream.Stream<Permiso> =>
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

/** Las lecturas con `watchPosition`; al cerrar el flujo se llama a `clearWatch`. */
const lecturasDelNavegador = (
  geolocalizacion: Geolocation,
): Stream.Stream<LecturaGps, UbicacionNoDisponible> =>
  Stream.callback<LecturaGps, UbicacionNoDisponible>((cola) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let leidas = 0;
        return geolocalizacion.watchPosition(
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
            const motivo = motivoDeCodigo(error.code);
            // Con la ubicación ya dada, un fallo pasajero no la quita; un bloqueo sí.
            if (leidas === 0 || motivo === "denegado") {
              Queue.failCauseUnsafe(cola, Cause.fail(new UbicacionNoDisponible({ motivo })));
            }
          },
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: ESPERA_PRIMERA_MS },
        );
      }),
      (vigilancia) => Effect.sync(() => geolocalizacion.clearWatch(vigilancia)),
    ),
  );

/**
 * El GPS del navegador. Sin la API de geolocalización (un navegador sin ella o una página sin
 * https), cada petición falla con `no-disponible`.
 */
export const geolocalizacionDelNavegador = (navegador: Navigator): Layer.Layer<Geolocalizacion> =>
  Layer.succeed(
    Geolocalizacion,
    Geolocalizacion.of({
      permiso: permisoDelNavegador(navegador),
      seguir:
        "geolocation" in navegador && globalThis.isSecureContext
          ? lecturasDelNavegador(navegador.geolocation)
          : Stream.fail(new UbicacionNoDisponible({ motivo: "no-disponible" })),
    }),
  );
