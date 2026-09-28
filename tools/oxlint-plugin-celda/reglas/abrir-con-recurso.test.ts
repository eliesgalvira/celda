import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../pruebas/arnes.ts";

const regla = createOxlintRuleHarness("celda/abrir-con-recurso", { filename: "fixture.tsx" });

describe("celda/abrir-con-recurso", () => {
  regla.valid(
    "deja abrir con recurso() y recursoFijo()",
    `
      import { recurso, recursoFijo } from "@celda/ui/recurso.ts";
      import { createSignal } from "solid-js";

      const [encendido] = createSignal(false);
      recurso("gps", encendido, () => {
        const vigilancia = navigator.geolocation.watchPosition(() => undefined);
        return () => navigator.geolocation.clearWatch(vigilancia);
      });
      recursoFijo("ventana", () => {
        const medir = () => undefined;
        window.addEventListener("resize", medir);
        const espera = setTimeout(medir, 100);
        return () => {
          clearTimeout(espera);
          window.removeEventListener("resize", medir);
        };
      });
    `,
  );

  regla.valid(
    "deja que los efectos escriban el DOM, el mapa o señales",
    `
      import { createEffect, createSignal, onSettled } from "solid-js";

      declare const mapa: { getSource(id: string): { setData(d: number): void } | undefined; jumpTo(c: number): void };
      const [n, setN] = createSignal(0);
      createEffect(n, (valor) => {
        document.title = String(valor);
        mapa.getSource("celdas")?.setData(valor);
        mapa.jumpTo(valor);
        setN(valor);
      });
      onSettled(() => {
        document.body.focus();
      });
    `,
  );

  regla.valid(
    "deja abrir en la primera función, en manejadores y en refs",
    `
      import { createEffect, createSignal } from "solid-js";

      const [n] = createSignal(0);
      createEffect(() => n(), () => undefined);
      export const alPulsar = () => {
        setTimeout(() => undefined, 10);
        void fetch("/capas/vigente.json");
      };
      export const Caja = () => (
        <div ref={(el) => el.addEventListener("keydown", () => undefined)} />
      );
    `,
  );

  regla.invalid(
    "rechaza abrir el GPS en la segunda función de createEffect",
    `
      import { createEffect, createSignal } from "solid-js";

      const [encendido] = createSignal(false);
      createEffect(encendido, (activo) => {
        if (!activo) return;
        const vigilancia = navigator.geolocation.watchPosition(() => undefined);
        return () => navigator.geolocation.clearWatch(vigilancia);
      });
    `,
    (salida) => {
      assert.match(salida, /watchPosition/u);
      assert.match(salida, /recurso\(\)/u);
    },
  );

  regla.invalid(
    "rechaza escuchadores de la ventana y del mapa en createEffect",
    `
      import { createEffect, createSignal } from "solid-js";

      declare const mapa: { on(e: string, f: () => void): void; off(e: string, f: () => void): void };
      const [n] = createSignal(0);
      createEffect(n, () => {
        const alMover = () => undefined;
        window.addEventListener("resize", alMover);
        mapa.on("move", alMover);
        return () => mapa.off("move", alMover);
      });
    `,
    (salida) => {
      assert.match(salida, /addEventListener/u);
      assert.match(salida, /`on`/u);
    },
  );

  regla.invalid(
    "rechaza temporizadores y fotogramas en onSettled, también dentro de otra función",
    `
      import { onSettled } from "solid-js";

      onSettled(() => {
        const latir = () => {
          requestAnimationFrame(latir);
        };
        const reloj = window.setInterval(latir, 1000);
        return () => clearInterval(reloj);
      });
    `,
    (salida) => {
      assert.match(salida, /requestAnimationFrame/u);
      assert.match(salida, /setInterval/u);
      assert.match(salida, /recursoFijo\(\)/u);
    },
  );

  regla.invalid(
    "rechaza Workers, observadores, peticiones e IndexedDB",
    `
      import { createEffect, createSignal, onSettled } from "solid-js";

      const [n] = createSignal(0);
      createEffect(n, () => {
        const worker = new Worker("/w.js");
        worker.postMessage(1);
        new ResizeObserver(() => undefined).observe(document.body);
      });
      onSettled(() => {
        void fetch("/capas/vigente.json");
        indexedDB.open("celda");
      });
    `,
    (salida) => {
      for (const apertura of [
        "new Worker",
        "postMessage",
        "new ResizeObserver",
        "fetch",
        "indexedDB.open",
      ]) {
        assert.include(salida, apertura);
      }
    },
  );

  regla.invalid(
    "rechaza ejecutar Effect desde un efecto, también con { effect, error }",
    `
      import { createEffect, createSignal } from "solid-js";

      declare const datos: { runPromiseExit(e: unknown): Promise<unknown>; runFork(e: unknown): void };
      const [n] = createSignal(0);
      createEffect(n, {
        effect: () => {
          void datos.runPromiseExit(n());
        },
        error: () => undefined,
      });
      createEffect(n, () => datos.runFork(n()));
    `,
    (salida) => {
      assert.match(salida, /runPromiseExit/u);
      assert.match(salida, /runFork/u);
    },
  );
});
