import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";

import { crearAgrupador } from "../capa/agrupacion.ts";
import { prefijoDeProvincia, type ProvinciaCargada } from "../capa/nacional.ts";
import { estados, NOCHE, RESUMEN } from "../capa/pruebasNacional.ts";
import { type MapaDeMarcadores, Marcadores } from "./Marcadores.tsx";

type Evento = "move" | "moveend" | "idle";

const ANCHO = 1200;
const ALTO = 1000;

/** Píxeles por grado al zoom 0, como los teselas de 512 px de MapLibre. */
const PIXELES_POR_GRADO = 512 / 360;

/**
 * Un mapa de prueba con lo que los marcadores usan de MapLibre: proyecta en línea recta con la
 * escala del zoom, se mueve y se acerca a mano y emite sus eventos como MapLibre, en el mismo
 * `move` en que cambia la cámara.
 */
const mapaDePrueba = (inicio: { readonly centro: Coordenada; readonly zoom: number }) => {
  const oyentes = new Map<Evento, Set<() => void>>();
  let centro = inicio.centro;
  let zoom = inicio.zoom;
  const contenedor = document.createElement("div");
  Object.defineProperty(contenedor, "clientWidth", { value: ANCHO });
  Object.defineProperty(contenedor, "clientHeight", { value: ALTO });
  const lienzo = document.createElement("div");
  contenedor.append(lienzo);
  document.body.append(contenedor);
  const escala = () => PIXELES_POR_GRADO * 2 ** zoom;
  const project = ([longitud, latitud]: [number, number]) => ({
    x: ANCHO / 2 + (longitud - centro.longitud) * escala(),
    y: ALTO / 2 - (latitud - centro.latitud) * escala(),
  });
  const mapa: MapaDeMarcadores = {
    on: (evento, oyente) => {
      const suyos = oyentes.get(evento) ?? new Set();
      suyos.add(oyente);
      oyentes.set(evento, suyos);
    },
    off: (evento, oyente) => {
      oyentes.get(evento)?.delete(oyente);
    },
    getBounds: () => {
      const medioAncho = ANCHO / 2 / escala();
      const medioAlto = ALTO / 2 / escala();
      return {
        getWest: () => centro.longitud - medioAncho,
        getEast: () => centro.longitud + medioAncho,
        getSouth: () => centro.latitud - medioAlto,
        getNorth: () => centro.latitud + medioAlto,
      };
    },
    getZoom: () => zoom,
    getMaxZoom: () => 19,
    getCenter: () => ({ lng: centro.longitud, lat: centro.latitud }),
    project,
    getContainer: () => contenedor,
    getCanvasContainer: () => lienzo,
    getCanvas: () => lienzo,
    // Sin capas de MapLibre: con la vista de puntos y sin cambiar de vista no se añade ninguna.
    getLayer: () => undefined,
    getLayersOrder: () => [],
    addLayer: () => undefined,
    removeLayer: () => undefined,
    getSource: () => undefined,
    setGlobalStateProperty: () => undefined,
    queryRenderedFeatures: () => [],
    isMoving: () => false,
    // Abrir un hexágono no se prueba aquí.
    easeTo: () => undefined,
    cameraForBounds: () => undefined,
  };
  const emitir = (evento: Evento) => {
    for (const oyente of oyentes.get(evento) ?? []) oyente();
  };
  return {
    mapa,
    lienzo,
    proyectar: (posicion: Coordenada) => project([posicion.longitud, posicion.latitud]),
    /** Un fotograma de un gesto: la cámara cambia y MapLibre avisa con `move`. */
    mover: (cambio: { readonly zoom?: number; readonly dx?: number }) => {
      zoom = cambio.zoom ?? zoom;
      centro = { longitud: centro.longitud + (cambio.dx ?? 0), latitud: centro.latitud };
      emitir("move");
    },
    quitar: () => contenedor.remove(),
  };
};

const emplazamiento = (clave: string, longitud: number, latitud: number): EmplazamientoLeido => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
  barrio: null,
  lote: 0,
  provincia: "08",
  municipio: null,
});

// En la caja de la Barcelona de prueba: dos casi juntos, que a zoom 15 van en una agrupación, y
// tres sueltos a unos cientos de píxeles.
const CENTRO: Coordenada = { longitud: 2.42, latitud: 41.912 };
const EMPLAZAMIENTOS = [
  emplazamiento("a", 2.42, 41.91),
  emplazamiento("b", 2.42015, 41.9101),
  emplazamiento("c", 2.425, 41.914),
  emplazamiento("d", 2.415, 41.908),
  emplazamiento("e", 2.4235, 41.909),
];
const POSICIONES = new Map(EMPLAZAMIENTOS.map((e) => [e.clave, e.posicion]));

const BARCELONA: ProvinciaCargada = {
  codigo: "08",
  version: RESUMEN.version,
  fecha: NOCHE,
  capa: {
    provincia: "08",
    emplazamientos: EMPLAZAMIENTOS,
    barrios: [],
    fuenteDeBarrios: undefined,
    municipios: [],
    lotes: ["fichas/08/prueba.json"],
  },
  agrupador: crearAgrupador(EMPLAZAMIENTOS, [], { prefijo: prefijoDeProvincia("08") }),
};

const traslado = (elemento: Element | null): Salto => {
  const estilo = elemento instanceof HTMLElement ? elemento.style.transform : "";
  const partes = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/u.exec(estilo);
  return partes === null ? { x: 0, y: 0 } : { x: Number(partes[1]), y: Number(partes[2]) };
};

/** Dónde está en la pantalla un elemento colocado en una lámina: su sitio más el de la lámina. */
const enPantalla = (elemento: HTMLElement | null, ajuste = 0): Salto => {
  const propio = traslado(elemento);
  const lamina = traslado(elemento?.parentElement ?? null);
  return { x: propio.x + ajuste + lamina.x, y: propio.y + ajuste + lamina.y };
};

/**
 * Los puntos que se mueven, que son los círculos que no van en un marcador: dónde se ve su centro
 * en la pantalla y hacia dónde queda su marcador.
 */
const puntosQueSeMueven = (lienzo: HTMLElement) =>
  [...lienzo.querySelectorAll<HTMLElement>("span.rounded-full")]
    .filter((circulo) => circulo.closest("section") === null)
    .map((circulo) => {
      const punto = circulo.parentElement;
      const centro = enPantalla(punto, Number.parseFloat(punto?.style.width ?? "0") / 2);
      return {
        ...centro,
        marcador: {
          x: centro.x + Number.parseFloat(circulo.style.getPropertyValue("--traspaso-x")),
          y: centro.y + Number.parseFloat(circulo.style.getPropertyValue("--traspaso-y")),
        },
      };
    });

const distancia = (a: Salto, b: Salto) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Comprueba que cada punto que se mueve está, a menos de 1 px, en el sitio de un emplazamiento
 * distinto según la cámara de ahora. Devuelve cuántos son.
 */
const enSuSitio = (prueba: ReturnType<typeof mapaDePrueba>, momento: string): number => {
  const puntos = puntosQueSeMueven(prueba.lienzo);
  const libres = new Map(POSICIONES);
  for (const punto of puntos) {
    let mejor: { clave: string; distancia: number } | undefined;
    for (const [clave, posicion] of libres) {
      const lejos = distancia(prueba.proyectar(posicion), punto);
      if (mejor === undefined || lejos < mejor.distancia) mejor = { clave, distancia: lejos };
    }
    assert.isDefined(mejor, `${momento}: hay más puntos que emplazamientos`);
    assert.isBelow(
      mejor?.distancia ?? Infinity,
      1,
      `${momento}: un punto está a ${mejor?.distancia.toFixed(1)} px de su emplazamiento`,
    );
    libres.delete(mejor?.clave ?? "");
  }
  return puntos.length;
};

/**
 * Comprueba que cada punto que se mueve va hacia un marcador, o sale de él, donde ese marcador
 * está según la cámara de ahora. Devuelve cuántos no van a su propio logo sino a un hexágono.
 */
const haciaSuMarcador = (prueba: ReturnType<typeof mapaDePrueba>, momento: string): number => {
  const marcadores = [...prueba.lienzo.querySelectorAll<HTMLElement>("section > button")].map(
    (boton) => enPantalla(boton),
  );
  const puntos = puntosQueSeMueven(prueba.lienzo);
  assert.isAbove(puntos.length, 0, `${momento}: no se mueve ningún punto`);
  for (const punto of puntos) {
    const suyo = Math.min(...marcadores.map((marcador) => distancia(marcador, punto.marcador)));
    assert.isBelow(suyo, 1, `${momento}: un punto va a ${suyo.toFixed(1)} px de su marcador`);
  }
  return puntos.filter((punto) => distancia(punto, punto.marcador) > 1).length;
};

const montar = (zoom: number, con: boolean) => {
  const prueba = mapaDePrueba({ centro: CENTRO, zoom });
  const [conMarcadores, setConMarcadores] = createSignal(con);
  const vista = render(() => (
    <Marcadores
      mapa={prueba.mapa}
      resumen={RESUMEN}
      provincias={estados(["08", { tipo: "lista", provincia: BARCELONA }])}
      seleccionada={null}
      alSeleccionar={() => undefined}
      vista="puntos"
      conMarcadores={conMarcadores()}
    />
  ));
  flush();
  return {
    ...prueba,
    setConMarcadores: (con: boolean) => {
      setConMarcadores(con);
      flush();
    },
    mover: (cambio: { readonly zoom?: number; readonly dx?: number }) => {
      prueba.mover(cambio);
      flush();
    },
    desmontar: () => {
      vista.unmount();
      prueba.quitar();
    },
  };
};

describe("los puntos que se mueven entre los puntos y los logos (#74)", () => {
  it("al alejar, siguen en el sitio de su emplazamiento aunque el zoom siga cambiando", () => {
    const prueba = montar(15.5, true);
    try {
      assert.isAbove(prueba.lienzo.querySelectorAll("section button").length, 0);
      // El gesto cruza el 15: salen los puntos y el zoom sigue bajando mientras se mueven.
      prueba.mover({ zoom: 14.95 });
      prueba.setConMarcadores(false);
      assert.strictEqual(enSuSitio(prueba, "al cruzar el 15"), EMPLAZAMIENTOS.length);
      for (const zoom of [14.8, 14.5, 14.1, 13.6, 13]) {
        prueba.mover({ zoom });
        enSuSitio(prueba, `a zoom ${zoom}`);
      }
      // Arrastrar mueve la lámina entera, y otra vez el zoom.
      prueba.mover({ dx: 0.002 });
      enSuSitio(prueba, "tras arrastrar");
      prueba.mover({ zoom: 13.4 });
      assert.strictEqual(enSuSitio(prueba, "tras arrastrar y acercar"), EMPLAZAMIENTOS.length);
    } finally {
      prueba.desmontar();
    }
  });

  it("al acercar, y al dar la vuelta a mitad de paso, también", () => {
    const prueba = montar(14.6, false);
    try {
      assert.lengthOf(puntosQueSeMueven(prueba.lienzo), 0);
      prueba.mover({ zoom: 15.05 });
      prueba.setConMarcadores(true);
      assert.strictEqual(enSuSitio(prueba, "al cruzar el 15"), EMPLAZAMIENTOS.length);
      prueba.mover({ zoom: 15.4 });
      enSuSitio(prueba, "a zoom 15,4");
      // Vuelve a alejar antes de que acaben: los mismos puntos dan la vuelta.
      prueba.mover({ zoom: 14.9 });
      prueba.setConMarcadores(false);
      enSuSitio(prueba, "al volver a cruzar el 15");
      prueba.mover({ zoom: 14.2 });
      assert.strictEqual(enSuSitio(prueba, "a zoom 14,2"), EMPLAZAMIENTOS.length);
    } finally {
      prueba.desmontar();
    }
  });

  it("salen de su marcador, o van a él, donde está a cada zoom", () => {
    const prueba = montar(15.5, true);
    try {
      prueba.mover({ zoom: 14.95 });
      prueba.setConMarcadores(false);
      // Los dos de la agrupación salen de su hexágono; los sueltos, de su logo, en su sitio.
      assert.strictEqual(haciaSuMarcador(prueba, "al cruzar el 15"), 2);
      for (const zoom of [14.7, 14.2, 13.5]) {
        prueba.mover({ zoom });
        assert.strictEqual(haciaSuMarcador(prueba, `a zoom ${zoom}`), 2);
      }
      // Da la vuelta: ahora van a los logos y al hexágono que salen.
      prueba.mover({ zoom: 15.1 });
      prueba.setConMarcadores(true);
      haciaSuMarcador(prueba, "al volver a cruzar el 15");
      prueba.mover({ zoom: 15.6 });
      haciaSuMarcador(prueba, "a zoom 15,6");
    } finally {
      prueba.desmontar();
    }
  });
});
