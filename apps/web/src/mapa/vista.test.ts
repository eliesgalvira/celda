import { assert, describe, it } from "@effect/vitest";

import type { Vista } from "../capa/marcadores.ts";
import { type Lamina, type MapaQueSeMueve, seguirVista } from "./vista.ts";

type Evento = "move" | "moveend";

/** Píxeles por grado al zoom 0: el mapa de prueba proyecta en línea recta, con la escala del zoom. */
const PIXELES_POR_GRADO = 1;

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
    getCenter: () => ({ lng: centro.longitud, lat: centro.latitud }),
    project: ([longitud, latitud]) => ({
      x: (longitud - centro.longitud) * PIXELES_POR_GRADO * 2 ** zoom,
      y: (centro.latitud - latitud) * PIXELES_POR_GRADO * 2 ** zoom,
    }),
  };
  const emitir = (evento: Evento) => {
    for (const oyente of oyentes.get(evento) ?? []) oyente();
  };
  return {
    mapa,
    oyentes: () => (oyentes.get("move")?.size ?? 0) + (oyentes.get("moveend")?.size ?? 0),
    /** Un paso del movimiento: `dx` grados hacia el este o un zoom nuevo. */
    mover: (cambio: { readonly dx?: number; readonly zoom?: number }) => {
      centro = { longitud: centro.longitud + (cambio.dx ?? 0), latitud: centro.latitud };
      zoom = cambio.zoom ?? zoom;
      emitir("move");
    },
    asentar: () => emitir("moveend"),
  };
};

const seguir = () => {
  const prueba = mapaDePrueba();
  const vistas: Array<Vista> = [];
  const laminas: Array<Lamina> = [];
  const dejar = seguirVista(prueba.mapa, {
    lamina: (lamina) => laminas.push(lamina),
    vista: (vista) => vistas.push(vista),
  });
  return { ...prueba, dejar, vistas, laminas, ultima: () => laminas.at(-1) };
};

describe("seguirVista", () => {
  it("al empezar coloca la lámina en su sitio y decide qué se dibuja", () => {
    const seguido = seguir();
    assert.deepStrictEqual(seguido.laminas, [{ zoom: 14.5, salto: { x: 0, y: 0 } }]);
    assert.strictEqual(seguido.vistas.length, 1);
  });

  it("al arrastrar mueve la lámina en cada `move`, sin recolocar ni volver a agrupar", () => {
    const seguido = seguir();
    const pixelesPorGrado = PIXELES_POR_GRADO * 2 ** 14.5;
    for (let i = 1; i <= 30; i += 1) {
      seguido.mover({ dx: 0.0005 });
      // El mapa va hacia el este: lo colocado se desplaza hacia la izquierda.
      assert.closeTo(seguido.ultima()?.salto.x ?? 0, -0.0005 * i * pixelesPorGrado, 1e-6);
      assert.strictEqual(seguido.ultima()?.salto.y, 0);
    }
    assert.strictEqual(seguido.laminas.length, 31);
    assert.isTrue(seguido.laminas.every((lamina) => lamina.zoom === 14.5));
    assert.strictEqual(seguido.vistas.length, 1);
    seguido.asentar();
    assert.strictEqual(seguido.vistas.length, 2);
  });

  it("al cambiar el zoom vuelve a colocar los marcadores, con la lámina en su sitio", () => {
    const seguido = seguir();
    seguido.mover({ dx: 0.001 });
    assert.notStrictEqual(seguido.ultima()?.salto.x, 0);
    seguido.mover({ zoom: 14.6 });
    assert.deepStrictEqual(seguido.ultima(), { zoom: 14.6, salto: { x: 0, y: 0 } });
    // Y al seguir arrastrando, el salto cuenta desde ahí.
    seguido.mover({ dx: 0.001 });
    assert.strictEqual(seguido.ultima()?.zoom, 14.6);
    assert.closeTo(seguido.ultima()?.salto.x ?? 0, -0.001 * PIXELES_POR_GRADO * 2 ** 14.6, 1e-6);
  });

  it("al acercar varios niveles no agrupa por el camino: la agrupación nueva llega al soltar", () => {
    const seguido = seguir();
    for (let zoom = 14.5; zoom <= 17.5; zoom += 0.1) {
      seguido.mover({ zoom });
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
    assert.strictEqual(seguido.vistas.length, 2);
    // Más lejos, los bordes quedarían vacíos: agrupa ya, al nivel nuevo.
    seguido.mover({ zoom: 13.4 });
    assert.strictEqual(seguido.vistas.length, 3);
    assert.closeTo(seguido.vistas[2]?.zoom ?? 0, 13.4, 1e-9);
    // Y no otra vez hasta que vuelva a salirse y cambie de nivel.
    seguido.mover({ zoom: 13.3 });
    assert.strictEqual(seguido.vistas.length, 3);
  });

  it("deja de escuchar al mapa", () => {
    const seguido = seguir();
    seguido.dejar();
    seguido.mover({ dx: 0.001 });
    assert.strictEqual(seguido.oyentes(), 0);
    assert.strictEqual(seguido.laminas.length, 1);
  });
});
