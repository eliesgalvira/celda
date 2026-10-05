import { assert, describe, it } from "@effect/vitest";

import { detalleDelAviso, estadoDelFiltro, textoDelAviso } from "./textos.ts";

describe("textos del filtro de compañías (ADR 0026)", () => {
  it("dicen qué se ve, en castellano llano", () => {
    assert.strictEqual(estadoDelFiltro([]), "Se ven los emplazamientos de todas las compañías.");
    assert.strictEqual(
      estadoDelFiltro(["movistar", "vodafone"]),
      "Se ven solo los emplazamientos de Movistar y Vodafone.",
    );
    assert.strictEqual(textoDelAviso(["movistar"]), "Solo Movistar");
  });

  it("dicen en una línea qué sale más claro cuando una compañía usa la red de otra", () => {
    assert.strictEqual(
      detalleDelAviso(["digi"], false),
      "La red de Movistar que usa Digi sale más clara.",
    );
    assert.strictEqual(
      detalleDelAviso(["digi", "yoigo"], false),
      "Las redes de Movistar y Orange que usan Digi y Yoigo salen más claras.",
    );
    assert.strictEqual(
      detalleDelAviso(["yoigo"], false),
      "La red de Orange que usa Yoigo sale más clara.",
    );
  });

  it("sin nada que sorprenda, no añaden ninguna línea", () => {
    assert.isUndefined(detalleDelAviso(["movistar"], false));
    assert.isUndefined(detalleDelAviso(["movistar", "digi"], false));
  });

  it("con datos de antes, de lejos, dicen en corto que los números aún son de todas", () => {
    assert.strictEqual(
      detalleDelAviso(["vodafone"], true),
      "Los números de lejos incluyen todas las compañías.",
    );
  });

  it("no hablan de cómo se calcula", () => {
    const todos = [
      estadoDelFiltro([]),
      estadoDelFiltro(["digi"]),
      detalleDelAviso(["digi"], false) ?? "",
      detalleDelAviso(["digi"], true) ?? "",
    ].join(" ");
    assert.notMatch(todos, /roaming|itinerancia|máscara|resumen|capa|filtro de compañías|Worker/iu);
  });
});
