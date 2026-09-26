import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flush } from "solid-js";

import { App } from "./App.tsx";
import { fichasDePrueba } from "./ficha/pruebas.ts";
import { capaDePrueba } from "./capa/pruebas.ts";
import { navegar, ruta } from "./lib/rutas.ts";

const esperarAjuste = () => new Promise<void>((resolver) => queueMicrotask(resolver));

describe("App", () => {
  // happy-dom no tiene WebGL: es el caso de un navegador que no puede dibujar el mapa.
  it("dice por qué no hay mapa en lugar de dejar el lienzo vacío", async () => {
    navegar(ruta.mapa, { reemplazar: true });
    const { getByRole, findByRole } = render(() => (
      <App servicios={Layer.merge(capaDePrueba([Effect.never]), fichasDePrueba().capa)} />
    ));
    flush();
    await esperarAjuste();

    const aviso = await findByRole("alert");
    assert.match(aviso.textContent ?? "", /no puede dibujar el mapa/u);
    assert.match(aviso.textContent ?? "", /WebGL/u);

    const acercar = getByRole("button", { name: "Acercar" });
    assert.isTrue(acercar instanceof HTMLButtonElement && acercar.disabled);
    assert.strictEqual(getByRole("main").getAttribute("aria-label"), "Mapa de Barcelona");
    assert.strictEqual(document.title, "Mapa de Barcelona · Celda");
  });

  it("una dirección que no existe lleva de vuelta al mapa", () => {
    navegar("/no-existe", { reemplazar: true });
    const { getByRole } = render(() => (
      <App servicios={Layer.merge(capaDePrueba([Effect.never]), fichasDePrueba().capa)} />
    ));
    flush();

    assert.match(getByRole("alert").textContent ?? "", /\/no-existe/u);
    assert.strictEqual(
      getByRole("link", { name: "Volver al mapa" }).getAttribute("href"),
      ruta.mapa,
    );
  });
});
