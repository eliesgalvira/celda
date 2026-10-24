import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";

import { ConflictosFicha, ContrasteFicha } from "./Correccion.tsx";

describe("ContrasteFicha", () => {
  it("enseña lo que dice cada fuente con su fecha y un enlace con nombre a cada una", () => {
    const { getByRole, getByText } = render(() => (
      <ContrasteFicha
        tono="corregido"
        compania="vodafone"
        nombre="Vodafone"
        oficial={{
          fuente: "Registro oficial",
          dice: "La tiene dada de alta",
          fecha: "desde el 26 sept 2026",
          enlace: "https://geoportal.minetur.gob.es/x",
          textoEnlace: "Ver en el registro oficial",
        }}
        comunidad={{
          fuente: "Comunidad de Celda",
          dice: "La da por desmontada",
          fecha: "desde el 27 sept 2026",
          enlace: "https://comunidad.example/correccion/1",
          textoEnlace: "Ver la corrección",
        }}
      />
    ));

    const lista = getByText("La tiene dada de alta").closest("dl");
    assert.strictEqual(lista?.getAttribute("aria-label"), "¿Qué dice cada fuente de Vodafone?");
    assert.isNotNull(getByText("La tiene dada de alta"));
    assert.isNotNull(getByText("desde el 27 sept 2026"));
    const comunidad = getByRole("link", { name: /Ver la corrección/u });
    assert.strictEqual(comunidad.getAttribute("href"), "https://comunidad.example/correccion/1");
    assert.strictEqual(comunidad.getAttribute("target"), "_blank");
    assert.strictEqual(
      getByText("La da por desmontada").closest("[data-tono]")?.getAttribute("data-tono"),
      "corregido",
    );
  });

  it("sin enlace ni fecha, el lado del registro solo dice que no la tiene", () => {
    const { queryAllByRole, getByText } = render(() => (
      <ContrasteFicha
        tono="nuevo"
        compania="movistar"
        nombre="Movistar"
        oficial={{ fuente: "Registro oficial", dice: "No la tiene" }}
        comunidad={{
          fuente: "Comunidad de Celda",
          dice: "La sitúa aquí",
          fecha: "desde el 27 sept 2026",
          enlace: "https://comunidad.example/correccion/2",
          textoEnlace: "Ver la corrección",
        }}
      />
    ));
    assert.lengthOf(queryAllByRole("link"), 1);
    assert.strictEqual(
      getByText("No la tiene").closest("[data-tono]")?.getAttribute("data-tono"),
      "oficial",
    );
  });
});

describe("ConflictosFicha", () => {
  it("enumera todos los conflictos en una lista con nombre", () => {
    const { getByRole } = render(() => <ConflictosFicha conflictos={["Uno.", "Dos."]} />);
    const lista = getByRole("list", { name: "Conflictos entre fuentes" });
    assert.deepStrictEqual(
      Array.from(lista.children, (li) => li.textContent),
      ["Uno.", "Dos."],
    );
  });
});
