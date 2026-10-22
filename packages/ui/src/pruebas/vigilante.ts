/**
 * Se carga antes de cada fichero de pruebas (`setupFiles` en `vite.config.ts`).
 *
 * - Una prueba en la que algún recurso se ha abierto más veces por segundo de las normales falla,
 *   aunque lo que comprueba salga bien: es un efecto que se reabre en bucle (ver `recurso.ts`).
 * - Una prueba en la que Solid avisa `STRICT_READ_UNTRACKED` falla: algo lee una señal donde no
 *   la sigue (el cuerpo de un componente, la segunda función de un efecto) y no dice si es a
 *   propósito. Si lo es, la lectura va en `untrack`.
 * - Cada prueba desmonta lo que ha montado. `@solidjs/testing-library` solo lo hace sola con los
 *   globales de Vitest, que aquí no están; sin esto, las apps de las pruebas anteriores seguían
 *   montadas, con sus recursos abiertos, y reaccionaban a la dirección de la siguiente.
 */
import { afterEach, beforeEach } from "@effect/vitest";
import { cleanup } from "@solidjs/testing-library";
import { OBSERVE } from "solid-js";

import { vigilante } from "../recurso.ts";

/** Los avisos de Solid desde que empezó la prueba en curso. Solo existe con el Solid de desarrollo. */
export const avisosDeSolid = OBSERVE?.diagnostics.capture();

beforeEach(() => {
  vigilante.reiniciar();
  avisosDeSolid?.clear();
});

afterEach(() => {
  cleanup();
  const excesos = vigilante.excesos();
  vigilante.reiniciar();
  const sinSeguir = (avisosDeSolid?.events ?? []).filter(
    (aviso) => aviso.code === "STRICT_READ_UNTRACKED",
  );
  avisosDeSolid?.clear();
  if (excesos.length > 0) {
    throw new Error(
      `Recursos abiertos en bucle: ${excesos
        .map((e) => `«${e.nombre}» ${e.veces} veces en un segundo (tope ${e.maximo})`)
        .join(", ")}`,
    );
  }
  if (sinSeguir.length > 0) {
    throw new Error(
      `Lecturas que Solid no sigue: ${sinSeguir
        .map((aviso) => `en ${aviso.ownerPath?.join(" › ") ?? String(aviso.data?.["strictRead"])}`)
        .join(", ")}. Ver docs/patterns/efectos.md.`,
    );
  }
});
