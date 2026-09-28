import { assert, describe, it } from "@effect/vitest";

import type { Vista } from "../capa/marcadores.ts";
import { type MapaQueSeMueve, type Reloj, seguirVista } from "./vista.ts";

type Evento = "move" | "moveend";

/** Un mapa de prueba centrado en Barcelona: se mueve, se acerca y emite sus eventos a mano. */
const mapaDePrueba = () => {
  const oyentes = new Map<Evento, Set<() => void>>([
    ["move", new Set()],
    ["moveend", new Set()],
  ]);
  let centro = { longitud: 2.17, latitud: 41.39 };
  let zoom = 14.5;
  const mapa: MapaQueSeMueve = {
    on: (evento, oyente) => {
      oyentes.get(evento)?.add(oyente);
    },
    off: (evento, oyente) => {
      oyentes.get(evento)?.delete(oyente);
    },
    // La caja mide la mitad cada vez que se acerca un nivel, como en el mapa.
    getBounds: () => {
      const medio = 0.01 * 2 ** (14 - zoom);
      return {
        getWest: () => centro.longitud - medio,
        getEast: () => centro.longitud + medio,
        getSouth: () => centro.latitud - medio,
        getNorth: () => centro.latitud + medio,
      };
    },
    getZoom: () => zoom,
  };
  const emitir = (evento: Evento) => {
    for (const oyente of oyentes.get(evento) ?? []) oyente();
  };
  return {
    mapa,
    oyentes: () => (oyentes.get("move")?.size ?? 0) + (oyentes.get("moveend")?.size ?? 0),
    /** Un paso del movimiento: el mapa emite varios `move` por fotograma. */
    mover: (cambio: { readonly dx?: number; readonly zoom?: number }) => {
      centro = { longitud: centro.longitud + (cambio.dx ?? 0), latitud: centro.latitud };
      zoom = cambio.zoom ?? zoom;
      emitir("move");
      emitir("move");
    },
    asentar: () => emitir("moveend"),
  };
};

/** Un reloj de fotogramas que la prueba hace latir. */
const relojDePrueba = () => {
  const pendientes = new Map<number, () => void>();
  let siguiente = 1;
  const reloj: Reloj = {
    pedir: (f) => {
      pendientes.set(siguiente, f);
      siguiente += 1;
      return siguiente - 1;
    },
    cancelar: (id) => {
      pendientes.delete(id);
    },
  };
  return {
    reloj,
    latir: () => {
      const ahora = [...pendientes.values()];
      pendientes.clear();
      for (const f of ahora) f();
    },
  };
};

const seguir = () => {
  const prueba = mapaDePrueba();
  const { reloj, latir } = relojDePrueba();
  const vistas: Array<Vista> = [];
  let fotogramas = 0;
  const dejar = seguirVista(
    prueba.mapa,
    {
      fotograma: () => {
        fotogramas += 1;
      },
      vista: (vista) => vistas.push(vista),
    },
    reloj,
  );
  return { ...prueba, latir, dejar, vistas, fotogramas: () => fotogramas };
};

describe("seguirVista", () => {
  it("decide qué se dibuja al empezar y recoloca como mucho una vez por fotograma", () => {
    const seguido = seguir();
    assert.strictEqual(seguido.vistas.length, 1);
    seguido.mover({ dx: 0.001 });
    seguido.mover({ dx: 0.001 });
    seguido.latir();
    assert.strictEqual(seguido.fotogramas(), 1);
  });

  it("no vuelve a agrupar mientras se arrastra el mapa, solo al asentarse", () => {
    const seguido = seguir();
    for (let i = 0; i < 30; i += 1) {
      seguido.mover({ dx: 0.0005 });
      seguido.latir();
    }
    assert.strictEqual(seguido.fotogramas(), 30);
    assert.strictEqual(seguido.vistas.length, 1);
    seguido.asentar();
    assert.strictEqual(seguido.vistas.length, 2);
  });

  it("al acercar varios niveles no agrupa por el camino: la agrupación nueva llega al soltar", () => {
    const seguido = seguir();
    for (let zoom = 14.5; zoom <= 17.5; zoom += 0.1) {
      seguido.mover({ zoom });
      seguido.latir();
    }
    assert.strictEqual(seguido.vistas.length, 1);
    seguido.asentar();
    assert.strictEqual(seguido.vistas.length, 2);
    assert.closeTo(seguido.vistas[1]?.zoom ?? 0, 17.5, 0.11);
  });

  it("al alejar agrupa por el camino cuando cambia de nivel y la vista se sale de lo dibujado", () => {
    const seguido = seguir();
    seguido.mover({ zoom: 14.1 });
    seguido.asentar();
    assert.strictEqual(seguido.vistas.length, 2);
    // La vista aún cabe en la caja con margen: aunque cruce al nivel 13, espera.
    seguido.mover({ zoom: 13.9 });
    seguido.latir();
    assert.strictEqual(seguido.vistas.length, 2);
    // Más lejos, los bordes quedarían vacíos: agrupa ya, al nivel nuevo.
    seguido.mover({ zoom: 13.4 });
    seguido.latir();
    assert.strictEqual(seguido.vistas.length, 3);
    assert.closeTo(seguido.vistas[2]?.zoom ?? 0, 13.4, 1e-9);
    // Y no otra vez hasta que vuelva a salirse y cambie de nivel.
    seguido.mover({ zoom: 13.3 });
    seguido.latir();
    assert.strictEqual(seguido.vistas.length, 3);
  });

  it("deja de escuchar al mapa y cancela el fotograma pedido", () => {
    const seguido = seguir();
    seguido.mover({ dx: 0.001 });
    seguido.dejar();
    seguido.latir();
    assert.strictEqual(seguido.oyentes(), 0);
    assert.strictEqual(seguido.fotogramas(), 0);
  });
});
