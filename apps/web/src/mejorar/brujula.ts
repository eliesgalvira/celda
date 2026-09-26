import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { TipoDeDispositivo } from "../medir/dispositivo.ts";
import {
  type DatosDeOrientacion,
  type Disponibilidad,
  type LecturaBrujula,
  lecturaDeOrientacion,
} from "./estado.ts";

/** La brújula no da ninguna lectura: el dispositivo no tiene, o no la da al navegador. */
export class BrujulaSinLecturas extends Schema.TaggedError<BrujulaSinLecturas>()(
  "BrujulaSinLecturas",
  {},
) {}

/**
 * La brújula del dispositivo. Lo que lee se queda en el dispositivo: este servicio no lo guarda
 * ni lo envía a ninguna parte.
 */
export class Brujula extends Context.Service<
  Brujula,
  {
    /** Qué ofrece el dispositivo. Saberlo no hace preguntar nada. */
    readonly disponibilidad: Disponibilidad;
    /**
     * Pide permiso para leer la orientación, donde hace falta (el iPhone). El navegador solo
     * pregunta si se llama dentro de un gesto, así que la petición sale en cuanto se ejecuta,
     * sin esperar a nada antes.
     */
    readonly pedirPermiso: Effect.Effect<"concedido" | "denegado">;
    /**
     * Da cada lectura de la brújula. Falla si la primera no llega a tiempo. Dejar de consumirlo
     * deja de escuchar.
     */
    readonly seguir: Stream.Stream<LecturaBrujula, BrujulaSinLecturas>;
  }
>()("@celda/web/mejorar/brujula") {}

/** Cuánto se espera la primera lectura antes de decir que no hay brújula. */
export const ESPERA_PRIMERA_MS = 3000;

/**
 * Lo que interesa de un `DeviceOrientationEvent`, con lo que añade Safari, que no está en los
 * tipos del DOM. Cada navegador da unos campos y deja los otros en `null` o sin definir.
 */
const EventoDeOrientacion = Schema.Struct({
  webkitCompassHeading: Schema.optional(Schema.NullOr(Schema.Finite)),
  webkitCompassAccuracy: Schema.optional(Schema.NullOr(Schema.Finite)),
  alpha: Schema.NullOr(Schema.Finite),
  absolute: Schema.Boolean,
});
const leerEvento = Schema.decodeUnknownOption(EventoDeOrientacion);

interface ConstructorDeOrientacion {
  readonly requestPermission?: () => Promise<"granted" | "denied">;
}

const constructorDe = (ventana: Window): ConstructorDeOrientacion | undefined =>
  // SAFETY: `DeviceOrientationEvent` es una propiedad global de la ventana en los navegadores que
  // la tienen; en el resto no existe.
  (ventana as Window & { readonly DeviceOrientationEvent?: ConstructorDeOrientacion })
    .DeviceOrientationEvent;

/** Qué ofrece el navegador, sin preguntar nada. */
export const disponibilidadDe = (ventana: Window, tipo: TipoDeDispositivo): Disponibilidad => {
  if (tipo === "ordenador") return "ordenador";
  const constructor = constructorDe(ventana);
  if (constructor === undefined || !ventana.isSecureContext) return "sin-api";
  return constructor.requestPermission === undefined ? "sin-permiso" : "con-permiso";
};

/** El giro de la pantalla, en grados: 90 con el móvil en horizontal hacia la izquierda. */
const anguloPantalla = (ventana: Window): number => ventana.screen.orientation?.angle ?? 0;

/** Los datos del evento, o nada si no tiene la forma esperada. */
const datosDe = (evento: Event, absoluto: boolean): DatosDeOrientacion | undefined => {
  // SAFETY: los dos tipos de evento que se escuchan son `DeviceOrientationEvent`. Los campos de
  // Safari no están en sus tipos y se validan con el esquema.
  const orientacion = evento as DeviceOrientationEvent & {
    readonly webkitCompassHeading?: unknown;
    readonly webkitCompassAccuracy?: unknown;
  };
  // Los campos son getters del prototipo: se copian a un objeto antes de validarlos.
  const campos = {
    webkitCompassHeading: orientacion.webkitCompassHeading,
    webkitCompassAccuracy: orientacion.webkitCompassAccuracy,
    alpha: orientacion.alpha,
    absolute: orientacion.absolute,
  };
  const leido = leerEvento(campos);
  if (leido._tag === "None") return undefined;
  const { webkitCompassHeading, webkitCompassAccuracy, alpha, absolute } = leido.value;
  return {
    rumboSafari: webkitCompassHeading ?? undefined,
    margenSafari: webkitCompassAccuracy ?? undefined,
    alpha: alpha ?? undefined,
    absoluta: absoluto || absolute,
  };
};

/**
 * Las lecturas con `deviceorientationabsolute` (Chrome en Android) o, donde no existe,
 * `deviceorientation` (Safari, con `webkitCompassHeading`). Al cerrar el flujo se deja de
 * escuchar.
 */
const lecturasDe = (ventana: Window): Stream.Stream<LecturaBrujula, BrujulaSinLecturas> =>
  Stream.callback<LecturaBrujula, BrujulaSinLecturas>((cola) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const absoluto = "ondeviceorientationabsolute" in ventana;
        const tipo = absoluto ? "deviceorientationabsolute" : "deviceorientation";
        const espera = ventana.setTimeout(() => {
          Queue.failCauseUnsafe(cola, Cause.fail(new BrujulaSinLecturas()));
        }, ESPERA_PRIMERA_MS);
        const escuchar = (evento: Event) => {
          const datos = datosDe(evento, absoluto);
          const lectura =
            datos === undefined ? undefined : lecturaDeOrientacion(datos, anguloPantalla(ventana));
          if (lectura === undefined) return;
          ventana.clearTimeout(espera);
          Queue.offerUnsafe(cola, lectura);
        };
        ventana.addEventListener(tipo, escuchar);
        return { tipo, escuchar, espera };
      }),
      ({ tipo, escuchar, espera }) =>
        Effect.sync(() => {
          ventana.clearTimeout(espera);
          ventana.removeEventListener(tipo, escuchar);
        }),
    ),
  );

/** El permiso con `DeviceOrientationEvent.requestPermission`, donde existe. */
const permisoDe = (ventana: Window): Effect.Effect<"concedido" | "denegado"> =>
  Effect.callback<"concedido" | "denegado">((reanudar) => {
    const pedir = constructorDe(ventana)?.requestPermission;
    if (pedir === undefined) {
      reanudar(Effect.succeed("concedido"));
      return;
    }
    // Se llama aquí mismo, dentro del gesto que ha lanzado el efecto.
    pedir().then(
      (respuesta) => reanudar(Effect.succeed(respuesta === "granted" ? "concedido" : "denegado")),
      () => reanudar(Effect.succeed("denegado")),
    );
  });

/**
 * La brújula del navegador. En un ordenador no se intenta: no tiene, y se simula con la barra.
 */
export const brujulaDelNavegador = (
  ventana: Window,
  tipo: TipoDeDispositivo,
): Layer.Layer<Brujula> => {
  const disponibilidad = disponibilidadDe(ventana, tipo);
  return Layer.succeed(
    Brujula,
    Brujula.of({
      disponibilidad,
      pedirPermiso: permisoDe(ventana),
      seguir:
        disponibilidad === "ordenador" || disponibilidad === "sin-api"
          ? Stream.fail(new BrujulaSinLecturas())
          : lecturasDe(ventana),
    }),
  );
};
