import type { Coordenada } from "@celda/dominio/area";
import { workerDePrueba } from "@celda/sim/pruebas";
import { simuladorEnWorker } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createSignal, flush, type Setter } from "solid-js";

import { capaDePrueba } from "../capa/pruebas.ts";
import { ProveedorDeDatos, usarDatos } from "../datos.tsx";
import { orientacionDe } from "../ficha/diagrama.ts";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { crearServicio, type LienzoDeServicio, type ServicioDelMapa } from "./enMapa.ts";
import { lecturaDe, type RasgosServicio } from "./servicio.ts";

const A = { clave: "a", posicion: { longitud: 2.16, latitud: 41.39 } };
const B = { clave: "b", posicion: { longitud: 2.17, latitud: 41.39 } };
/** Puntos al este de «a», cada vez más lejos. */
const alEste = (metros: number): Coordenada => ({
  longitud: A.posicion.longitud + metros / 83_500,
  latitud: A.posicion.latitud,
});

const esperar = async (condicion: () => void = () => undefined) => {
  flush();
  await waitFor(() => {
    flush();
    condicion();
  });
};

interface Mandos {
  readonly servicio: ServicioDelMapa;
  readonly setEmplazamiento: Setter<typeof A | undefined>;
  readonly setPunto: Setter<Coordenada | undefined>;
}

function Prueba(props: {
  readonly lienzo: LienzoDeServicio;
  readonly mandos: (m: Mandos) => void;
}) {
  const [emplazamiento, setEmplazamiento] = createSignal<typeof A | undefined>(A);
  const [punto, setPunto] = createSignal<Coordenada | undefined>();
  const lienzo = props.lienzo;
  const servicio = crearServicio(usarDatos(), {
    lienzo: () => lienzo,
    emplazamiento,
    punto,
    celda: () => undefined,
    orientacion: orientacionDe([]),
  });
  props.mandos({ servicio, setEmplazamiento, setPunto });
  return null;
}

const montar = async () => {
  const worker = workerDePrueba();
  const dibujados: Array<RasgosServicio> = [];
  const lineas: Array<RasgosServicio> = [];
  const lienzo: LienzoDeServicio = {
    dibujar: (rasgos) => {
      dibujados.push(rasgos);
    },
    linea: (rasgos) => {
      lineas.push(rasgos);
    },
  };
  let mandos: Mandos | undefined;
  const { unmount } = render(() => (
    <ProveedorDeDatos
      servicios={Layer.mergeAll(
        capaDePrueba([Effect.never]),
        fichasDePrueba().capa,
        simuladorEnWorker(worker.crear),
        ubicacionDePrueba().capa,
      )}
    >
      <Prueba
        lienzo={lienzo}
        mandos={(m) => {
          mandos = m;
        }}
      />
    </ProveedorDeDatos>
  ));
  await esperar(() => assert.isDefined(mandos));
  if (mandos === undefined) throw new Error("La prueba no ha montado");
  return { ...mandos, worker, dibujados, lineas, desmontar: unmount };
};

const distanciaCalculada = (servicio: ServicioDelMapa) => {
  const calculado = servicio.calculado();
  return calculado === undefined ? undefined : lecturaDe(calculado.resultado)?.distancia;
};

describe("sector que da servicio en el mapa", () => {
  it("sin punto ni celda no calcula nada; con punto, lo calcula en el simulador", async () => {
    const m = await montar();
    assert.strictEqual(m.worker.creados(), 0);
    assert.isUndefined(m.servicio.pedido());

    m.setPunto(alEste(200));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.worker.pendientes()[0]?.simulacion, "sector-servicio");
    // La línea no espera al cálculo.
    assert.lengthOf(m.lineas.at(-1)?.features ?? [], 1);

    m.worker.contestar();
    await esperar(() => assert.closeTo(distanciaCalculada(m.servicio) ?? 0, 200, 2));
    assert.isDefined(m.dibujados.at(-1));
    m.desmontar();
  });

  it("al arrastrar el punto no interrumpe el cálculo en curso: calcula el último al acabar", async () => {
    const m = await montar();
    m.setPunto(alEste(100));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    for (const metros of [120, 140, 160, 180]) {
      m.setPunto(alEste(metros));
      flush();
    }
    await esperar();
    // Solo el primero está en el Worker, y el Worker sigue vivo.
    assert.lengthOf(m.worker.pendientes(), 1);
    assert.strictEqual(m.worker.terminados(), 0);

    m.worker.contestar();
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.closeTo(distanciaCalculada(m.servicio) ?? 0, 100, 2);
    m.worker.contestar();
    await esperar(() => assert.closeTo(distanciaCalculada(m.servicio) ?? 0, 180, 2));
    assert.lengthOf(m.worker.pendientes(), 0);
    assert.strictEqual(m.worker.creados(), 1);
    m.desmontar();
  });

  it("otro emplazamiento cancela el cálculo en curso y borra el resultado anterior", async () => {
    const m = await montar();
    m.setPunto(alEste(100));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.isDefined(m.servicio.calculado()));

    m.setPunto(alEste(300));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.setEmplazamiento(B);
    await esperar(() => assert.strictEqual(m.worker.terminados(), 1));
    assert.isUndefined(m.servicio.calculado());
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.servicio.calculado()?.pedido.clave, "b"));
    m.desmontar();
  });

  it("quitar la selección cancela y deja el mapa sin degradado", async () => {
    const m = await montar();
    m.setPunto(alEste(100));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.setEmplazamiento(undefined);
    await esperar(() => assert.strictEqual(m.worker.terminados(), 1));
    assert.lengthOf(m.dibujados.at(-1)?.features ?? [0], 0);
    assert.lengthOf(m.lineas.at(-1)?.features ?? [0], 0);
    m.desmontar();
  });

  it("si falla lo dice, y el siguiente cambio lo vuelve a intentar", async () => {
    const m = await montar();
    m.setPunto(alEste(100));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.fallar("sin memoria");
    await esperar(() => assert.isTrue(m.servicio.fallo()));
    m.setPunto(alEste(110));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.isFalse(m.servicio.fallo()));
    m.desmontar();
  });

  it("al cerrar el mapa a medio cálculo, lo cancela", async () => {
    const m = await montar();
    m.setPunto(alEste(100));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.desmontar();
    await esperar(() => assert.strictEqual(m.worker.terminados(), 1));
  });
});
