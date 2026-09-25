import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

/**
 * Adelanta el `TestClock` de segundo en segundo hasta que la fibra termina, como mucho
 * `segundos`. Sirve para esperas encadenadas que se programan después de una respuesta
 * asíncrona, que un solo `TestClock.adjust` no llegaría a ver.
 */
export const esperarConReloj = <A, E>(fibra: Fiber.Fiber<A, E>, segundos = 1800) =>
  Effect.gen(function* () {
    for (let paso = 0; paso < segundos && fibra.pollUnsafe() === undefined; paso++) {
      yield* TestClock.adjust("1 second");
    }
    return yield* Fiber.join(fibra);
  });
