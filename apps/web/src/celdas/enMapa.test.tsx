import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { workerDePrueba } from "@celda/sim/pruebas";
import { simuladorEnWorker } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createSignal, flush, type Setter } from "solid-js";

import { capaDePrueba } from "../capa/pruebas.ts";
import { ProveedorDeDatos, usarDatos } from "../datos.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import type { CeldasEnMapa } from "./celdas.ts";
import { type CeldasDelMapa, crearCeldas, type LienzoDeCeldas } from "./enMapa.ts";

const emplazamiento = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["orange"],
});

const CAPA: ReadonlyArray<EmplazamientoDeCapa> = [
  emplazamiento("a", 2.16, 41.39),
  emplazamiento("b", 2.17, 41.39),
  emplazamiento("c", 2.165, 41.4),
];
const OTRA_CAPA: ReadonlyArray<EmplazamientoDeCapa> = [...CAPA, emplazamiento("d", 2.15, 41.38)];
const TERCERA_CAPA: ReadonlyArray<EmplazamientoDeCapa> = OTRA_CAPA.slice(1);

/** Deja que el simulador y los efectos avancen hasta que se cumpla `condicion`. */
const esperar = async (condicion: () => void = () => undefined) => {
  flush();
  await waitFor(() => {
    flush();
    condicion();
  });
};

interface Mandos {
  readonly celdas: CeldasDelMapa;
  readonly setEmplazamientos: Setter<ReadonlyArray<EmplazamientoDeCapa>>;
  readonly setCerca: Setter<boolean>;
  readonly setSeleccionada: Setter<string | null>;
}

/** Crea las celdas con un lienzo de prueba y deja los mandos de sus entradas a la prueba. */
function Prueba(props: { readonly lienzo: LienzoDeCeldas; readonly mandos: (m: Mandos) => void }) {
  const [emplazamientos, setEmplazamientos] = createSignal(CAPA);
  const [cerca, setCerca] = createSignal(false);
  const [seleccionada, setSeleccionada] = createSignal<string | null>(null);
  const lienzo = props.lienzo;
  const celdas = crearCeldas(usarDatos(), {
    lienzo: () => lienzo,
    emplazamientos,
    cerca,
    seleccionada,
  });
  props.mandos({ celdas, setEmplazamientos, setCerca, setSeleccionada });
  return null;
}

const montar = async () => {
  const worker = workerDePrueba();
  const dibujadas: Array<CeldasEnMapa> = [];
  const remarcadas: Array<string | null> = [];
  const lienzo: LienzoDeCeldas = {
    dibujar: (celdas) => {
      dibujadas.push(celdas);
    },
    remarcar: (clave) => {
      remarcadas.push(clave);
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
  return { ...mandos, worker, dibujadas, remarcadas, desmontar: unmount };
};

describe("celdas en el mapa", () => {
  it("no se calculan hasta acercar el mapa, y entonces se dibujan una vez por capa", async () => {
    const m = await montar();
    assert.strictEqual(m.worker.creados(), 0);
    assert.strictEqual(m.celdas.calculo(), "sin-pedir");

    m.setCerca(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.worker.pendientes()[0]?.simulacion, "celdas");
    assert.strictEqual(m.celdas.calculo(), "calculando");

    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "listas"));
    assert.deepStrictEqual(
      m.dibujadas.at(-1)?.features.map((celda) => celda.properties.clave),
      ["a", "b", "c"],
    );

    // Alejarse y volver no recalcula.
    m.setCerca(false);
    await esperar();
    m.setCerca(true);
    await esperar();
    assert.strictEqual(m.worker.creados(), 1);
    assert.lengthOf(m.worker.pendientes(), 0);
    assert.strictEqual(m.celdas.calculo(), "listas");
    m.desmontar();
  });

  it("remarca la celda del emplazamiento seleccionado", async () => {
    const m = await montar();
    assert.deepStrictEqual(m.remarcadas, [null]);
    m.setSeleccionada("b");
    await esperar(() => assert.deepStrictEqual(m.remarcadas, [null, "b"]));
    m.setSeleccionada(null);
    await esperar(() => assert.deepStrictEqual(m.remarcadas, [null, "b", null]));
    m.desmontar();
  });

  it("otra capa cancela el cálculo en curso, quita las celdas viejas y calcula las suyas", async () => {
    const m = await montar();
    m.setCerca(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "listas"));

    m.setEmplazamientos(() => OTRA_CAPA);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));

    m.setEmplazamientos(() => TERCERA_CAPA);
    // El Worker que calculaba la segunda capa se termina y otro calcula la tercera.
    await esperar(() => assert.strictEqual(m.worker.creados(), 2));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.worker.terminados(), 1);

    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "listas"));
    assert.deepStrictEqual(
      m.dibujadas.at(-1)?.features.map((celda) => celda.properties.clave),
      ["b", "c", "d"],
    );
    m.desmontar();
  });

  it("lejos del zoom, otra capa quita las celdas de la anterior sin calcular las nuevas", async () => {
    const m = await montar();
    m.setCerca(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "listas"));

    m.setCerca(false);
    m.setEmplazamientos(() => OTRA_CAPA);
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "sin-pedir"));
    assert.lengthOf(m.dibujadas.at(-1)?.features ?? [0], 0);
    assert.lengthOf(m.worker.pendientes(), 0);
    m.desmontar();
  });

  it("si el cálculo falla lo dice, y al reintentar vuelve a pedirlo", async () => {
    const m = await montar();
    m.setCerca(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.fallar("sin memoria");
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "fallo"));

    m.celdas.reintentar();
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.celdas.calculo(), "calculando");
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.celdas.calculo(), "listas"));
    m.desmontar();
  });

  it("al cerrar el mapa a medio cálculo, lo cancela", async () => {
    const m = await montar();
    m.setCerca(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.worker.terminados(), 0);
    m.desmontar();
    await esperar(() => assert.strictEqual(m.worker.terminados(), 1));
  });
});
