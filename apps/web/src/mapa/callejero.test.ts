import { assert, describe, it } from "@effect/vitest";
import { FUENTE_MAPA_BASE } from "@celda/ui/mapa/estilo.ts";
import { FUENTE_FOTO } from "@celda/ui/mapa/foto.ts";
import { FUENTE_RESERVA } from "@celda/ui/mapa/reserva/estilo.ts";

import {
  type Callejero,
  type Esperar,
  type EventoDeFuente,
  type MapaConCallejero,
  PLAZO_DEL_PRINCIPAL_MS,
  vigilarCallejero,
} from "./callejero.ts";
import type { MotivoFallo } from "./estado.ts";

/** Un reloj de prueba: los plazos vencen al avanzarlo, como `setTimeout`. */
const relojDePrueba = () => {
  let ahora = 0;
  let plazos: Array<{ readonly vence: number; readonly alVencer: () => void }> = [];
  const esperar: Esperar = (ms, alVencer) => {
    const plazo = { vence: ahora + ms, alVencer };
    plazos.push(plazo);
    return () => {
      plazos = plazos.filter((otro) => otro !== plazo);
    };
  };
  const avanzar = (ms: number) => {
    ahora += ms;
    const vencidos = plazos.filter((plazo) => plazo.vence <= ahora);
    plazos = plazos.filter((plazo) => plazo.vence > ahora);
    for (const plazo of vencidos) plazo.alVencer();
  };
  return { esperar, avanzar, pendientes: () => plazos.length };
};

/** Un mapa que reparte los eventos como MapLibre: a cada escuchador del tipo. */
const montar = (desde: Callejero = "principal") => {
  const escuchadores = new Map<string, Array<(evento: EventoDeFuente) => void>>();
  const alQuitar: Array<() => void> = [];
  const mapa: MapaConCallejero = {
    on: (tipo, escuchador) => {
      escuchadores.set(tipo, [...(escuchadores.get(tipo) ?? []), escuchador]);
    },
    once: (_tipo, escuchador) => {
      alQuitar.push(escuchador);
    },
  };
  const avisos: Array<"listo" | "completo" | "reserva" | "estilo-de-reserva" | MotivoFallo> = [];
  const reloj = relojDePrueba();
  vigilarCallejero(
    mapa,
    {
      listo: () => avisos.push("listo"),
      completo: () => avisos.push("completo"),
      fallo: (motivo) => avisos.push(motivo),
      aReserva: () => avisos.push("reserva"),
    },
    { desde, ponerReserva: () => avisos.push("estilo-de-reserva"), esperar: reloj.esperar },
  );
  const emitir = (tipo: "sourcedata" | "error", evento: EventoDeFuente) => {
    for (const escuchador of escuchadores.get(tipo) ?? []) escuchador(evento);
  };
  const quitar = () => {
    for (const escuchador of alQuitar) escuchador();
  };
  return { avisos, emitir, reloj, quitar };
};

const TESELA = { estado: "loaded" };

describe("vigilar el callejero", () => {
  it("está listo con la primera tesela del mapa base, una sola vez, y ya no espera a la reserva", () => {
    const { avisos, emitir, reloj } = montar();
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE });
    assert.deepStrictEqual(avisos, []);
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    assert.deepStrictEqual(avisos, ["listo"]);
    assert.strictEqual(reloj.pendientes(), 0);
    reloj.avanzar(PLAZO_DEL_PRINCIPAL_MS * 10);
    emitir("error", { sourceId: FUENTE_MAPA_BASE });
    assert.deepStrictEqual(avisos, ["listo"]);
  });

  it("si la primera tesela del principal no llega a tiempo, pasa a la reserva una sola vez", () => {
    const { avisos, emitir, reloj } = montar();
    reloj.avanzar(PLAZO_DEL_PRINCIPAL_MS - 1);
    assert.deepStrictEqual(avisos, []);
    reloj.avanzar(1);
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva"]);
    // El principal ya no cuenta: ni sus errores ni una tesela que llegara tarde.
    emitir("error", { sourceId: FUENTE_MAPA_BASE });
    emitir("error", {});
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA });
    reloj.avanzar(PLAZO_DEL_PRINCIPAL_MS * 10);
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva"]);
    emitir("sourcedata", { sourceId: FUENTE_RESERVA, tile: TESELA });
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva", "listo"]);
  });

  it("un error del principal antes de la primera tesela pasa a la reserva en el acto", () => {
    const conFuente = montar();
    conFuente.emitir("error", { sourceId: FUENTE_MAPA_BASE, error: { status: 503 } });
    conFuente.emitir("error", { sourceId: FUENTE_MAPA_BASE });
    assert.deepStrictEqual(conFuente.avisos, ["reserva", "estilo-de-reserva"]);
    assert.strictEqual(conFuente.reloj.pendientes(), 0);

    // Los glifos fallan sin fuente, y salen del mismo servidor que las teselas.
    const sinFuente = montar();
    sinFuente.emitir("error", {});
    assert.deepStrictEqual(sinFuente.avisos, ["reserva", "estilo-de-reserva"]);
  });

  it("un 403 del IGN es una tesela vacía, no un fallo; otro error antes de la primera, sí", () => {
    const { avisos, emitir, reloj } = montar();
    reloj.avanzar(PLAZO_DEL_PRINCIPAL_MS);
    emitir("error", { sourceId: FUENTE_RESERVA, error: { status: 403 } });
    emitir("error", {});
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva"]);
    emitir("error", { sourceId: FUENTE_RESERVA, error: { status: 500 } });
    emitir("error", { sourceId: FUENTE_RESERVA });
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva", "sin-respuesta"]);
    // Si después llega, el mapa se arregla solo.
    emitir("sourcedata", { sourceId: FUENTE_RESERVA, tile: TESELA });
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva", "sin-respuesta", "listo"]);
  });

  it("un mapa que nace con la reserva no espera al principal ni vuelve a ponerla", () => {
    const { avisos, emitir, reloj } = montar("reserva");
    assert.strictEqual(reloj.pendientes(), 0);
    emitir("error", { sourceId: FUENTE_RESERVA, error: { status: 403 } });
    emitir("sourcedata", { sourceId: FUENTE_RESERVA, tile: TESELA });
    assert.deepStrictEqual(avisos, ["listo"]);
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

  it("está completo una sola vez, cuando han llegado todas las teselas que se ven", () => {
    const { avisos, emitir } = montar();
    // La silueta y los límites son fuentes de Celda: no cuentan.
    emitir("sourcedata", { sourceId: "silueta", isSourceLoaded: true });
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA, isSourceLoaded: false });
    assert.deepStrictEqual(avisos, ["listo"]);
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA, isSourceLoaded: true });
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, tile: TESELA, isSourceLoaded: true });
    assert.deepStrictEqual(avisos, ["listo", "completo"]);
  });

  it("con la reserva, está completo cuando han llegado las del IGN, también las vacías", () => {
    const { avisos, emitir, reloj } = montar();
    reloj.avanzar(PLAZO_DEL_PRINCIPAL_MS);
    emitir("sourcedata", { sourceId: FUENTE_MAPA_BASE, isSourceLoaded: true });
    emitir("sourcedata", { sourceId: FUENTE_RESERVA, tile: TESELA, isSourceLoaded: true });
    assert.deepStrictEqual(avisos, ["reserva", "estilo-de-reserva", "listo", "completo"]);
  });

  it("al quitar el mapa se cancela el plazo: no se toca un mapa que ya no está", () => {
    const { avisos, reloj, quitar } = montar();
    quitar();
    reloj.avanzar(PLAZO_DEL_PRINCIPAL_MS);
    assert.deepStrictEqual(avisos, []);
  });
});
