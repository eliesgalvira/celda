import { describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../pruebas/arnes.ts";

const espera = createOxlintRuleHarness("landmines-testing/no-fixed-sleep");
const reintentos = createOxlintRuleHarness("landmines-testing/no-flake-masking");
const sondeo = createOxlintRuleHarness("landmines-testing/no-unsignaled-poll");

describe("landmines-testing", () => {
  espera.invalid(
    "rechaza una espera fija dentro de un hook",
    `beforeEach(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });`,
  );
  espera.invalid(
    "reconoce un ayudante local que solo espera al temporizador",
    `const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));
     it("carga", async () => { await dormir(100); });`,
  );
  espera.invalid(
    "reconoce los temporizadores de Node importados con otro nombre",
    `import { setTimeout as dormir } from "node:timers/promises";
     it("carga", async () => { await dormir(100); });`,
  );
  espera.invalid(
    "rechaza una espera de Effect con el reloj real dentro de un ayudante",
    `const esperar = Effect.gen(function* () {
       yield* TestClock.withLive(Effect.sleep("10 millis"));
     });`,
  );
  espera.invalid(
    "rechaza una espera de Effect dentro de it.live",
    `it.live("carga", () => Effect.gen(function* () { yield* Effect.sleep("10 millis"); }));`,
  );
  espera.invalid(
    "reconoce los modificadores de it.live",
    `it.live.only("carga", () => Effect.gen(function* () { yield* Effect.sleep("10 millis"); }));`,
  );
  espera.invalid(
    "reconoce las pruebas live parametrizadas",
    `it.live.each([1, 2])("carga %s", () => Effect.gen(function* () { yield* Effect.sleep("10 millis"); }));`,
  );
  espera.invalid(
    "un test con temporizadores falsos no oculta la espera real de otro",
    `it("virtual", () => { vi.useFakeTimers(); });
     it("real", async () => { await new Promise(resolve => setTimeout(resolve, 100)); });`,
  );
  espera.invalid(
    "restaurar el reloj real no permite una espera fija",
    `it("carga", async () => {
       vi.useFakeTimers();
       vi.useRealTimers();
       await new Promise(resolve => setTimeout(resolve, 100));
     });`,
  );
  espera.valid(
    "permite mover el reloj virtual y esperar una señal",
    `it.effect("carga", () => Effect.gen(function* () {
       const fibra = yield* Effect.forkChild(Effect.sleep("1 second"));
       yield* TestClock.adjust("1 second");
       yield* Fiber.join(fibra);
       yield* Deferred.await(lista);
     }));`,
  );
  espera.valid(
    "permite avanzar los temporizadores de prueba",
    `it("tiempo", async () => {
       vi.useFakeTimers();
       const lista = new Promise(resolve => setTimeout(resolve, 10));
       await vi.advanceTimersByTimeAsync(10);
       await lista;
     });`,
  );
  reintentos.invalid("rechaza reintentar un test", `it("carga", { retry: 2 }, () => {});`);
  reintentos.invalid("rechaza un plazo posicional", `it.effect("carga", () => trabajo, 30000);`);
  reintentos.invalid(
    "rechaza un plazo en las opciones",
    `it("carga", { timeout: 30000 }, () => {});`,
  );
  reintentos.invalid(
    "rechaza cambiar el plazo en ejecución",
    `vi.setConfig({ testTimeout: 30000 });`,
  );
  for (const propiedad of ["testTimeout", "hookTimeout", "retry"]) {
    reintentos.invalid(
      `rechaza ${propiedad} en la configuración de vp`,
      `export default defineConfig({ test: { ${propiedad}: 30000 } });`,
    );
  }
  reintentos.valid("permite el plazo por defecto", `it("carga", () => {});`);
  sondeo.invalid(
    "rechaza sondear las peticiones grabadas",
    `await expect.poll(() => peticiones.length).toBe(1);`,
  );
  sondeo.invalid(
    "rechaza esperar sondeando un espía",
    `await vi.waitFor(() => expect(enviar).toHaveBeenCalled());`,
  );
  sondeo.valid(
    "permite esperar la señal que entrega el manejador",
    `await recibida.promise; expect(peticiones).toHaveLength(1);`,
  );

  for (const [nombre, infraccion] of Object.entries({
    "no-fixed-sleep": `it("carga", async () => { await new Promise(resolve => setTimeout(resolve, 1)); });`,
    "no-flake-masking": `it("carga", { timeout: 30000 }, () => {});`,
    "no-unsignaled-poll": `expect.poll(() => peticiones.length).toBe(1);`,
  })) {
    const regla = createOxlintRuleHarness(`landmines-testing/${nombre}`, {
      filename: "heredado.test.ts",
      ruleOptions: { allow: { "heredado.test.ts": 1 } },
    });
    regla.valid(`${nombre}: admite el recuento exacto heredado`, infraccion);
    regla.invalid(`${nombre}: rechaza una infracción más`, `${infraccion}\n${infraccion}`);
    regla.invalid(`${nombre}: exige bajar la excepción cuando desaparece`, `export {};`);
  }
});
