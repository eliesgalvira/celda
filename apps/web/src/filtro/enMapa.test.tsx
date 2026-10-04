import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import { claveDeFiltro, type FiltroDeCompanias, SIN_FILTRO } from "@celda/dominio/filtro";
import { ParamsCeldas } from "@celda/sim/celdas";
import { workerDePrueba } from "@celda/sim/pruebas";
import { simuladorEnWorker } from "@celda/sim/simulador";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { createEffect, createSignal, flush } from "solid-js";

import {
  type CapaDePrueba,
  capaDePrueba,
  FUENTE_DE_BARRIOS,
  provinciaDePrueba,
} from "../capa/pruebas.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";
import type { CeldasEnMapa } from "../celdas/celdas.ts";
import { crearCeldas } from "../celdas/enMapa.ts";
import { ProveedorDeDatos, usarDatos } from "../datos.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import {
  celdasDelFiltro,
  crearFiltro,
  ESPERA_DEL_FILTRO_MS,
  type FiltroDelMapa,
} from "./enMapa.ts";

const en = (clave: string, longitud: number, ...companias: ReadonlyArray<Compania>) => ({
  clave,
  posicion: { longitud, latitud: 41.39 },
  estado: "verificado" as const,
  companias,
  barrio: null,
});

const CAPA: CapaDePrueba = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: Date.UTC(2026, 8, 25, 23, 44, 53),
  emplazamientos: [
    en("m", 2.16, "movistar"),
    en("mv", 2.17, "movistar", "vodafone"),
    en("d", 2.165, "digi"),
    en("d2", 2.175, "digi"),
    en("o", 2.18, "orange"),
    en("y", 2.185, "yoigo"),
  ],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

const leerParams = Schema.decodeUnknownOption(ParamsCeldas);

/** Deja que los efectos, el simulador y la espera del filtro avancen hasta que se cumpla. */
const esperar = async (condicion: () => void = () => undefined) => {
  flush();
  await waitFor(() => {
    flush();
    condicion();
  });
};

const dormir = (ms: number) =>
  new Promise<void>((listo) => {
    // @effect-diagnostics-next-line globalTimers:off
    setTimeout(listo, ms);
  });

interface Mandos {
  readonly filtro: FiltroDelMapa;
  /** Cada filtro que ha dibujado el mapa, en orden. */
  readonly aplicados: ReadonlyArray<string>;
  /** Las celdas que ha dibujado el mapa, en orden. */
  readonly dibujadas: ReadonlyArray<CeldasEnMapa>;
}

function Prueba(props: {
  readonly guardado: ReadonlyArray<Compania>;
  readonly mandos: (m: Mandos) => void;
}) {
  const datos = usarDatos();
  const [guardado, setGuardado] = createSignal<FiltroDeCompanias>(props.guardado);
  const provincia = provinciaDePrueba(CAPA);
  const filtro = crearFiltro(datos, {
    guardado,
    guardar: (nuevo) => setGuardado(nuevo),
    cargadas: () => [provincia],
  });
  const aplicados: Array<string> = [];
  createEffect(filtro.aplicado, (actual) => {
    aplicados.push(claveDeFiltro(actual));
  });
  const dibujadas: Array<CeldasEnMapa> = [];
  const deLasCeldas = celdasDelFiltro(
    (): ReadonlyArray<EmplazamientoLeido> => provincia.capa.emplazamientos,
    filtro.aplicado,
  );
  crearCeldas(datos, {
    lienzo: () => ({
      dibujar: (celdas) => {
        dibujadas.push(celdas);
      },
      remarcar: () => undefined,
    }),
    emplazamientos: () => deLasCeldas().emplazamientos,
    redUsada: () => deLasCeldas().redUsada,
    cerca: () => true,
    seleccionada: () => null,
  });
  props.mandos({ filtro, aplicados, dibujadas });
  return null;
}

const montar = async (guardado: ReadonlyArray<Compania> = SIN_FILTRO, automatico = true) => {
  const worker = workerDePrueba({ automatico });
  const pedidas: Array<string> = [];
  // El servicio de capa de prueba, contando las agrupaciones que se le piden.
  const capa = Layer.effect(
    CapaEmplazamientos,
    Effect.gen(function* () {
      const servicio = yield* CapaEmplazamientos;
      return CapaEmplazamientos.of({
        ...servicio,
        agrupacion: (codigo, filtro) =>
          Effect.suspend(() => {
            pedidas.push(`${codigo} ${claveDeFiltro(filtro)}`);
            return servicio.agrupacion(codigo, filtro);
          }),
      });
    }),
  ).pipe(Layer.provide(capaDePrueba([Effect.succeed(CAPA)])));
  let mandos: Mandos | undefined;
  const { unmount } = render(() => (
    <ProveedorDeDatos
      servicios={Layer.mergeAll(
        capa,
        fichasDePrueba().capa,
        simuladorEnWorker(worker.crear),
        ubicacionDePrueba().capa,
      )}
    >
      <Prueba
        guardado={guardado}
        mandos={(m) => {
          mandos = m;
        }}
      />
    </ProveedorDeDatos>
  ));
  await esperar(() => assert.isDefined(mandos));
  if (mandos === undefined) throw new Error("La prueba no ha montado");
  return { ...mandos, worker, pedidas, desmontar: unmount };
};

/** Cuántos emplazamientos llevaba cada cálculo de celdas que ha recibido el Worker. */
const celdasPedidas = (worker: ReturnType<typeof workerDePrueba>) => worker.recibidas();

describe("filtro de compañías en el mapa (ADR 0026)", () => {
  it("el guardado vale al abrir, sin esperar, y las celdas salen con los suyos y su red", async () => {
    const m = await montar(["digi"], false);
    // En el primer `flush` ya es el guardado: no hay espera.
    assert.strictEqual(m.aplicados.at(-1), "digi");
    await esperar(() => assert.deepStrictEqual(m.pedidas, ["08 digi"]));
    await esperar(() => assert.lengthOf(m.worker.pendientes(), 1));
    // Los dos de Digi y los dos de Movistar, su red: el móvil puede conectarse a estos.
    const params = leerParams(m.worker.pendientes()[0]?.params);
    const cuantos = Option.match(params, {
      onNone: () => -1,
      onSome: (p) => p.emplazamientos.length,
    });
    assert.strictEqual(cuantos, 4);
    assert.strictEqual(celdasPedidas(m.worker), 1);
    m.desmontar();
  });

  /** Las celdas dibujadas con un filtro guardado: la clave de cada una y si va más clara. */
  const celdasCon = async (guardado: ReadonlyArray<Compania>) => {
    const m = await montar(guardado);
    await esperar(() => assert.isAbove(m.dibujadas.at(-1)?.features.length ?? 0, 0));
    const celdas = Object.fromEntries(
      (m.dibujadas.at(-1)?.features ?? []).map((c) => [c.properties.clave, c.properties.redUsada]),
    );
    m.desmontar();
    return celdas;
  };

  it("solo Digi: celdas de los suyos y, más claras, de los de Movistar", async () => {
    assert.deepStrictEqual(await celdasCon(["digi"]), { m: true, mv: true, d: false, d2: false });
  });

  it("solo Yoigo: celdas de los suyos y, más claras, de los de Orange", async () => {
    assert.deepStrictEqual(await celdasCon(["yoigo"]), { o: true, y: false });
  });

  it("Digi y Movistar: cada emplazamiento tiene una celda, ninguna más clara", async () => {
    assert.deepStrictEqual(await celdasCon(["movistar", "digi"]), {
      m: false,
      mv: false,
      d: false,
      d2: false,
    });
  });

  it("todas: una celda por emplazamiento, ninguna más clara", async () => {
    assert.deepStrictEqual(await celdasCon(SIN_FILTRO), {
      m: false,
      mv: false,
      d: false,
      d2: false,
      o: false,
      y: false,
    });
  });

  it("varios toques seguidos dibujan solo el último, una vez, y el Worker no ve los de paso", async () => {
    const m = await montar();
    await esperar(() => assert.strictEqual(celdasPedidas(m.worker), 1));
    m.filtro.elegir(["movistar"]);
    m.filtro.elegir(["movistar", "digi"]);
    m.filtro.elegir(["digi"]);
    flush();
    // Los chips cambian en el acto; el mapa, tras la espera.
    assert.deepStrictEqual(m.filtro.elegido(), ["digi"]);
    assert.deepStrictEqual(m.aplicados, ["todas"]);
    await esperar(() => assert.deepStrictEqual(m.aplicados, ["todas", "digi"]));
    await esperar(() => assert.deepStrictEqual(m.pedidas, ["08 digi"]));
    await esperar(() => assert.strictEqual(celdasPedidas(m.worker), 2));
    await esperar(() => assert.strictEqual(m.filtro.agrupaciones().get("08")?.filtro, "digi"));

    // Quieto: ni otra agrupación ni otro cálculo de celdas.
    await dormir(4 * ESPERA_DEL_FILTRO_MS);
    flush();
    assert.deepStrictEqual(m.pedidas, ["08 digi"]);
    assert.strictEqual(celdasPedidas(m.worker), 2);
    m.desmontar();
  });

  it("volver a un filtro ya visto no pide otra agrupación; sin filtro no pide ninguna", async () => {
    const m = await montar();
    m.filtro.elegir(["orange"]);
    await esperar(() => assert.deepStrictEqual(m.pedidas, ["08 orange"]));
    await esperar(() => assert.strictEqual(m.filtro.agrupaciones().get("08")?.filtro, "orange"));
    m.filtro.elegir(SIN_FILTRO);
    await esperar(() => assert.deepStrictEqual(m.aplicados.at(-1), "todas"));
    m.filtro.elegir(["orange"]);
    await esperar(() => assert.deepStrictEqual(m.aplicados.at(-1), "orange"));
    await dormir(2 * ESPERA_DEL_FILTRO_MS);
    flush();
    assert.deepStrictEqual(m.pedidas, ["08 orange"]);
    m.desmontar();
  });
});
