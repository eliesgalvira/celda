import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { createOxlintRuleHarness } from "../pruebas/arnes.ts";
import { colorSuelto } from "./sin-estilos-a-medida.ts";

const enLaApp = createOxlintRuleHarness("celda/sin-estilos-a-medida", {
  filename: "apps/web/src/Pantalla.tsx",
});

const enLaLibreria = createOxlintRuleHarness("celda/sin-estilos-a-medida", {
  filename: "packages/ui/src/Boton.tsx",
});

describe("celda/sin-estilos-a-medida fuera de la librería", () => {
  enLaApp.valid(
    "acepta componentes y variantes de @celda/ui",
    `
      import { Boton } from "@celda/ui/Boton.tsx";
      import { variantesBoton } from "@celda/ui/variantes.ts";

      export const Pantalla = () => (
        <>
          <Boton variante="primario">Guardar</Boton>
          <a href="/" class={variantesBoton({ variante: "secundario" })}>Volver</a>
        </>
      );
    `,
  );

  enLaApp.valid(
    "acepta la hoja del tema de la librería",
    `
      import "@celda/ui/tema.css";
    `,
  );

  enLaApp.invalid(
    "rechaza un estilo en línea",
    `
      export const Pantalla = () => <div style={{ color: "red" }}>Hola</div>;
    `,
    (salida) => assert.match(salida, /estilos en línea/),
  );

  enLaApp.invalid(
    "rechaza una clase escrita a mano",
    `
      export const Pantalla = () => <div class="flex gap-2">Hola</div>;
    `,
    (salida) => assert.match(salida, /solo pueden venir de la librería/),
  );

  enLaApp.invalid(
    "rechaza className con una expresión que no sale de la librería",
    `
      const propia = () => "p-4";
      export const Pantalla = () => <div className={propia()}>Hola</div>;
    `,
  );

  enLaApp.invalid(
    "rechaza un color hexadecimal suelto",
    `
      export const fondo = "#e4e1da";
    `,
    (salida) => assert.match(salida, /Color suelto/),
  );

  enLaApp.invalid(
    "rechaza un color OKLCH dentro de una plantilla",
    `
      const claridad = 0.5;
      export const tinta = \`oklch(\${claridad} 0.02 90)\`;
    `,
  );

  enLaApp.invalid(
    "rechaza una clase de la paleta de Tailwind aunque venga de una variable",
    `
      export const aviso = "bg-red-500 text-white";
    `,
  );

  enLaApp.invalid(
    "rechaza una hoja de estilo propia",
    `
      import "./pantalla.css";
    `,
    (salida) => assert.match(salida, /hojas de estilo/),
  );
});

describe("celda/sin-estilos-a-medida dentro de la librería", () => {
  enLaLibreria.valid(
    "deja a packages/ui escribir clases y estilos",
    `
      export const Boton = () => <button class="h-11 px-4" style={{ "clip-path": "var(--hexagono)" }} />;
    `,
  );
});

describe("colorSuelto", () => {
  it("reconoce los colores sueltos y deja pasar el texto normal", () => {
    assert.deepStrictEqual(colorSuelto("#fff"), Option.some("#fff"));
    assert.deepStrictEqual(colorSuelto("bg-[#2f7f86]"), Option.some("[#2f7f86]"));
    assert.deepStrictEqual(colorSuelto("rgb(0 0 0)"), Option.some("rgb("));
    assert.deepStrictEqual(colorSuelto("hover:text-sky-600"), Option.some("text-sky-600"));
    assert.isTrue(Option.isNone(colorSuelto("#mapa")));
    assert.isTrue(Option.isNone(colorSuelto("text-tinta bg-superficie")));
    assert.isTrue(Option.isNone(colorSuelto("Colaboración (con datos)")));
  });
});
