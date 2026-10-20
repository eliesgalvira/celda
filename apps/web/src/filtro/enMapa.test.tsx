import type { Compania } from "@celda/dominio/compania";
import { claveDeFiltro, type FiltroDeCompanias, SIN_FILTRO } from "@celda/dominio/filtro";
import { simuladorDePrueba } from "@celda/sim/pruebas";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createEffect, createSignal, flush } from "solid-js";

import {
  type CapaDePrueba,
  capaDePrueba,
  FUENTE_DE_BARRIOS,
  provinciaDePrueba,
} from "../capa/pruebas.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";
import { ProveedorDeDatos, usarDatos } from "../datos.tsx";
import { fichasDePrueba } from "../ficha/pruebas.ts";
import { ubicacionDePrueba } from "../ubicacion/pruebas.ts";
import { crearFiltro, ESPERA_DEL_FILTRO_MS, type FiltroDelMapa } from "./enMapa.ts";

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

/** Deja que los efectos y la espera del filtro avancen hasta que se cumpla. */
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
  props.mandos({ filtro, aplicados });
  return null;
}

const montar = async (guardado: ReadonlyArray<Compania> = SIN_FILTRO) => {
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
        simuladorDePrueba,
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
  return { ...mandos, pedidas, desmontar: unmount };
};

describe("filtro de compañías en el mapa (ADR 0026)", () => {
  it("el guardado vale al abrir, sin esperar, y pide la agrupación de su filtro", async () => {
    const m = await montar(["digi"]);
    // En el primer `flush` ya es el guardado: no hay espera.
    assert.strictEqual(m.aplicados.at(-1), "digi");
    await esperar(() => assert.deepStrictEqual(m.pedidas, ["08 digi"]));
    m.desmontar();
  });

  it("varios toques seguidos aplican solo el último, una vez, y no piden los de paso", async () => {
    const m = await montar();
    m.filtro.elegir(["movistar"]);
    m.filtro.elegir(["movistar", "digi"]);
    m.filtro.elegir(["digi"]);
    flush();
    // Los chips cambian en el acto; el mapa, tras la espera.
    assert.deepStrictEqual(m.filtro.elegido(), ["digi"]);
    assert.deepStrictEqual(m.aplicados, ["todas"]);
    await esperar(() => assert.deepStrictEqual(m.aplicados, ["todas", "digi"]));
    await esperar(() => assert.deepStrictEqual(m.pedidas, ["08 digi"]));
    await esperar(() => assert.strictEqual(m.filtro.agrupaciones().get("08")?.filtro, "digi"));

    // Quieto: ninguna otra agrupación.
    await dormir(4 * ESPERA_DEL_FILTRO_MS);
    flush();
    assert.deepStrictEqual(m.aplicados, ["todas", "digi"]);
    assert.deepStrictEqual(m.pedidas, ["08 digi"]);
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
