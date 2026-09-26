import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { Etiqueta } from "./Etiqueta.tsx";

describe("Etiqueta de estado", () => {
  it("dice el estado con palabras y lleva su tono, también al cambiar de emplazamiento", () => {
    const [estado, setEstado] = createSignal<"verificado" | "corregido" | "nuevo">("verificado");
    const nombres = { verificado: "Verificado", corregido: "Corregido", nuevo: "Nuevo" };
    const { getByText } = render(() => <Etiqueta tono={estado()}>{nombres[estado()]}</Etiqueta>);

    for (const siguiente of ["corregido", "nuevo", "verificado"] as const) {
      setEstado(siguiente);
      flush();
      const etiqueta = getByText(nombres[siguiente]);
      assert.strictEqual(etiqueta.getAttribute("data-tono"), siguiente);
      // El color no es lo único que distingue el estado: el texto lo dice.
      assert.strictEqual(etiqueta.textContent, nombres[siguiente]);
    }
  });
});
