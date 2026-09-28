/**
 * Se carga antes de cada fichero de pruebas (`setupFiles` en `vite.config.ts`).
 *
 * - Una prueba en la que algún recurso se ha abierto más veces por segundo de las normales falla,
 *   aunque lo que comprueba salga bien: es un efecto que se reabre en bucle (ver `recurso.ts`).
 * - Cada prueba desmonta lo que ha montado. `@solidjs/testing-library` solo lo hace sola con los
 *   globales de Vitest, que aquí no están; sin esto, las apps de las pruebas anteriores seguían
 *   montadas, con sus recursos abiertos, y reaccionaban a la dirección de la siguiente.
 */
import { afterEach, beforeEach } from "@effect/vitest";
import { cleanup } from "@solidjs/testing-library";

import { vigilante } from "../recurso.ts";

beforeEach(() => {
  vigilante.reiniciar();
});

afterEach(() => {
  cleanup();
  const excesos = vigilante.excesos();
  vigilante.reiniciar();
  if (excesos.length > 0) {
    throw new Error(
      `Recursos abiertos en bucle: ${excesos
        .map((e) => `«${e.nombre}» ${e.veces} veces en un segundo (tope ${e.maximo})`)
        .join(", ")}`,
    );
  }
});
