/**
 * Se carga antes de cada fichero de pruebas (`setupFiles` en `vite.config.ts`). Una prueba en la
 * que algún recurso se ha abierto más veces por segundo de las normales falla, aunque lo que
 * comprueba salga bien: es un efecto que se reabre en bucle (ver `recurso.ts`).
 */
import { afterEach, beforeEach } from "@effect/vitest";

import { vigilante } from "../recurso.ts";

beforeEach(() => {
  vigilante.reiniciar();
});

afterEach(() => {
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
