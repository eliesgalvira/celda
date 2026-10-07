import { assert, describe, it } from "@effect/vitest";

import { desdeDelOrigen } from "./ficha.ts";

const DIA = 86_400_000;
const NOCHE = Date.UTC(2026, 9, 1, 2, 15);

describe("desde cuándo dice la fuente lo que dice (ADR 0027)", () => {
  it("sin hechos, como en un origen de la comunidad, es desde la fecha del origen", () => {
    assert.deepStrictEqual(desdeDelOrigen({ fecha: NOCHE, historial: [] }), {
      tipo: "desde",
      fecha: NOCHE,
    });
  });

  it("lo que ya estaba al empezar el historial está en el registro antes de esa fecha", () => {
    assert.deepStrictEqual(
      desdeDelOrigen({
        fecha: NOCHE + DIA,
        historial: [
          { tipo: "en-el-registro-antes", fecha: NOCHE },
          { tipo: "sin-ficha", fecha: NOCHE + DIA },
        ],
      }),
      { tipo: "antes-del", fecha: NOCHE },
    );
  });

  it("un alta en un cuadro que nunca se había pedido también está antes; con cota es desde", () => {
    assert.deepStrictEqual(
      desdeDelOrigen({ fecha: NOCHE, historial: [{ tipo: "alta", fecha: NOCHE }] }),
      { tipo: "antes-del", fecha: NOCHE },
    );
    assert.deepStrictEqual(
      desdeDelOrigen({
        fecha: NOCHE,
        historial: [{ tipo: "alta", fecha: NOCHE, antes: NOCHE - 7 * DIA }],
      }),
      { tipo: "desde", fecha: NOCHE, antes: NOCHE - 7 * DIA },
    );
  });

  it("un cambio de ficha después del punto de partida dice desde el cambio, entre sus dos fechas", () => {
    assert.deepStrictEqual(
      desdeDelOrigen({
        fecha: NOCHE + 30 * DIA,
        historial: [
          { tipo: "en-el-registro-antes", fecha: NOCHE },
          { tipo: "cambio-de-ficha", fecha: NOCHE + 30 * DIA, antes: NOCHE },
          { tipo: "retirada", fecha: NOCHE + 40 * DIA, antes: NOCHE + 33 * DIA },
        ],
      }),
      { tipo: "desde", fecha: NOCHE + 30 * DIA, antes: NOCHE },
    );
  });

  it("una vuelta con otro listado dice desde la vuelta", () => {
    assert.deepStrictEqual(
      desdeDelOrigen({
        fecha: NOCHE + 40 * DIA,
        historial: [
          { tipo: "en-el-registro-antes", fecha: NOCHE },
          { tipo: "retirada", fecha: NOCHE + 20 * DIA, antes: NOCHE + 10 * DIA },
          { tipo: "vuelta", fecha: NOCHE + 40 * DIA, antes: NOCHE + 10 * DIA },
          { tipo: "cambio-de-listado", fecha: NOCHE + 40 * DIA, antes: NOCHE + 10 * DIA },
        ],
      }),
      { tipo: "desde", fecha: NOCHE + 40 * DIA, antes: NOCHE + 10 * DIA },
    );
  });
});
