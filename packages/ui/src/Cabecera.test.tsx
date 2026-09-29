import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { Cabecera } from "./Cabecera.tsx";

describe("Cabecera", () => {
  it("dice el nombre de Celda y el lugar, sin tapar los gestos del mapa", () => {
    const { getByRole, getByText } = render(() => <Cabecera lugar="España" />);
    flush();
    const cabecera = getByRole("banner");
    assert.match(cabecera.className, /\bpointer-events-none\b/u);
    assert.strictEqual(getByRole("heading", { level: 1 }).textContent, "CELDA");
    assert.isNotNull(getByText("España"));
  });

  it("al cambiar de lugar cambia el texto y no la caja: ancho fijo y una sola línea", () => {
    const [lugar, setLugar] = createSignal("España");
    const { getByText } = render(() => <Cabecera lugar={lugar()} />);
    flush();
    const antes = getByText("España");
    const clases = antes.className;
    assert.match(clases, /\btruncate\b/u);
    assert.match(clases, /(^|\s)w-\d+(\s|$)/u);
    assert.match(clases, /(^|\s)md:w-\d+(\s|$)/u);
    setLugar("San Bartolomé de Tirajana");
    flush();
    const despues = getByText("San Bartolomé de Tirajana");
    assert.strictEqual(despues, antes);
    assert.strictEqual(despues.className, clases);
  });
});
