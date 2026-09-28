// Cada prueba monta su navegador de prueba con un GPS y un permiso nuevos.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import type { TipoDeDispositivo } from "../medir/dispositivo.ts";
import type { LecturaGps } from "./estado.ts";
import {
  ESPERA_MAXIMA_MS,
  ESPERA_PRIMERA_MS,
  Geolocalizacion,
  geolocalizacionDelNavegador,
  type NavegadorConUbicacion,
  type UbicacionNoDisponible,
} from "./geolocalizacion.ts";

interface Vigilancia {
  readonly leer: PositionCallback;
  readonly fallar: PositionErrorCallback | null | undefined;
}

/**
 * Un `Geolocation` que no hace nada hasta que la prueba entrega una lectura o un error, como un
 * navegador que no llama a nada si no encuentra la posición.
 */
class GpsDePrueba implements Geolocation {
  readonly vigilancias = new Map<number, Vigilancia>();
  pedidas = 0;
  private siguiente = 0;

  watchPosition(leer: PositionCallback, fallar?: PositionErrorCallback | null): number {
    this.pedidas += 1;
    this.siguiente += 1;
    this.vigilancias.set(this.siguiente, { leer, fallar });
    return this.siguiente;
  }

  clearWatch(vigilancia: number): void {
    this.vigilancias.delete(vigilancia);
  }

  getCurrentPosition(): void {
    throw new Error("El servicio usa watchPosition");
  }

  /** Una lectura con esta precisión a las vigilancias abiertas. */
  responder(precision: number): void {
    const coords = {
      latitude: 41.3861,
      longitude: 2.1109,
      accuracy: precision,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    };
    const posicion: GeolocationPosition = {
      coords: { ...coords, toJSON: () => coords },
      timestamp: 1_790_413_200_000,
      toJSON: () => ({ coords, timestamp: 1_790_413_200_000 }),
    };
    for (const { leer } of this.vigilancias.values()) leer(posicion);
  }

  /** Un error del navegador a las vigilancias abiertas: 1 bloqueado, 2 sin posición, 3 tiempo. */
  fallar(codigo: 1 | 2 | 3): void {
    const error: GeolocationPositionError = {
      code: codigo,
      message: "error de prueba",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
    for (const { fallar } of this.vigilancias.values()) fallar?.(error);
  }
}

/** El permiso del navegador, que la prueba cambia como si la persona contestara al aviso. */
class PermisoDePrueba extends EventTarget implements PermissionStatus {
  readonly name = "geolocation";
  onchange: PermissionStatus["onchange"] = null;
  state: PermissionState;
  constructor(estado: PermissionState) {
    super();
    this.state = estado;
  }
  cambiar(estado: PermissionState): void {
    this.state = estado;
    this.dispatchEvent(new Event("change"));
  }
}

class PermisosDePrueba implements Permissions {
  private readonly estado: PermissionStatus;
  constructor(estado: PermissionStatus) {
    this.estado = estado;
  }
  query(): Promise<PermissionStatus> {
    return Promise.resolve(this.estado);
  }
}

const montar = (permiso: PermissionState, tipo: TipoDeDispositivo = "android") => {
  const gps = new GpsDePrueba();
  const estado = new PermisoDePrueba(permiso);
  const navegador: NavegadorConUbicacion = {
    geolocation: gps,
    permissions: new PermisosDePrueba(estado),
  };
  return { gps, estado, capa: geolocalizacionDelNavegador(navegador, tipo, true) };
};

/** Sigue la ubicación en otra fibra y va guardando las lecturas. */
const seguir = Effect.gen(function* () {
  const leidas: Array<LecturaGps> = [];
  const { seguir } = yield* Geolocalizacion;
  const fibra = yield* Effect.forkChild(
    Effect.flip(Stream.runForEach(seguir, (lectura) => Effect.sync(() => leidas.push(lectura)))),
  );
  // Deja que el flujo abra la vigilancia y lea el permiso.
  yield* Effect.yieldNow;
  yield* TestClock.adjust("1 millis");
  return { leidas, fibra };
});

const motivo = (fibra: Fiber.Fiber<UbicacionNoDisponible, void>) =>
  Effect.map(Fiber.join(fibra), (error) => error.motivo);

describe("Geolocalizacion del navegador: la primera lectura", () => {
  it.effect("si el navegador no llama a nada, a los 20 s dice que no ha llegado a tiempo", () => {
    const { gps, capa } = montar("granted");
    return Effect.gen(function* () {
      const { fibra } = yield* seguir;
      yield* TestClock.adjust(ESPERA_PRIMERA_MS - 1000);
      assert.isUndefined(fibra.pollUnsafe(), "todavía espera");
      yield* TestClock.adjust(1000);
      assert.strictEqual(yield* motivo(fibra), "tiempo-agotado");
      // Y el GPS queda apagado.
      assert.strictEqual(gps.vigilancias.size, 0);
    }).pipe(Effect.provide(capa));
  });

  it.effect("la espera cuenta desde que se concede el permiso, no mientras se decide", () => {
    const { estado, capa } = montar("prompt");
    return Effect.gen(function* () {
      const { fibra } = yield* seguir;
      yield* TestClock.adjust(30_000);
      assert.isUndefined(fibra.pollUnsafe(), "el aviso del navegador sigue abierto");
      estado.cambiar("granted");
      yield* TestClock.adjust(ESPERA_PRIMERA_MS);
      assert.strictEqual(yield* motivo(fibra), "tiempo-agotado");
    }).pipe(Effect.provide(capa));
  });

  it.effect("aunque el permiso no cambie nunca, como mucho espera un minuto", () => {
    const { capa } = montar("prompt");
    return Effect.gen(function* () {
      const { fibra } = yield* seguir;
      yield* TestClock.adjust(ESPERA_MAXIMA_MS);
      assert.strictEqual(yield* motivo(fibra), "tiempo-agotado");
    }).pipe(Effect.provide(capa));
  });

  it.effect("con una lectura, aunque sea aproximada, ya no hay espera que valga", () => {
    const { gps, capa } = montar("granted");
    return Effect.gen(function* () {
      const { leidas, fibra } = yield* seguir;
      gps.responder(1500);
      yield* TestClock.adjust(ESPERA_MAXIMA_MS);
      gps.responder(12);
      yield* Effect.yieldNow;
      assert.isUndefined(fibra.pollUnsafe());
      assert.deepStrictEqual(
        leidas.map((l) => l.precision),
        [1500, 12],
      );
      // Un fallo pasajero después de la primera lectura no corta nada.
      gps.fallar(3);
      yield* Effect.yieldNow;
      assert.isUndefined(fibra.pollUnsafe());
      assert.strictEqual(gps.pedidas, 1);
    }).pipe(Effect.provide(capa));
  });

  it.effect("si se bloquea el permiso con la ubicación ya dada, falla", () => {
    const { gps, capa } = montar("granted");
    return Effect.gen(function* () {
      const { fibra } = yield* seguir;
      gps.responder(20);
      gps.fallar(1);
      assert.strictEqual(yield* motivo(fibra), "denegado");
    }).pipe(Effect.provide(capa));
  });
});

describe("Geolocalizacion del navegador: errores del navegador", () => {
  it.effect("en el móvil, sin posición es sin señal y el tiempo agotado es tiempo agotado", () =>
    Effect.gen(function* () {
      for (const [codigo, esperado] of [
        [2, "sin-senal"],
        [3, "tiempo-agotado"],
        [1, "denegado"],
      ] as const) {
        const { gps, capa } = montar("granted", "android");
        const recibido = yield* Effect.gen(function* () {
          const { fibra } = yield* seguir;
          gps.fallar(codigo);
          return yield* motivo(fibra);
        }).pipe(Effect.provide(capa));
        assert.strictEqual(recibido, esperado, `código ${codigo}`);
      }
    }),
  );

  it.effect("en un ordenador, sin posición o sin respuesta es que no tiene de dónde sacarla", () =>
    Effect.gen(function* () {
      for (const codigo of [2, 3] as const) {
        const { gps, capa } = montar("granted", "ordenador");
        const recibido = yield* Effect.gen(function* () {
          const { fibra } = yield* seguir;
          gps.fallar(codigo);
          return yield* motivo(fibra);
        }).pipe(Effect.provide(capa));
        assert.strictEqual(recibido, "sin-fuente", `código ${codigo}`);
      }
      // Y si el navegador no llama a nada, lo mismo.
      const { capa } = montar("granted", "ordenador");
      const callado = yield* Effect.gen(function* () {
        const { fibra } = yield* seguir;
        yield* TestClock.adjust(ESPERA_PRIMERA_MS);
        return yield* motivo(fibra);
      }).pipe(Effect.provide(capa));
      assert.strictEqual(callado, "sin-fuente");
    }),
  );

  it.effect("sin https no pide nada y dice que el navegador no la da", () => {
    const gps = new GpsDePrueba();
    const capa = geolocalizacionDelNavegador(
      { geolocation: gps, permissions: new PermisosDePrueba(new PermisoDePrueba("granted")) },
      "android",
      false,
    );
    return Effect.gen(function* () {
      const { fibra } = yield* seguir;
      assert.strictEqual(yield* motivo(fibra), "no-disponible");
      assert.strictEqual(gps.pedidas, 0);
    }).pipe(Effect.provide(capa));
  });
});

describe("Geolocalizacion del navegador: apagar y volver a encender", () => {
  it.effect("dejar de seguir apaga el GPS, y volver a seguir abre otra vigilancia que lee", () => {
    const { gps, capa } = montar("granted");
    return Effect.gen(function* () {
      const primera = yield* seguir;
      gps.responder(20);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(primera.fibra);
      assert.strictEqual(gps.vigilancias.size, 0);

      const segunda = yield* seguir;
      assert.strictEqual(gps.pedidas, 2);
      gps.responder(15);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(
        segunda.leidas.map((l) => l.precision),
        [15],
      );
      // La primera sesión no recibe nada más.
      assert.deepStrictEqual(
        primera.leidas.map((l) => l.precision),
        [20],
      );
    }).pipe(Effect.provide(capa));
  });
});
