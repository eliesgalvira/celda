import { assert, describe, it } from "@effect/vitest";

import { conLogo, conservarVariantes, hayPrototipo, logoDe } from "./variantes.ts";

const busqueda = (texto: string) => new URLSearchParams(texto);

describe("versiones del logo (prototipo)", () => {
  it("sin parámetro es la marca vigente y no hay barra", () => {
    assert.isFalse(hayPrototipo(busqueda("?emplazamiento=movistar-1")));
    assert.strictEqual(logoDe(busqueda("")), "B");
  });

  it("logo elige la versión, sin distinguir mayúsculas, y un valor desconocido no cuenta", () => {
    assert.strictEqual(logoDe(busqueda("?logo=b2")), "B2");
    assert.isTrue(hayPrototipo(busqueda("?logo=B")));
    assert.isFalse(hayPrototipo(busqueda("?logo=A")));
    assert.strictEqual(logoDe(busqueda("?logo=A")), "B");
  });

  it("la barra escribe el logo y deja el resto de la URL", () => {
    assert.strictEqual(
      conLogo({ pathname: "/", search: busqueda("?logo=B1&medir") }, "B3"),
      "/?logo=B3&medir",
    );
  });

  it("al navegar se conserva el logo, salvo si la dirección nueva ya lo dice", () => {
    const actual = busqueda("?logo=B2&emplazamiento=x");
    assert.strictEqual(
      conservarVariantes(actual, "/?emplazamiento=movistar-1"),
      "/?emplazamiento=movistar-1&logo=B2",
    );
    assert.strictEqual(conservarVariantes(actual, "/?ajustes"), "/?ajustes&logo=B2");
    assert.strictEqual(conservarVariantes(actual, "/"), "/?logo=B2");
    assert.strictEqual(conservarVariantes(actual, "/?logo=B1"), "/?logo=B1");
    assert.strictEqual(conservarVariantes(busqueda(""), "/?medir"), "/?medir");
  });
});
