import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { desdePlano } from "@celda/dominio/plano";
import { workerDePrueba } from "@celda/sim/pruebas";
import { simuladorEnWorker } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createSignal, flush, type Setter } from "solid-js";

import { capaDePrueba } from "../capa/pruebas.ts";
import { type EstadoDeLasVecinas, VECINAS_LISTAS } from "../capa/vecinas.ts";
import { ProveedorDeDatos, usarDatos } from "../datos.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import {
  crearInterferencia,
  type InterferenciaDelMapa,
  type LienzoDeInterferencia,
} from "./enMapa.ts";
import { type EleccionVista, type Encuadre, type TramaEnMapa } from "./interferencia.ts";

/** El centro de una casilla de la rejilla de los orígenes, en Barcelona: el origen de la trama. */
const ORIGEN: Coordenada = { longitud: 2.15, latitud: 41.35 };

/** Un punto a tantos metros al este y al norte del origen. */
const en = (este: number, norte: number): Coordenada => desdePlano(ORIGEN, { este, norte });

const emplazamiento = (clave: string, este: number, norte: number): EmplazamientoDeCapa => ({
  clave,
  posicion: en(este, norte),
  estado: "verificado",
  companias: ["orange"],
});

const CAPA: ReadonlyArray<EmplazamientoDeCapa> = [
  emplazamiento("a", 0, 0),
  emplazamiento("b", 400, 0),
  emplazamiento("c", 200, 350),
];

const ENCUADRE: Encuadre = { suroeste: en(-300, -200), noreste: en(300, 200), zoom: 16 };
const ELECCION: EleccionVista = { compania: "orange", mhz: 1800, ocupacion: 0.5 };

/** Deja que el simulador, la espera y los efectos avancen hasta que se cumpla `condicion`. */
const esperar = async (condicion: () => void = () => undefined) => {
  flush();
  await waitFor(() => {
    flush();
    condicion();
  });
};

interface Mandos {
  readonly vista: InterferenciaDelMapa;
  readonly setActiva: Setter<boolean>;
  readonly setEleccion: Setter<EleccionVista>;
  readonly setEncuadre: Setter<Encuadre | undefined>;
  readonly setReferencia: Setter<Coordenada | undefined>;
  readonly setVecinas: Setter<EstadoDeLasVecinas>;
}

function Prueba(props: {
  readonly lienzo: LienzoDeInterferencia;
  readonly mandos: (m: Mandos) => void;
}) {
  const [activa, setActiva] = createSignal(false);
  const [eleccion, setEleccion] = createSignal(ELECCION);
  const [encuadre, setEncuadre] = createSignal<Encuadre | undefined>(ENCUADRE);
  const [referencia, setReferencia] = createSignal<Coordenada | undefined>();
  const [vecinas, setVecinas] = createSignal<EstadoDeLasVecinas>(VECINAS_LISTAS);
  const lienzo = props.lienzo;
  const vista = crearInterferencia(usarDatos(), {
    lienzo: () => lienzo,
    activa,
    emplazamientos: () => CAPA,
    eleccion,
    encuadre,
    referencia,
    vecinas,
  });
  props.mandos({ vista, setActiva, setEleccion, setEncuadre, setReferencia, setVecinas });
  return null;
}

const montar = async () => {
  const worker = workerDePrueba();
  const dibujadas: Array<TramaEnMapa> = [];
  const mostradas: Array<boolean> = [];
  const lienzo: LienzoDeInterferencia = {
    dibujar: (trama) => {
      dibujadas.push(trama);
    },
    mostrar: (activa) => {
      mostradas.push(activa);
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
  return { ...mandos, worker, dibujadas, mostradas, desmontar: unmount };
};

describe("vista de interferencia en el mapa", () => {
  it("mientras falta una provincia vecina no calcula ni dibuja nada, y lo dice", async () => {
    const m = await montar();
    const girona = { codigo: "17", nombre: "Girona" };
    m.setVecinas({ tipo: "cargando", provincias: [girona] });
    m.setActiva(true);
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "esperando"));
    assert.deepStrictEqual(m.vista.calculo().faltan, [girona]);
    assert.lengthOf(m.dibujadas.at(-1)?.features ?? [0], 0);
    assert.strictEqual(m.worker.creados(), 0);

    // Si no llega, tampoco: la vista dice que falta.
    m.setVecinas({ tipo: "fallo", provincias: [girona] });
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "sin-vecinas"));
    assert.strictEqual(m.worker.creados(), 0);

    // Cuando llega, calcula con ella.
    m.setVecinas(VECINAS_LISTAS);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.vista.calculo().estado, "calculando");
    assert.isUndefined(m.vista.calculo().faltan);
    m.desmontar();
  });

  it("no calcula nada hasta activarla; entonces pide sinr@1 y dibuja la trama", async () => {
    const m = await montar();
    assert.deepStrictEqual(m.mostradas, [false]);
    assert.strictEqual(m.worker.creados(), 0);

    m.setActiva(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.deepStrictEqual(m.mostradas, [false, true]);
    const pedida = m.worker.pendientes()[0];
    assert.deepStrictEqual([pedida?.simulacion, pedida?.version], ["sinr", "1"]);
    assert.strictEqual(m.vista.calculo().estado, "calculando");

    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "lista"));
    assert.isAbove(m.dibujadas.at(-1)?.features.length ?? 0, 100);
    assert.isTrue(m.vista.calculo().conTrama);
    assert.isUndefined(m.vista.calculo().valor);
    m.desmontar();
  });

  it("con punto de referencia da su valor, y lo mantiene mientras calcula el siguiente", async () => {
    const m = await montar();
    m.setReferencia(en(60, 30));
    m.setActiva(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "lista"));
    const conMedia = m.vista.calculo().valor ?? Number.NaN;
    assert.isFalse(Number.isNaN(conMedia));

    m.setEleccion({ ...ELECCION, ocupacion: 1 });
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.deepStrictEqual(m.vista.calculo(), {
      estado: "calculando",
      valor: conMedia,
      conTrama: true,
    });
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "lista"));
    // Más ocupación, peor valor.
    assert.isBelow(m.vista.calculo().valor ?? Number.NaN, conMedia);
    m.desmontar();
  });

  it("una lectura nueva del GPS en el mismo punto no cancela el cálculo ni pide otro", async () => {
    const m = await montar();
    m.setReferencia(en(100, 50));
    m.setActiva(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    // Cada lectura del GPS trae una posición nueva, aunque las coordenadas sean las mismas.
    m.setReferencia(en(100, 50));
    flush();
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "lista"));
    assert.strictEqual(m.worker.terminados(), 0);
    assert.strictEqual(m.worker.recibidas(), 1);
    m.desmontar();
  });

  it("varios cambios seguidos piden un solo cálculo, y uno nuevo cancela el que había", async () => {
    const m = await montar();
    m.setActiva(true);
    for (const ocupacion of [0.2, 0.3, 0.4, 0.6]) {
      m.setEleccion({ ...ELECCION, ocupacion });
      flush();
    }
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.worker.creados(), 1);

    // Un arrastre corto no pide nada: la trama ya lo cubre.
    m.setEncuadre({ ...ENCUADRE, suroeste: en(-280, -190), noreste: en(320, 210) });
    await esperar();
    assert.strictEqual(m.worker.creados(), 1);
    // Salir de ella con el cálculo en marcha lo cancela: termina ese Worker y otro calcula.
    m.setEncuadre({ ...ENCUADRE, suroeste: en(700, -200), noreste: en(1300, 200) });
    await esperar(() => assert.strictEqual(m.worker.creados(), 2));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.strictEqual(m.worker.terminados(), 1);
    m.desmontar();
  });

  it("alejada del zoom solo calcula el punto; sin punto no calcula y borra la trama", async () => {
    const m = await montar();
    m.setActiva(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "lista"));

    m.setEncuadre({ ...ENCUADRE, zoom: 12 });
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "sin-pedir"));
    assert.lengthOf(m.dibujadas.at(-1)?.features ?? [0], 0);

    m.setReferencia(en(10, 10));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    assert.lengthOf(m.worker.pendientes()[0]?.malla.este ?? [], 1);
    m.desmontar();
  });

  it("si falla lo dice y al reintentar vuelve a pedirlo; al apagarla borra la trama", async () => {
    const m = await montar();
    m.setActiva(true);
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.fallar("sin memoria");
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "fallo"));

    m.vista.reintentar();
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    m.worker.contestar();
    await esperar(() => assert.strictEqual(m.vista.calculo().estado, "lista"));

    m.setActiva(false);
    await esperar(() => assert.deepStrictEqual(m.mostradas.at(-1), false));
    assert.lengthOf(m.dibujadas.at(-1)?.features ?? [0], 0);
    assert.strictEqual(m.vista.calculo().estado, "sin-pedir");
    m.desmontar();
  });
});
