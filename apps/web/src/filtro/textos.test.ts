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
      detalleDelAviso(["digi"]),
      "La red de Movistar que usa Digi sale más clara.",
    );
    assert.strictEqual(
      detalleDelAviso(["digi", "yoigo"]),
      "Las redes de Movistar y Orange que usan Digi y Yoigo salen más claras.",
    );
    assert.strictEqual(
      detalleDelAviso(["yoigo"]),
      "La red de Orange que usa Yoigo sale más clara.",
    );
  });

  it("sin nada que sorprenda, no añaden ninguna línea", () => {
    assert.isUndefined(detalleDelAviso(["movistar"]));
    assert.isUndefined(detalleDelAviso(["movistar", "digi"]));
  });

  it("no hablan de cómo se calcula", () => {
    const todos = [
      estadoDelFiltro([]),
      estadoDelFiltro(["digi"]),
      detalleDelAviso(["digi"]) ?? "",
    ].join(" ");
    assert.notMatch(todos, /roaming|itinerancia|máscara|resumen|capa|filtro de compañías|Worker/iu);
  });
});
