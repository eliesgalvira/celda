import type { Coordenada } from "@celda/dominio/area";
import { desdePlano } from "@celda/dominio/plano";
import { CONTORNO_DE_LA_COMUNITAT_VALENCIANA } from "@celda/dominio/comunitatValenciana";
import { assert, describe, it } from "@effect/vitest";
import { render, waitFor } from "@solidjs/testing-library";
import { estiloMapa } from "@celda/ui/mapa/estilo.ts";
import { CONTORNO_DE_ESPANA } from "@celda/ui/mapa/espana.ts";
import { FOTO_AEREA } from "@celda/ui/mapa/expresiones.ts";
import { FUENTE_CELDAS } from "@celda/ui/mapa/celdas.ts";
import { CAPA_FOTO, type EstadoConFoto, FUENTE_EDIFICIO } from "@celda/ui/mapa/foto.ts";
import { CAPA_PORTALES } from "@celda/ui/mapa/rotulos.ts";
import { CAPA_EDIFICIOS } from "@celda/ui/mapa/suelo.ts";
import type { StyleSpecification } from "maplibre-gl";
import { createSignal, flush, type Setter } from "solid-js";

import { otraTarea } from "../lib/pruebas.ts";
import type { Esperar } from "../mapa/callejero.ts";
import type { DibujoDelEdificio, EdificioEncontrado, RasgoDelMapa } from "./edificio.ts";
import {
  crearFoto,
  type FotoDelMapa,
  type LienzoDeFoto,
  lienzoDeFoto,
  type MapaParaFoto,
  PISTA_ACERCATE_MS,
  PISTA_SIN_CONTORNO_MS,
  PLAZO_DE_LA_FOTO_MS,
} from "./enMapa.ts";
import type { Movimiento } from "../mapa/vistaInicial.ts";
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

/**
 * Un lienzo que apunta lo que recibe; cada vuelo acaba cuando la prueba lo dice. La cámara avisa
 * como la de MapLibre: «Ver el edificio» empieza a volar en el acto, al llamar a `flyTo`, y el
 * mapa se queda quieto con sus teselas en otra tarea.
 */
const lienzoDePrueba = () => {
  const fotos: Array<boolean> = [];
  const vuelos: Array<Vuelo> = [];
  const avisos = new Set<(volando: boolean) => void>();
  let quitados = 0;
  let seguimientos = 0;
  const camara = {
    /** Empieza a moverse: un vuelo de la web o, con `gesto`, la persona. */
    empezar: (gesto = false) => {
      for (const avisar of avisos) avisar(!gesto);
    },
    /** Se para: llega, la interrumpe otro vuelo o la coge la persona. */
    parar: () => {
      for (const avisar of avisos) avisar(false);
    },
  };
  const lienzo: LienzoDeFoto = {
    ponerFoto: (encendida) => {
      fotos.push(encendida);
      return undefined;
    },
    verEdificio: (posicion, desplazamiento, alAcabar) => {
      const vuelo: Vuelo = {
        posicion,
        desplazamiento,
        dejado: false,
        acabar: (encontrado) => {
          camara.parar();
          void otraTarea().then(() => {
            if (!vuelo.dejado) alAcabar(encontrado);
          });
        },
      };
      vuelos.push(vuelo);
      camara.empezar();
      return () => {
        vuelo.dejado = true;
      };
    },
    quitarEdificio: () => {
      quitados += 1;
    },
    seguirVuelos: (alCambiar) => {
      seguimientos += 1;
      avisos.add(alCambiar);
      return () => {
        avisos.delete(alCambiar);
      };
    },
  };
  return {
    lienzo,
    fotos,
    vuelos,
    camara,
    quitados: () => quitados,
    seguimientos: () => seguimientos,
    avisos: () => avisos.size,
  };
};

/** Un reloj de prueba: los plazos vencen al avanzarlo, como `setTimeout`. */
const relojDePrueba = () => {
  let ahora = 0;
  let plazos: Array<{ readonly vence: number; readonly alVencer: () => void }> = [];
  const esperar: Esperar = (ms, alVencer) => {
    const plazo = { vence: ahora + ms, alVencer };
    plazos.push(plazo);
    return () => {
      plazos = plazos.filter((otro) => otro !== plazo);
    };
  };
  const avanzar = (ms: number) => {
    ahora += ms;
    const vencidos = plazos.filter((plazo) => plazo.vence <= ahora);
    plazos = plazos.filter((plazo) => plazo.vence > ahora);
    for (const plazo of vencidos) plazo.alVencer();
    flush();
  };
  return { esperar, avanzar, pendientes: () => plazos.length };
};

interface Mandos {
  readonly foto: FotoDelMapa;
  readonly setSeleccionada: Setter<string | null>;
  /** Cambia el mapa, como cuando se crea otra vez. */
  readonly setLienzo: Setter<LienzoDeFoto | undefined>;
  /** Acerca o aleja el mapa del zoom de la foto. */
  readonly setDeCerca: Setter<boolean>;
}

const montar = () => {
  const prueba = lienzoDePrueba();
  const reloj = relojDePrueba();
  let mandos: Mandos | undefined;
  const { unmount } = render(() => {
    const [seleccionada, setSeleccionada] = createSignal<string | null>("movistar-1");
    const [lienzo, setLienzo] = createSignal<LienzoDeFoto | undefined>(prueba.lienzo);
    const [deCerca, setDeCerca] = createSignal(true);
    const foto = crearFoto({
      lienzo,
      seleccionada,
      deCerca,
      desplazamiento: () => [0, -94],
      esperar: reloj.esperar,
    });
    mandos = { foto, setSeleccionada, setLienzo, setDeCerca };
    return null;
  });
  flush();
  if (mandos === undefined) throw new Error("La prueba no ha montado");
  return { ...prueba, ...mandos, reloj, desmontar: unmount };
};

const EDIFICIO: EdificioEncontrado = {
  tipo: "edificio",
  poligono: [],
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

  it("más lejos del zoom de la foto no se ve aunque esté encendida, y vuelve al acercarse", () => {
    const m = montar();
    m.foto.encender();
    flush();
    assert.deepStrictEqual(m.fotos, [false, true]);
    m.setDeCerca(false);
    flush();
    assert.isTrue(m.foto.encendida());
    assert.isFalse(m.foto.seVe());
    assert.deepStrictEqual(m.fotos, [false, true, false]);
    m.setDeCerca(true);
    flush();
    assert.isTrue(m.foto.seVe());
    assert.deepStrictEqual(m.fotos, [false, true, false, true]);
    m.desmontar();
  });

  it("pulsada desde demasiado lejos no cambia nada y la pista pide acercarse unos 4 s", () => {
    const m = montar();
    m.setDeCerca(false);
    flush();
    m.foto.alternar();
    flush();
    assert.isFalse(m.foto.encendida());
    assert.isTrue(m.foto.acercate());
    m.reloj.avanzar(PISTA_ACERCATE_MS - 1);
    assert.isTrue(m.foto.acercate());
    // Otra pulsación vuelve a contar el plazo.
    m.foto.alternar();
    flush();
    m.reloj.avanzar(PISTA_ACERCATE_MS - 1);
    assert.isTrue(m.foto.acercate());
    m.reloj.avanzar(1);
    assert.isFalse(m.foto.acercate());
    assert.strictEqual(m.reloj.pendientes(), 0);

    // Al acercarse, la pista se va antes y el control vuelve a encender la foto.
    m.foto.alternar();
    flush();
    assert.isTrue(m.foto.acercate());
    m.setDeCerca(true);
    flush();
    assert.isFalse(m.foto.acercate());
    assert.strictEqual(m.reloj.pendientes(), 0);
    m.foto.alternar();
    flush();
    assert.isTrue(m.foto.encendida());
    m.desmontar();
  });

  it("«Ver el edificio» enciende la foto, vuela una vez y dice el número del edificio", async () => {
    const m = montar();
    assert.deepStrictEqual(m.foto.edificio("movistar-1"), { tipo: "parado" });
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.isTrue(m.foto.encendida());
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

  it("sin edificio que contenga el emplazamiento queda sin contorno; sin número, resaltado", async () => {
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

  it("sin edificio que resaltar, la pista lo dice unos 4 s; con edificio, no sale", async () => {
    const m = montar();
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.isFalse(m.foto.sinContorno());
    m.vuelos[0]?.acabar(EDIFICIO);
    await esperar(() => assert.strictEqual(m.foto.edificio("movistar-1").tipo, "resaltado"));
    assert.isFalse(m.foto.sinContorno());
    assert.strictEqual(m.reloj.pendientes(), 0);

    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.isFalse(m.foto.sinContorno());
    m.vuelos[1]?.acabar({ tipo: "ninguno" });
    await esperar(() => assert.isTrue(m.foto.sinContorno()));
    assert.strictEqual(m.reloj.pendientes(), 1);
    m.reloj.avanzar(PISTA_SIN_CONTORNO_MS - 1);
    assert.isTrue(m.foto.sinContorno());
    m.reloj.avanzar(1);
    assert.isFalse(m.foto.sinContorno());
    // Lo que sigue diciendo el botón no la vuelve a sacar.
    assert.deepStrictEqual(m.foto.edificio("movistar-1"), { tipo: "sin-contorno" });
    m.reloj.avanzar(PISTA_SIN_CONTORNO_MS);
    assert.isFalse(m.foto.sinContorno());
    assert.strictEqual(m.reloj.pendientes(), 0);
    m.desmontar();
  });

  it("pulsar otra vez o cerrar la ficha quita la pista y su espera", async () => {
    const m = montar();
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    m.vuelos[0]?.acabar({ tipo: "ninguno" });
    await esperar(() => assert.isTrue(m.foto.sinContorno()));

    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.isFalse(m.foto.sinContorno());
    assert.strictEqual(m.reloj.pendientes(), 0);
    m.vuelos[1]?.acabar({ tipo: "ninguno" });
    await esperar(() => assert.isTrue(m.foto.sinContorno()));

    m.setSeleccionada(null);
    flush();
    assert.isFalse(m.foto.sinContorno());
    assert.strictEqual(m.reloj.pendientes(), 0);
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

describe("foto aérea durante los vuelos de la cámara", () => {
  it("un vuelo con la foto puesta no la quita: no parpadea al despegar ni al llegar", () => {
    const m = montar();
    m.foto.encender();
    flush();
    m.camara.empezar();
    flush();
    assert.isTrue(m.foto.seVe());
    // Aunque el vuelo se aleje del zoom de la foto por el camino.
    m.setDeCerca(false);
    flush();
    assert.isTrue(m.foto.seVe());
    m.setDeCerca(true);
    m.camara.parar();
    flush();
    assert.deepStrictEqual(m.fotos, [false, true]);
    // Un solo seguimiento de la cámara para toda la visita.
    assert.strictEqual(m.seguimientos(), 1);
    m.desmontar();
    assert.strictEqual(m.avisos(), 0);
  });

  it("al llegar decide con lo de ese momento: lejos del zoom de la foto, se quita", () => {
    const m = montar();
    m.foto.encender();
    flush();
    m.camara.empezar();
    m.setDeCerca(false);
    flush();
    assert.isTrue(m.foto.seVe());
    m.camara.parar();
    flush();
    assert.isFalse(m.foto.seVe());
    assert.deepStrictEqual(m.fotos, [false, true, false]);
    m.desmontar();
  });

  it("encender y apagar la foto a mitad de vuelo no toca el mapa hasta que llega", () => {
    const m = montar();
    m.camara.empezar();
    flush();
    for (let vez = 0; vez < 5; vez++) {
      m.foto.alternar();
      flush();
    }
    assert.isTrue(m.foto.encendida());
    assert.deepStrictEqual(m.fotos, [false]);
    // MapLibre para un vuelo y empieza otro en la misma tarea: sigue sin tocarla.
    m.camara.parar();
    m.camara.empezar();
    flush();
    assert.deepStrictEqual(m.fotos, [false]);
    m.camara.parar();
    flush();
    assert.deepStrictEqual(m.fotos, [false, true]);
    m.desmontar();
  });

  it("los gestos de la persona no son vuelos: la foto sigue al zoom", () => {
    const m = montar();
    m.foto.encender();
    flush();
    m.camara.empezar(true);
    m.setDeCerca(false);
    flush();
    assert.isFalse(m.foto.seVe());
    m.setDeCerca(true);
    flush();
    assert.isTrue(m.foto.seVe());
    m.desmontar();
  });

  it("«Ver el edificio» con la foto apagada la enciende al llegar, no al despegar", async () => {
    const m = montar();
    m.foto.verEdificio("movistar-1", SITIO);
    flush();
    assert.isTrue(m.foto.encendida());
    assert.isFalse(m.foto.seVe());
    assert.deepStrictEqual(m.fotos, [false]);
    m.vuelos[0]?.acabar(EDIFICIO);
    flush();
    assert.isTrue(m.foto.seVe());
    await esperar(() =>
      assert.deepStrictEqual(m.foto.edificio("movistar-1"), {
        tipo: "resaltado",
        numero: "251-259",
      }),
    );
    // Con la foto ya puesta, el siguiente vuelo la deja puesta.
    m.foto.verEdificio("movistar-1", OTRO);
    flush();
    m.vuelos[1]?.acabar(EDIFICIO);
    flush();
    assert.deepStrictEqual(m.fotos, [false, true]);
    m.desmontar();
  });

  it("un mapa nuevo a mitad de vuelo empieza quieto, con la foto como toca", () => {
    const m = montar();
    m.camara.empezar();
    m.foto.encender();
    flush();
    assert.isFalse(m.foto.seVe());
    const otro = lienzoDePrueba();
    m.setLienzo(otro.lienzo);
    flush();
    assert.isTrue(m.foto.seVe());
    assert.deepStrictEqual(otro.fotos, [true]);
    // El mapa viejo ya no avisa.
    assert.strictEqual(m.avisos(), 0);
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
 * en otra tarea y contesta a `queryRenderedFeatures` con lo que la prueba le da por capa. A
 * `querySourceFeatures` contesta con lo de las capas del estilo que leen esa capa de la tesela,
 * aunque no se pinte. Apunta cualquier llamada que cambie el estilo entero o sus capas.
 */
const mapaDePrueba = (pintado: Partial<Record<string, ReadonlyArray<RasgoDelMapa>>>) => {
  const estilo: StyleSpecification = estiloMapa(
    (token) => `token:${token}`,
    CONTORNO_DE_ESPANA,
    CONTORNO_DE_LA_COMUNITAT_VALENCIANA,
  );
  const capasAntes = JSON.stringify(estilo.layers);
  const fuentesAntes = Object.keys(estilo.sources);
  const estado: EstadoConFoto = {};
  const visibles = new Map<string, string>();
  const opacidades = new Map<string, number>();
  const escuchadores = new Map<string, Set<(movimiento: Movimiento) => void>>();
  const datos = new Map<string, DibujoDelEdificio>();
  const prohibidas: Array<string> = [];
  const vuelos: Array<{ center: [number, number]; zoom: number; offset: [number, number] }> = [];
  const centro = { x: 195, y: 422 };
  const emitir = (evento: string, movimiento: Movimiento = {}) => {
    for (const escuchador of escuchadores.get(evento) ?? []) escuchador(movimiento);
  };
  const prohibida = (nombre: string) => () => {
    prohibidas.push(nombre);
  };
  const mapa: MapaParaFoto & MapaQueNoSeToca = {
    getGlobalState: () => estado,
    setGlobalStateProperty: (nombre, valor) => {
      if (nombre === FOTO_AEREA) estado[FOTO_AEREA] = valor;
    },
    setLayoutProperty: (capa, _propiedad, valor) => {
      visibles.set(capa, valor);
    },
    setPaintProperty: (capa, _propiedad, valor) => {
      opacidades.set(capa, valor);
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
    getLayer: (id) => {
      const capa = estilo.layers.find((una) => una.id === id);
      return capa !== undefined && "source" in capa
        ? { source: capa.source, sourceLayer: capa["source-layer"] }
        : undefined;
    },
    querySourceFeatures: (fuente, { sourceLayer }) =>
      estilo.layers.flatMap((capa) =>
        "source" in capa && capa.source === fuente && capa["source-layer"] === sourceLayer
          ? (pintado[capa.id] ?? [])
          : [],
      ),
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
    visibles,
    opacidades,
    datos,
    vuelos,
    prohibidas,
    escuchadores: () => [...escuchadores.values()].reduce((n, s) => n + s.size, 0),
    emitir,
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
  it("encendida, pide la foto transparente y la enseña de una vez cuando el mapa queda quieto", () => {
    const m = mapaDePrueba({});
    const lienzo = lienzoDeFoto(m.mapa, relojDePrueba().esperar);
    lienzo.ponerFoto(true);
    // Mientras llegan las teselas, el mapa se ve como sin foto.
    assert.notStrictEqual(m.estado[FOTO_AEREA], true);
    assert.strictEqual(m.visibles.get(CAPA_FOTO), "visible");
    assert.strictEqual(m.opacidades.get(CAPA_FOTO), 0);
    m.emitir("idle");
    assert.isTrue(m.estado[FOTO_AEREA]);
    assert.strictEqual(m.opacidades.get(CAPA_FOTO), 1);
    assert.strictEqual(m.escuchadores(), 0);
  });

  it("si las teselas tardan, la enseña a los cuatro segundos", () => {
    const m = mapaDePrueba({});
    const reloj = relojDePrueba();
    const lienzo = lienzoDeFoto(m.mapa, reloj.esperar);
    lienzo.ponerFoto(true);
    reloj.avanzar(PLAZO_DE_LA_FOTO_MS - 1);
    assert.notStrictEqual(m.estado[FOTO_AEREA], true);
    reloj.avanzar(1);
    assert.isTrue(m.estado[FOTO_AEREA]);
    assert.strictEqual(m.escuchadores(), 0);
    assert.strictEqual(reloj.pendientes(), 0);
  });

  it("apagada o en vuelo antes de enseñarla, deja de pedirla y de esperar", () => {
    const m = mapaDePrueba({});
    const reloj = relojDePrueba();
    const lienzo = lienzoDeFoto(m.mapa, reloj.esperar);
    const dejar = lienzo.ponerFoto(true);
    dejar?.();
    assert.strictEqual(m.visibles.get(CAPA_FOTO), "none");
    assert.notStrictEqual(m.estado[FOTO_AEREA], true);
    assert.strictEqual(m.escuchadores(), 0);
    assert.strictEqual(reloj.pendientes(), 0);
  });

  it("encender y apagar la foto diez veces solo cambia el estado del estilo", () => {
    const m = mapaDePrueba({});
    const lienzo = lienzoDeFoto(m.mapa, relojDePrueba().esperar);
    let dejar: (() => void) | undefined;
    for (let vez = 0; vez < 10; vez++) {
      dejar?.();
      dejar = lienzo.ponerFoto(vez % 2 === 0);
      if (vez % 2 === 0) m.emitir("idle");
    }
    assert.isFalse(m.estado[FOTO_AEREA]);
    assert.strictEqual(m.visibles.get(CAPA_FOTO), "none");
    assert.strictEqual(m.escuchadores(), 0);
    assert.deepStrictEqual(m.prohibidas, []);
    assert.isTrue(m.sinCambiosEnElEstilo());
    // Las celdas y el edificio siguen con su fuente: nada se ha quitado ni añadido.
    assert.isDefined(m.mapa.getSource(FUENTE_CELDAS));
    assert.isDefined(m.mapa.getSource(FUENTE_EDIFICIO));
  });

  it("vuela al zoom del edificio y, quieto el mapa, resalta su contorno con su número", async () => {
    // Como en OpenFreeMap: los edificios de la misma altura llegan juntos en un rasgo, y los
    // portales con el mismo número también.
    const m = mapaDePrueba({
      [CAPA_EDIFICIOS]: [
        {
          id: 9,
          properties: { render_height: 22 },
          geometry: { type: "MultiPolygon", coordinates: [cuadrado(10, 40), cuadrado(15)] },
        },
      ],
      [CAPA_PORTALES]: [
        {
          properties: { housenumber: "251;259" },
          geometry: { type: "MultiPoint", coordinates: [metrosAl(40, 5), metrosAl(-10, 8)] },
        },
        {
          properties: { housenumber: "70" },
          geometry: { type: "Point", coordinates: metrosAl(40, 0) },
        },
      ],
    });
    const lienzo = lienzoDeFoto(m.mapa, relojDePrueba().esperar);
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
      dibujo?.features.map((rasgo) => rasgo.geometry.coordinates),
      [cuadrado(15), metrosAl(-10, 8)],
    );
    // Un solo `idle` basta: después no queda nada escuchando.
    assert.strictEqual(m.escuchadores(), 0);
    await m.emitirEnOtraTarea("idle");
    assert.lengthOf(encontrados, 1);

    lienzo.quitarEdificio();
    assert.deepStrictEqual(m.datos.get(FUENTE_EDIFICIO)?.features, []);
    assert.deepStrictEqual(m.prohibidas, []);
  });

  it("sin edificio en el punto no dibuja nada y lo dice; dejar de esperar quita los escuchadores", async () => {
    // El edificio de al lado, a 2 m, no cuenta.
    const m = mapaDePrueba({
      [CAPA_EDIFICIOS]: [
        { properties: {}, geometry: { type: "Polygon", coordinates: cuadrado(10, 12) } },
      ],
    });
    const lienzo = lienzoDeFoto(m.mapa, relojDePrueba().esperar);
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

  it("un movimiento de la web es un vuelo hasta que se para; uno de la persona, no", () => {
    const m = mapaDePrueba({});
    const lienzo = lienzoDeFoto(m.mapa, relojDePrueba().esperar);
    const avisos: Array<boolean> = [];
    const dejar = lienzo.seguirVuelos((volando) => avisos.push(volando));
    m.emitir("movestart");
    m.emitir("moveend");
    m.emitir("movestart", { originalEvent: new Event("touchstart") });
    m.emitir("moveend", { originalEvent: new Event("touchend") });
    assert.deepStrictEqual(avisos, [true, false, false, false]);
    dejar();
    assert.strictEqual(m.escuchadores(), 0);
    m.emitir("movestart");
    assert.lengthOf(avisos, 4);
  });
});
