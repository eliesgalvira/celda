import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";
import { createSignal, flush } from "solid-js";

import type { Vista } from "../capa/marcadores.ts";
import { cargarContornos, cargarProvinciasDeZonas } from "../ejercicio/zona.ts";
import {
  type CargasDeZonas,
  crearLugares,
  lugarDeLaVista,
  nombraUnSitio,
  SIN_ZONAS,
} from "./lugar.ts";

/**
 * Lo que se ve en un móvil de 390 × 844 centrado en el punto, al zoom dado: el mundo mide 512 px a
 * zoom 0 y cada nivel lo dobla.
 */
const vistaEn = (longitud: number, latitud: number, zoom: number): Vista => {
  const grados = (pixeles: number) => (pixeles / (512 * 2 ** zoom)) * 360;
  const ancho = grados(390) / 2;
  const alto = grados(844) / 2 / Math.cos((latitud * Math.PI) / 180);
  return {
    caja: {
      suroeste: { longitud: longitud - ancho, latitud: latitud - alto },
      noreste: { longitud: longitud + ancho, latitud: latitud + alto },
    },
    zoom,
  };
};

const PLAZA_CATALUNYA = [2.17, 41.387] as const;
const TORDERA = [2.719, 41.699] as const;
const QUERALBS = [2.165, 42.35] as const;
const PUERTA_DEL_SOL = [-3.7038, 40.4168] as const;
const SORIA = [-2.468, 41.764] as const;
/** En Francia, fuera de la caja de todas las provincias. */
const CARCASONA = [2.35, 43.21] as const;

/**
 * Las provincias y los contornos de verdad (`ejercicio/zonas`), contando lo que se pide. Con una
 * puerta, los contornos no llegan hasta abrirla, como una red lenta.
 */
const cargasDePrueba = (puerta?: Promise<void>) => {
  const pedidas: Array<string> = [];
  const cargas: CargasDeZonas = {
    provincias: Effect.suspend(() => {
      pedidas.push("provincias");
      return cargarProvinciasDeZonas;
    }),
    contornos: (codigo) =>
      Effect.suspend(() => {
        pedidas.push(codigo);
        return puerta === undefined
          ? cargarContornos(codigo)
          : Effect.andThen(
              Effect.promise(() => puerta),
              cargarContornos(codigo),
            );
      }),
  };
  return { pedidas, cargas };
};

/** La cabecera de la pantalla del mapa, con el lugar que sale de la vista. */
const montar = (inicial: Vista | undefined, cargas: CargasDeZonas) => {
  const [vista, setVista] = createSignal<Vista | undefined>(inicial);
  const pantalla = render(() => {
    const lugares = crearLugares({ vista, puntos: () => [], cargas });
    return <Cabecera lugar={lugares.nombre()} />;
  });
  flush();
  const nodo = () => pantalla.container.querySelector("[data-lugar]");
  return {
    lugar: () => nodo()?.textContent,
    nodo,
    mover: (nueva: Vista) => {
      setVista(nueva);
      flush();
    },
  };
};

describe("cabecera del mapa", () => {
  it("de lejos dice España y no descarga nada", () => {
    const { pedidas, cargas } = cargasDePrueba();
    const { lugar } = montar(vistaEn(...PLAZA_CATALUNYA, 6.5), cargas);
    assert.strictEqual(lugar(), "España");
    assert.deepStrictEqual(pedidas, []);
  });

  it("al nivel de provincias dice la del centro y, al de municipios, el municipio", async () => {
    const { pedidas, cargas } = cargasDePrueba();
    const { lugar, mover } = montar(vistaEn(...TORDERA, 9), cargas);
    await waitFor(() => assert.strictEqual(lugar(), "Barcelona"));
    mover(vistaEn(...TORDERA, 11.5));
    assert.strictEqual(lugar(), "Tordera");
    mover(vistaEn(...QUERALBS, 12));
    await waitFor(() => assert.strictEqual(lugar(), "Queralbs"));
    mover(vistaEn(...QUERALBS, 9.2));
    assert.strictEqual(lugar(), "Girona");
    // Cada cosa se pide una vez: las provincias y los contornos de las dos cuyas cajas contienen
    // Tordera. Queralbs solo cae en la de Girona, que ya estaba.
    assert.deepStrictEqual(pedidas, ["provincias", "08", "17"]);
  });

  it("fuera de Cataluña, sin datos de Celda, dice igual el municipio", async () => {
    const { cargas } = cargasDePrueba();
    const { lugar, mover } = montar(vistaEn(...PUERTA_DEL_SOL, 12), cargas);
    await waitFor(() => assert.strictEqual(lugar(), "Madrid"));
    mover(vistaEn(...SORIA, 8.5));
    await waitFor(() => assert.strictEqual(lugar(), "Soria"));
  });

  it("mientras llega el contorno sigue diciendo lo de antes, sin quedarse en blanco", async () => {
    let abrir = () => {};
    const puerta = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    const { pedidas, cargas } = cargasDePrueba(puerta);
    const { lugar, mover } = montar(vistaEn(...PLAZA_CATALUNYA, 6), cargas);
    assert.strictEqual(lugar(), "España");
    mover(vistaEn(...PLAZA_CATALUNYA, 12));
    // Ya han llegado las provincias y se ha pedido el contorno de Barcelona, que espera.
    await waitFor(() => assert.deepStrictEqual(pedidas, ["provincias", "08"]));
    flush();
    assert.strictEqual(lugar(), "España");
    abrir();
    await waitFor(() => assert.strictEqual(lugar(), "Barcelona"));
  });

  it("con el centro fuera de España, de cerca también dice España", async () => {
    const { pedidas, cargas } = cargasDePrueba();
    const { lugar, mover } = montar(vistaEn(...PLAZA_CATALUNYA, 12), cargas);
    await waitFor(() => assert.strictEqual(lugar(), "Barcelona"));
    mover(vistaEn(...CARCASONA, 12));
    assert.strictEqual(lugar(), "España");
    assert.deepStrictEqual(pedidas, ["provincias", "08"]);
  });

  it("el lugar tiene un ancho fijo en una línea: al cambiar de nombre la cinta no se mueve", async () => {
    const { cargas } = cargasDePrueba();
    const { nodo, lugar, mover } = montar(vistaEn(...PLAZA_CATALUNYA, 6), cargas);
    const antes = nodo()?.className;
    assert.match(antes ?? "", /\btruncate\b/u);
    assert.match(antes ?? "", /\bw-\d+\b/u);
    mover(vistaEn(...TORDERA, 12));
    await waitFor(() => assert.strictEqual(lugar(), "Tordera"));
    assert.strictEqual(nodo()?.className, antes);
  });
});

describe("lugarDeLaVista", () => {
  it("sin vista o de lejos es España; de cerca, sin provincias aún, no se sabe", () => {
    assert.strictEqual(lugarDeLaVista(undefined, SIN_ZONAS), "España");
    assert.strictEqual(lugarDeLaVista(vistaEn(...PLAZA_CATALUNYA, 6), SIN_ZONAS), "España");
    assert.isUndefined(lugarDeLaVista(vistaEn(...PLAZA_CATALUNYA, 8), SIN_ZONAS));
  });

  it("antes del nivel de provincias nombra una si lo que se ve no es más ancho que ella", () => {
    // En el móvil, Soria encuadrada entera queda a zoom 7,3: se ven 1,8° de ancho.
    assert.isFalse(nombraUnSitio(vistaEn(...SORIA, 6.5)));
    assert.isTrue(nombraUnSitio(vistaEn(...SORIA, 7.3)));
    const escritorio: Vista = {
      caja: {
        suroeste: { longitud: -7, latitud: 40 },
        noreste: { longitud: 2.6, latitud: 43.5 },
      },
      zoom: 7.3,
    };
    assert.isFalse(nombraUnSitio(escritorio));
  });

  it("si las provincias no llegan, dice España", () => {
    assert.strictEqual(
      lugarDeLaVista(vistaEn(...PLAZA_CATALUNYA, 12), {
        provincias: { tipo: "fallo" },
        contornos: new Map(),
      }),
      "España",
    );
  });
});
