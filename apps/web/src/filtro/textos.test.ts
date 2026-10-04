import { assert, describe, it } from "@effect/vitest";

import { detalleDelAviso, estadoDelFiltro, notaDelFiltro, textoDelAviso } from "./textos.ts";

describe("textos del filtro de compañías (ADR 0026)", () => {
  it("dicen qué se ve, en castellano llano", () => {
    assert.strictEqual(estadoDelFiltro([]), "Se ven los emplazamientos de todas las compañías.");
    assert.strictEqual(
      estadoDelFiltro(["movistar", "vodafone"]),
      "Se ven solo los emplazamientos de Movistar y Vodafone.",
    );
    assert.strictEqual(textoDelAviso(["movistar"]), "Solo Movistar");
  });

  it("explican qué sale aparte cuando una compañía usa la red de otra", () => {
    assert.strictEqual(
      detalleDelAviso(["digi"], false),
      "Más claros: la red de Movistar, que usa Digi.",
    );
    assert.strictEqual(
      detalleDelAviso(["digi", "yoigo"], false),
      "Más claros: las redes de Movistar y Orange, que usan Digi y Yoigo.",
    );
    assert.strictEqual(
      notaDelFiltro(["digi", "yoigo"]),
      "Más claros, los de Movistar y Orange: Digi usa la de Movistar y Yoigo usa la de Orange donde no tienen la suya.",
    );
    assert.isUndefined(detalleDelAviso(["movistar", "digi"], false));
    assert.match(notaDelFiltro(["yoigo"]), /^Más claros, los de Orange: Yoigo usa su red/u);
  });

  it("con datos de antes, de lejos, dicen que los números aún son de todas", () => {
    assert.strictEqual(
      detalleDelAviso(["vodafone"], true),
      "De lejos aún se cuentan todas las compañías: acércate para ver solo Vodafone.",
    );
  });

  it("no hablan de cómo se calcula", () => {
    const todos = [
      estadoDelFiltro([]),
      notaDelFiltro([]),
      notaDelFiltro(["movistar"]),
      notaDelFiltro(["digi"]),
      detalleDelAviso(["digi"], true) ?? "",
    ].join(" ");
    assert.notMatch(todos, /roaming|itinerancia|máscara|resumen|capa|filtro de compañías|Worker/iu);
  });
});
