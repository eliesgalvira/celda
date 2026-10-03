import { assert, describe, it } from "@effect/vitest";
import { FUENTE_MAPA_BASE } from "@celda/ui/mapa/estilo.ts";
import { FUENTE_FOTO } from "@celda/ui/mapa/foto.ts";

import { type EventoDeFuente, type MapaConCallejero, vigilarCallejero } from "./callejero.ts";
import type { MotivoFallo } from "./estado.ts";

/** Un mapa que reparte los eventos como MapLibre: a cada escuchador del tipo. */
const montar = () => {
  const escuchadores = new Map<string, Array<(evento: EventoDeFuente) => void>>();
  const mapa: MapaConCallejero = {
    on: (tipo, escuchador) => {
      escuchadores.set(tipo, [...(escuchadores.get(tipo) ?? []), escuchador]);
    },
  };
  const avisos: Array<"listo" | MotivoFallo> = [];
  vigilarCallejero(mapa, {
    listo: () => avisos.push("listo"),
    fallo: (motivo) => avisos.push(motivo),
  });
  const emitir = (tipo: "sourcedata" | "error", evento: EventoDeFuente) => {
    for (const escuchador of escuchadores.get(tipo) ?? []) escuchador(evento);
  };
  return { avisos, emitir };
};

const TESELA = { estado: "loaded" };

describe("vigilar el callejero", () => {
  it("está listo con la primera tesela del mapa base, una sola vez", () => {
    const { avisos, emitir } = montar();
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE });
    assert.deepStrictEqual(avisos, []);
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    assert.deepStrictEqual(avisos, ["listo"]);
  });

  it("un error del mapa base antes de la primera tesela es un fallo; después, no", () => {
    const antes = montar();
    antes.emitir("error", { sourceId: FUENTE_MAPA_BASE });
    assert.deepStrictEqual(antes.avisos, ["sin-respuesta"]);

    const sinFuente = montar();
    sinFuente.emitir("error", {});
    assert.deepStrictEqual(sinFuente.avisos, ["sin-respuesta"]);

    const despues = montar();
    despues.emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    despues.emitir("error", { sourceId: FUENTE_MAPA_BASE });
    assert.deepStrictEqual(despues.avisos, ["listo"]);
  });

  it("una tesela de la foto aérea que no llega no da el mapa base por perdido", () => {
    const { avisos, emitir } = montar();
    // Un error de red o un 404 de una tesela de foto, antes de que llegue el callejero.
    emitir("error", { sourceId: FUENTE_FOTO, tile: TESELA });
    emitir("error", { sourceId: FUENTE_FOTO });
    assert.deepStrictEqual(avisos, []);
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    assert.deepStrictEqual(avisos, ["listo"]);
  });
});
