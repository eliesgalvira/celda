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
      "La red de Movistar que usa Digi sale más clara.",
    );
    assert.strictEqual(
      detalleDelAviso(["digi", "yoigo"], false),
      "Las redes de Movistar y Orange que usan Digi y Yoigo salen más claras.",
    );
    assert.strictEqual(
      notaDelFiltro(["digi", "yoigo"]),
      "Los emplazamientos de Movistar y Orange salen más claros, con sus celdas, porque Digi usa la de Movistar y Yoigo usa la de Orange donde no tienen la suya. Cerca de un emplazamiento propio, el móvil suele conectarse a él aunque haya otro más cerca.",
    );
    assert.strictEqual(
      notaDelFiltro(["digi"]),
      "Los emplazamientos de Movistar salen más claros, con sus celdas, porque Digi usa su red donde no tiene la suya. Cerca de uno de Digi, el móvil suele conectarse a él aunque haya otro de Movistar más cerca.",
    );
    assert.isUndefined(detalleDelAviso(["movistar", "digi"], false));
    assert.match(
      notaDelFiltro(["yoigo"]),
      /^Los emplazamientos de Orange salen más claros, con sus celdas, porque Yoigo usa su red/u,
    );
  });

  it("con datos de antes, de lejos, dicen que los números aún son de todas", () => {
    assert.strictEqual(
      detalleDelAviso(["vodafone"], true),
      "Con el mapa alejado, los números aún cuentan todas las compañías. Acerca el mapa para ver solo Vodafone.",
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
