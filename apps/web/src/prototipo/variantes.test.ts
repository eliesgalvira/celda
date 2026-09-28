import { assert, describe, it } from "@effect/vitest";

import {
  controlesDe,
  conservarVariantes,
  conVariantes,
  hayPrototipo,
  logoDe,
} from "./variantes.ts";

const busqueda = (texto: string) => new URLSearchParams(texto);

describe("variantes del prototipo", () => {
  it("sin parámetros es lo de hoy y no hay barra", () => {
    assert.isFalse(hayPrototipo(busqueda("?emplazamiento=movistar-1")));
    assert.strictEqual(logoDe(busqueda("")), "actual");
    assert.strictEqual(controlesDe(busqueda("")), "actual");
  });

  it("variante pone las dos, y logo y controles ganan a variante", () => {
    assert.strictEqual(logoDe(busqueda("?variante=b")), "B");
    assert.strictEqual(controlesDe(busqueda("?variante=B")), "B");
    const mezcla = busqueda("?variante=A&controles=C");
    assert.strictEqual(logoDe(mezcla), "A");
    assert.strictEqual(controlesDe(mezcla), "C");
  });

  it("hoy enseña lo de hoy con la barra, y un valor desconocido no cuenta", () => {
    const hoy = busqueda("?logo=hoy");
    assert.isTrue(hayPrototipo(hoy));
    assert.strictEqual(logoDe(hoy), "actual");
    assert.isFalse(hayPrototipo(busqueda("?variante=Z")));
    assert.strictEqual(logoDe(busqueda("?variante=Z")), "actual");
  });

  it("la barra escribe logo y controles y deja el resto de la URL", () => {
    assert.strictEqual(
      conVariantes(
        { pathname: "/", search: busqueda("?variante=A&medir") },
        { logo: "C", controles: "actual" },
      ),
      "/?medir&logo=C&controles=hoy",
    );
  });

  it("al navegar se conservan las variantes, salvo si la dirección nueva ya las dice", () => {
    const actual = busqueda("?variante=B&emplazamiento=x");
    assert.strictEqual(
      conservarVariantes(actual, "/?emplazamiento=movistar-1"),
      "/?emplazamiento=movistar-1&variante=B",
    );
    assert.strictEqual(conservarVariantes(actual, "/?ajustes"), "/?ajustes&variante=B");
    assert.strictEqual(conservarVariantes(actual, "/"), "/?variante=B");
    assert.strictEqual(conservarVariantes(actual, "/?logo=A"), "/?logo=A");
    assert.strictEqual(conservarVariantes(busqueda(""), "/?medir"), "/?medir");
  });
});
