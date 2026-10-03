import type { Coordenada } from "@celda/dominio/area";
import { desdePlano } from "@celda/dominio/plano";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import { estiloMapa } from "@celda/ui/mapa/estilo.ts";
import { CONTORNO_DE_ESPANA } from "@celda/ui/mapa/espana.ts";
import { FOTO_AEREA } from "@celda/ui/mapa/expresiones.ts";
import { FUENTE_CELDAS } from "@celda/ui/mapa/celdas.ts";
import { type EstadoConFoto, FUENTE_EDIFICIO } from "@celda/ui/mapa/foto.ts";
import { CAPA_PORTALES } from "@celda/ui/mapa/rotulos.ts";
import { CAPA_EDIFICIOS } from "@celda/ui/mapa/suelo.ts";
import type { StyleSpecification } from "maplibre-gl";
import { createSignal, flush, type Setter } from "solid-js";

import { otraTarea } from "../lib/pruebas.ts";
import type { DibujoDelEdificio, EdificioEncontrado, RasgoDelMapa } from "./edificio.ts";
import {
  crearFoto,
  type FotoDelMapa,
  type LienzoDeFoto,
  lienzoDeFoto,
  type MapaParaFoto,
} from "./enMapa.ts";
import { ZOOM_EDIFICIO } from "./foto.ts";

/** Passeig de Gràcia, 68. */
const SITIO: Coordenada = { longitud: 2.16395, latitud: 41.39385 };
const OTRO: Coordenada = { longitud: 2.1636, latitud: 41.3941 };

const esperar = async (condicion: () => void) => {
  flush();
  await waitFor(() => {
    flush();
    condicion();
  });
};

// --- el controlador, sobre un lienzo que apunta ------------------------------------------------

interface Vuelo {
  readonly posicion: Coordenada;
  readonly desplazamiento: readonly [number, number];
  readonly acabar: (encontrado: EdificioEncontrado | undefined) => void;
  dejado: boolean;
}

/** Un lienzo que apunta lo que recibe; cada vuelo acaba cuando la prueba lo dice. */
const lienzoDePrueba = () => {
  const fotos: Array<boolean> = [];
  const vuelos: Array<Vuelo> = [];
  let quitados = 0;
  const lienzo: LienzoDeFoto = {
    ponerFoto: (encendida) => fotos.push(encendida),
    verEdificio: (posicion, desplazamiento, alAcabar) => {
      const vuelo: Vuelo = {
        posicion,
        desplazamiento,
        dejado: false,
        // Como MapLibre, el mapa se queda quieto en otra tarea.
        acabar: (encontrado) => {
          void otraTarea().then(() => {
            if (!vuelo.dejado) alAcabar(encontrado);
          });
        },
      };
      vuelos.push(vuelo);
      return () => {
        vuelo.dejado = true;
      };
    },
    quitarEdificio: () => {
      quitados += 1;
    },
  };
  return { lienzo, fotos, vuelos, quitados: () => quitados };
};

interface Mandos {
  readonly foto: FotoDelMapa;
  readonly setSeleccionada: Setter<string | null>;
}

const montar = () => {
  const prueba = lienzoDePrueba();
  let mandos: Mandos | undefined;
  const { unmount } = render(() => {
    const [seleccionada, setSeleccionada] = createSignal<string | null>("movistar-1");
    const foto = crearFoto({
      lienzo: () => prueba.lienzo,
      seleccionada,
      desplazamiento: () => [0, -94],
    });
    mandos = { foto, setSeleccionada };
    return null;
  });
  flush();
  if (mandos === undefined) throw new Error("La prueba no ha montado");
  return { ...prueba, ...mandos, desmontar: unmount };
};

const EDIFICIO: EdificioEncontrado = {
  tipo: "edificio",
  como: "contiene",
  poligonos: [],
  portal: { numero: "251-259", punto: SITIO },
};

describe("foto aérea en el mapa", () => {
  it("empieza apagada, y se enciende y se apaga con el control, sin pedir nada de más", () => {
    const m = montar();
    assert.isFalse(m.foto.encendida());
    assert.deepStrictEqual(m.fotos, [false]);
    // Ocho pulsaciones seguidas: más de diez por segundo, el vigilante lo daría por un bucle.
    for (let vez = 0; vez < 8; vez++) {
      m.foto.alternar();
      flush();
    }
    assert.isFalse(m.foto.encendida());
    assert.deepStrictEqual(m.fotos, [false, true, false, true, false, true, false, true, false]);
    m.foto.encender();
    m.foto.encender();
    flush();
    assert.isTrue(m.foto.encendida());
    assert.strictEqual(m.fotos.length, 10);
    m.desmontar();
  });

  it("«Ver el edificio» enciende la foto, vuela una vez y dice el número del edificio", async () => {
    const m = montar();
    assert.deepStrictEqual(m.foto.edificio("movistar-1"), { tipo: "parado" });
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.isTrue(m.foto.encendida());
    assert.strictEqual(m.fotos.at(-1), true);
    assert.lengthOf(m.vuelos, 1);
    assert.deepStrictEqual(m.vuelos[0]?.posicion, SITIO);
    assert.deepStrictEqual(m.vuelos[0]?.desplazamiento, [0, -94]);
    assert.deepStrictEqual(m.foto.edificio("movistar-1"), { tipo: "buscando" });
    assert.deepStrictEqual(m.foto.edificio("movistar-2"), { tipo: "parado" });

    m.vuelos[0]?.acabar(EDIFICIO);
    await esperar(() =>
      assert.deepStrictEqual(m.foto.edificio("movistar-1"), {
        tipo: "resaltado",
        numero: "251-259",
      }),
    );
    // Lo que escribe el resultado no vuelve a volar.
    assert.lengthOf(m.vuelos, 1);
    m.desmontar();
  });

  it("sin edificio a menos de 25 m dice «Sin contorno»; sin número, que está resaltado", async () => {
    const m = montar();
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    m.vuelos[0]?.acabar({ tipo: "ninguno" });
    await esperar(() =>
      assert.deepStrictEqual(m.foto.edificio("movistar-1"), { tipo: "sin-contorno" }),
    );

    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.lengthOf(m.vuelos, 2);
    assert.isTrue(m.vuelos[0]?.dejado);
    m.vuelos[1]?.acabar({ ...EDIFICIO, portal: undefined });
    await esperar(() =>
      assert.deepStrictEqual(m.foto.edificio("movistar-1"), {
        tipo: "resaltado",
        numero: undefined,
      }),
    );
    m.desmontar();
  });

  it("otro emplazamiento o cerrar la ficha quita el resaltado y deja de esperar al vuelo", async () => {
    const m = montar();
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    m.setSeleccionada("movistar-2");
    flush();
    assert.isTrue(m.vuelos[0]?.dejado);
    assert.strictEqual(m.quitados(), 1);
    m.vuelos[0]?.acabar(EDIFICIO);
    await otraTarea();
    flush();
    assert.deepStrictEqual(m.foto.edificio("movistar-1"), { tipo: "parado" });
    // Volver al primero no vuelve a volar solo.
    m.setSeleccionada("movistar-1");
    flush();
    assert.lengthOf(m.vuelos, 1);

    m.foto.verEdificio("movistar-1", OTRO);
    flush();
    m.setSeleccionada(null);
    flush();
    assert.strictEqual(m.quitados(), 2);
    // La foto sigue como la dejó la persona.
    assert.isTrue(m.foto.encendida());
    m.desmontar();
  });
});

// --- el lienzo, sobre un mapa que imita a MapLibre ----------------------------------------------

/** Píxeles por grado alrededor del sitio, más o menos los del zoom 18,5. */
const PIXELES_POR_GRADO = 1_200_000;

const metrosAl = (este: number, norte: number) => {
  const { longitud, latitud } = desdePlano(SITIO, { este, norte });
  return [longitud, latitud];
};
const cuadrado = (lado: number, centroEste = 0) => [
  [
    metrosAl(centroEste - lado, -lado),
    metrosAl(centroEste + lado, -lado),
    metrosAl(centroEste + lado, lado),
    metrosAl(centroEste - lado, lado),
    metrosAl(centroEste - lado, -lado),
  ],
];

/** Lo que cambiaría el estilo entero o sus capas: la foto no lo usa nunca. */
interface MapaQueNoSeToca {
  readonly setStyle: () => void;
  readonly addLayer: () => void;
  readonly removeLayer: () => void;
  readonly addSource: () => void;
  readonly removeSource: () => void;
}

/**
 * Un mapa con el estilo de Celda, como MapLibre: guarda el estado del estilo, entrega los eventos
 * en otra tarea y contesta a `queryRenderedFeatures` con lo que la prueba le da por capa. Apunta
 * cualquier llamada que cambie el estilo entero o sus capas.
 */
const mapaDePrueba = (pintado: Partial<Record<string, ReadonlyArray<RasgoDelMapa>>>) => {
  const estilo: StyleSpecification = estiloMapa((token) => `token:${token}`, CONTORNO_DE_ESPANA);
  const capasAntes = JSON.stringify(estilo.layers);
  const fuentesAntes = Object.keys(estilo.sources);
  const estado: EstadoConFoto = {};
  const escuchadores = new Map<string, Set<() => void>>();
  const datos = new Map<string, DibujoDelEdificio>();
  const prohibidas: Array<string> = [];
  const vuelos: Array<{ center: [number, number]; zoom: number; offset: [number, number] }> = [];
  const centro = { x: 195, y: 422 };
  const emitir = (evento: string) => {
    for (const escuchador of escuchadores.get(evento) ?? []) escuchador();
  };
  const prohibida = (nombre: string) => () => {
    prohibidas.push(nombre);
  };
  const mapa: MapaParaFoto & MapaQueNoSeToca = {
    getGlobalState: () => estado,
    setGlobalStateProperty: (nombre, valor) => {
      if (nombre === FOTO_AEREA) estado[FOTO_AEREA] = valor;
    },
    setStyle: prohibida("setStyle"),
    addLayer: prohibida("addLayer"),
    removeLayer: prohibida("removeLayer"),
    addSource: prohibida("addSource"),
    removeSource: prohibida("removeSource"),
    flyTo: (opciones) => {
      vuelos.push({ ...opciones });
    },
    on: (evento, escuchador) => {
      escuchadores.set(evento, new Set([...(escuchadores.get(evento) ?? []), escuchador]));
    },
    off: (evento, escuchador) => {
      escuchadores.get(evento)?.delete(escuchador);
    },
    project: ([longitud, latitud]) => ({
      x: centro.x + (longitud - SITIO.longitud) * PIXELES_POR_GRADO,
      y: centro.y - (latitud - SITIO.latitud) * PIXELES_POR_GRADO,
    }),
    getBounds: () => ({
      contains: ([longitud, latitud]) =>
        Math.abs(longitud - SITIO.longitud) < 0.001 && Math.abs(latitud - SITIO.latitud) < 0.001,
    }),
    queryRenderedFeatures: (_caja, { layers }) => layers.flatMap((capa) => pintado[capa] ?? []),
    getSource: (fuente) =>
      fuente in estilo.sources
        ? {
            type: "geojson",
            setData: (dibujo: DibujoDelEdificio) => {
              datos.set(fuente, dibujo);
            },
          }
        : undefined,
  };
  return {
    mapa,
    estado,
    datos,
    vuelos,
    prohibidas,
    escuchadores: () => [...escuchadores.values()].reduce((n, s) => n + s.size, 0),
    emitirEnOtraTarea: async (evento: string) => {
      await otraTarea();
      emitir(evento);
    },
    sinCambiosEnElEstilo: () =>
      JSON.stringify(estilo.layers) === capasAntes &&
      JSON.stringify(Object.keys(estilo.sources)) === JSON.stringify(fuentesAntes),
  };
};

describe("lienzo de la foto en un mapa de MapLibre", () => {
  it("encender y apagar la foto diez veces solo cambia el estado del estilo", () => {
    const m = mapaDePrueba({});
    const lienzo = lienzoDeFoto(m.mapa);
    for (let vez = 0; vez < 10; vez++) lienzo.ponerFoto(vez % 2 === 0);
    assert.isFalse(m.estado[FOTO_AEREA]);
    assert.deepStrictEqual(m.prohibidas, []);
    assert.isTrue(m.sinCambiosEnElEstilo());
    // Las celdas y el edificio siguen con su fuente: nada se ha quitado ni añadido.
    assert.isDefined(m.mapa.getSource(FUENTE_CELDAS));
    assert.isDefined(m.mapa.getSource(FUENTE_EDIFICIO));
  });

  it("vuela al zoom del edificio y, quieto el mapa, resalta su contorno con su número", async () => {
    const m = mapaDePrueba({
      [CAPA_EDIFICIOS]: [
        { id: 9, properties: {}, geometry: { type: "Polygon", coordinates: cuadrado(15) } },
        { id: 10, properties: {}, geometry: { type: "Polygon", coordinates: cuadrado(10, 40) } },
      ],
      [CAPA_PORTALES]: [
        {
          properties: { housenumber: "251;259" },
          geometry: { type: "Point", coordinates: metrosAl(-10, 8) },
        },
        {
          properties: { housenumber: "70" },
          geometry: { type: "Point", coordinates: metrosAl(40, 0) },
        },
      ],
    });
    const lienzo = lienzoDeFoto(m.mapa);
    const encontrados: Array<EdificioEncontrado | undefined> = [];
    lienzo.verEdificio(SITIO, [0, -94], (encontrado) => encontrados.push(encontrado));
    assert.deepStrictEqual(m.vuelos, [
      { center: [SITIO.longitud, SITIO.latitud], zoom: ZOOM_EDIFICIO, offset: [0, -94] },
    ]);
    // Al parar aún no busca: espera a que el mapa esté quieto con sus teselas.
    await m.emitirEnOtraTarea("moveend");
    assert.lengthOf(encontrados, 0);
    await m.emitirEnOtraTarea("idle");
    assert.lengthOf(encontrados, 1);
    const encontrado = encontrados[0];
    assert.strictEqual(encontrado?.tipo, "edificio");
    assert.strictEqual(encontrado?.tipo === "edificio" ? encontrado.portal?.numero : "", "251-259");
    const dibujo = m.datos.get(FUENTE_EDIFICIO);
    assert.deepStrictEqual(
      dibujo?.features.map((rasgo) => rasgo.geometry.type),
      ["Polygon", "Point"],
    );
    // Un solo `idle` basta: después no queda nada escuchando.
    assert.strictEqual(m.escuchadores(), 0);
    await m.emitirEnOtraTarea("idle");
    assert.lengthOf(encontrados, 1);

    lienzo.quitarEdificio();
    assert.deepStrictEqual(m.datos.get(FUENTE_EDIFICIO)?.features, []);
    assert.deepStrictEqual(m.prohibidas, []);
  });

  it("sin edificio cerca no dibuja nada y lo dice; dejar de esperar quita los escuchadores", async () => {
    const m = mapaDePrueba({});
    const lienzo = lienzoDeFoto(m.mapa);
    const encontrados: Array<EdificioEncontrado | undefined> = [];
    lienzo.verEdificio(SITIO, [216, 0], (encontrado) => encontrados.push(encontrado));
    await m.emitirEnOtraTarea("moveend");
    await m.emitirEnOtraTarea("idle");
    assert.deepStrictEqual(encontrados, [{ tipo: "ninguno" }]);
    assert.deepStrictEqual(m.datos.get(FUENTE_EDIFICIO)?.features, []);

    const dejar = lienzo.verEdificio(SITIO, [216, 0], (encontrado) => encontrados.push(encontrado));
    await m.emitirEnOtraTarea("moveend");
    dejar();
    assert.strictEqual(m.escuchadores(), 0);
    await m.emitirEnOtraTarea("idle");
    assert.lengthOf(encontrados, 1);
  });
});
