import type { Coordenada } from "@celda/dominio/area";
import { desdePlano } from "@celda/dominio/plano";
import type { EstadoEdificio } from "@celda/ui/foto/FotoAerea.tsx";
import {
  dejarDePrepararFoto,
  FUENTE_EDIFICIO,
  type MapaConFoto,
  ponerFotoAerea,
  prepararFotoAerea,
} from "@celda/ui/mapa/foto.ts";
import { CAPA_PORTALES } from "@celda/ui/mapa/rotulos.ts";
import { CAPA_EDIFICIOS } from "@celda/ui/mapa/suelo.ts";
import { mismosCampos, recurso } from "@celda/ui/recurso.ts";
import * as Predicate from "effect/Predicate";
import { createContext, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Esperar } from "../mapa/callejero.ts";
import type { Movimiento } from "../mapa/vistaInicial.ts";
import {
  dibujoDelEdificio,
  type DibujoDelEdificio,
  type EdificioEncontrado,
  edificiosDeRasgo,
  elegirEdificio,
  portalesDeRasgo,
  type RasgoDelMapa,
  SIN_EDIFICIO,
} from "./edificio.ts";
import { ZOOM_EDIFICIO } from "./foto.ts";

/**
 * La caja en que se buscan los edificios. Basta el punto del emplazamiento: solo cuenta el que lo
 * contiene, y el mapa da cada rasgo entero.
 */
const ALCANCE_EDIFICIOS_M = 1;

/**
 * Lo más que se espera a las teselas de la foto antes de enseñarla. Con una red lenta sale a
 * medio cargar, como cualquier mapa.
 */
export const PLAZO_DE_LA_FOTO_MS = 4000;

/** Lo que hace el mapa con la foto aérea. En las pruebas, un lienzo que apunta lo que recibe. */
export interface LienzoDeFoto {
  /**
   * Enciende o apaga la foto. Encenderla la pide sin enseñarla y la enseña de una vez cuando el
   * mapa se queda quieto con sus teselas, o a los `PLAZO_DE_LA_FOTO_MS`. Devuelve con qué dejar de
   * esperar, que quita la foto pedida si aún no se ha enseñado.
   */
  readonly ponerFoto: (encendida: boolean) => (() => void) | undefined;
  /**
   * Vuela al emplazamiento, a `desplazamiento` píxeles del centro, y cuando el mapa se queda
   * quieto con sus teselas, resalta su edificio y llama a `alAcabar` con lo encontrado, o sin nada
   * si el emplazamiento ya no está a la vista (lo ha movido la persona). Devuelve con qué dejar de
   * esperar.
   */
  readonly verEdificio: (
    posicion: Coordenada,
    desplazamiento: readonly [number, number],
    alAcabar: (encontrado: EdificioEncontrado | undefined) => void,
  ) => () => void;
  /** Quita el edificio resaltado. */
  readonly quitarEdificio: () => void;
  /**
   * Avisa de los vuelos de la cámara: `true` cuando la web la mueve con una animación (`flyTo`,
   * `easeTo`, `fitBounds`) y `false` cuando se para, porque llega, porque empieza otro vuelo o
   * porque la persona coge el mapa. Un gesto de una persona lleva el evento del navegador que lo
   * empezó y no es un vuelo; un salto empieza y acaba en la misma tarea. Devuelve con qué dejar de
   * avisar.
   */
  readonly seguirVuelos: (alCambiar: (volando: boolean) => void) => () => void;
}

type Pixel = [number, number];

/** Lo que hace falta del mapa de MapLibre para la foto aérea y «Ver el edificio». */
export interface MapaParaFoto extends MapaConFoto {
  readonly flyTo: (opciones: {
    readonly center: [number, number];
    readonly zoom: number;
    readonly offset: [number, number];
  }) => void;
  readonly on: (
    evento: "movestart" | "moveend" | "idle",
    escuchador: (movimiento: Movimiento) => void,
  ) => void;
  readonly off: (
    evento: "movestart" | "moveend" | "idle",
    escuchador: (movimiento: Movimiento) => void,
  ) => void;
  readonly project: (punto: [number, number]) => { readonly x: number; readonly y: number };
  readonly getBounds: () => { readonly contains: (punto: [number, number]) => boolean };
  readonly queryRenderedFeatures: (
    caja: [Pixel, Pixel],
    opciones: { readonly layers: Array<string> },
  ) => ReadonlyArray<RasgoDelMapa>;
  readonly getSource: (fuente: string) => FuenteDelMapa | undefined;
  readonly getLayer: (
    capa: string,
  ) => { readonly source: string; readonly sourceLayer?: string | undefined } | undefined;
  readonly querySourceFeatures: (
    fuente: string,
    opciones: { readonly sourceLayer?: string },
  ) => ReadonlyArray<RasgoDelMapa>;
}

/** Una fuente del estilo, como la da MapLibre. */
interface FuenteDelMapa {
  readonly type: string;
}

/** Una fuente GeoJSON del mapa, que se rellena con `setData`. */
interface FuenteRellenable extends FuenteDelMapa {
  readonly setData: (datos: DibujoDelEdificio) => void;
}

const esRellenable = (fuente: FuenteDelMapa | undefined): fuente is FuenteRellenable =>
  Predicate.hasProperty(fuente, "setData") && Predicate.isFunction(fuente.setData);

const comoPunto = (posicion: Coordenada): [number, number] => [posicion.longitud, posicion.latitud];

/**
 * El lienzo de un mapa de MapLibre. La foto se enciende con el estado del estilo; el edificio se
 * busca en lo que el mapa ha pintado (`queryRenderedFeatures`) y no en las teselas: las partidas
 * por encima del zoom 15 dan las coordenadas desplazadas. Se busca en un radio de píxeles que a
 * ese zoom cubre la distancia que hace falta.
 *
 * Los números de portal se buscan en las teselas de su capa (`querySourceFeatures`) y no en lo
 * pintado: MapLibre no pinta el número que queda bajo un marcador, y suele ser el del edificio.
 * Con MapLibre 6.11 y las teselas partidas a z15, dan las mismas coordenadas que la tesela z14.
 *
 * Un edificio partido entre teselas llega en un trozo por tesela, cortado un poco más allá de su
 * borde, a unos 29 m en España. No se cosen: se resalta el trozo más grande que contiene el
 * emplazamiento (ADR 0022).
 */
export const lienzoDeFoto = (mapa: MapaParaFoto, esperar: Esperar): LienzoDeFoto => {
  const pintar = (dibujo: DibujoDelEdificio) => {
    const fuente = mapa.getSource(FUENTE_EDIFICIO);
    if (esRellenable(fuente)) fuente.setData(dibujo);
  };
  /** La caja de píxeles alrededor de `posicion` que cubre `metros` hacia cada lado. */
  const cajaDe = (posicion: Coordenada, metros: number): [Pixel, Pixel] => {
    const centro = mapa.project(comoPunto(posicion));
    const borde = mapa.project(comoPunto(desdePlano(posicion, { este: metros, norte: 0 })));
    const radio = Math.max(20, Math.abs(borde.x - centro.x));
    return [
      [centro.x - radio, centro.y - radio],
      [centro.x + radio, centro.y + radio],
    ];
  };
  const buscar = (posicion: Coordenada): EdificioEncontrado | undefined => {
    if (!mapa.getBounds().contains(comoPunto(posicion))) return undefined;
    const edificios = mapa
      .queryRenderedFeatures(cajaDe(posicion, ALCANCE_EDIFICIOS_M), { layers: [CAPA_EDIFICIOS] })
      .flatMap(edificiosDeRasgo);
    const capa = mapa.getLayer(CAPA_PORTALES);
    const portales =
      capa === undefined
        ? []
        : mapa
            .querySourceFeatures(
              capa.source,
              capa.sourceLayer === undefined ? {} : { sourceLayer: capa.sourceLayer },
            )
            .flatMap(portalesDeRasgo);
    return elegirEdificio(posicion, edificios, portales);
  };
  return {
    ponerFoto: (encendida) => {
      if (!encendida) {
        ponerFotoAerea(mapa, false);
        return undefined;
      }
      prepararFotoAerea(mapa);
      let puesta = false;
      const ponerla = () => {
        dejarDeEsperar();
        puesta = true;
        ponerFotoAerea(mapa, true);
      };
      // `idle` llega cuando el mapa ha pintado con todas sus teselas, también las de la foto.
      mapa.on("idle", ponerla);
      const dejarElPlazo = esperar(PLAZO_DE_LA_FOTO_MS, ponerla);
      const dejarDeEsperar = () => {
        mapa.off("idle", ponerla);
        dejarElPlazo();
      };
      return () => {
        dejarDeEsperar();
        if (!puesta) dejarDePrepararFoto(mapa);
      };
    },
    verEdificio: (posicion, desplazamiento, alAcabar) => {
      const alQuedarQuieto = () => {
        mapa.off("idle", alQuedarQuieto);
        const encontrado = buscar(posicion);
        pintar(encontrado === undefined ? SIN_EDIFICIO : dibujoDelEdificio(encontrado));
        alAcabar(encontrado);
      };
      // Al parar el vuelo aún faltan teselas y rótulos por colocar: se espera a `idle`.
      const alParar = () => {
        mapa.off("moveend", alParar);
        mapa.on("idle", alQuedarQuieto);
      };
      mapa.on("moveend", alParar);
      // Con la preferencia de reducir movimiento, MapLibre salta en lugar de volar.
      mapa.flyTo({
        center: comoPunto(posicion),
        zoom: ZOOM_EDIFICIO,
        offset: [desplazamiento[0], desplazamiento[1]],
      });
      return () => {
        mapa.off("moveend", alParar);
        mapa.off("idle", alQuedarQuieto);
      };
    },
    quitarEdificio: () => pintar(SIN_EDIFICIO),
    seguirVuelos: (alCambiar) => {
      const alEmpezar = (movimiento: Movimiento) => {
        alCambiar(movimiento.originalEvent === undefined);
      };
      const alParar = () => {
        alCambiar(false);
      };
      mapa.on("movestart", alEmpezar);
      mapa.on("moveend", alParar);
      return () => {
        mapa.off("movestart", alEmpezar);
        mapa.off("moveend", alParar);
      };
    },
  };
};

/** Lo que ha pedido «Ver el edificio»: un objeto nuevo por pulsación. */
interface PedidoDeEdificio {
  readonly clave: string;
  readonly posicion: Coordenada;
}

/** Lo que ha encontrado el vuelo de un pedido, o nada si el emplazamiento ya no estaba a la vista. */
interface Hallado {
  readonly pedido: PedidoDeEdificio;
  readonly encontrado: EdificioEncontrado | undefined;
}

/** De dónde sale la foto aérea. Las lecturas son reactivas. */
export interface EntradaFoto {
  /** El mapa, cuando está listo. */
  readonly lienzo: () => LienzoDeFoto | undefined;
  /** El emplazamiento con la ficha abierta. */
  readonly seleccionada: () => string | null;
  /** Si el mapa está al zoom de la foto (`ZOOM_FOTO`) o más cerca. */
  readonly deCerca: () => boolean;
  /** Dónde queda el centro de lo que deja libre el panel (`centroLibre`). */
  readonly desplazamiento: () => readonly [number, number];
  /** Con qué se cuenta el rato que se ve la pista de un edificio sin dibujar. */
  readonly esperar: Esperar;
}

export interface FotoDelMapa {
  /** Si la foto aérea está encendida. Apagada al abrir cada visita. */
  readonly encendida: () => boolean;
  /** Si el mapa la enseña: encendida, al zoom de la foto o más cerca y con la cámara sin volar. */
  readonly seVe: () => boolean;
  readonly alternar: () => void;
  readonly encender: () => void;
  /** Qué ha hecho «Ver el edificio» con el emplazamiento `clave`. */
  readonly edificio: (clave: string) => EstadoEdificio;
  /** «Ver el edificio»: enciende la foto, vuela al emplazamiento y resalta su edificio. */
  readonly verEdificio: (clave: string, posicion: Coordenada) => void;
  /**
   * Si la pista dice que no hay ningún edificio dibujado en el emplazamiento: durante
   * `PISTA_SIN_CONTORNO_MS` después de un «Ver el edificio» que no lo encuentra.
   */
  readonly sinContorno: () => boolean;
}

/**
 * Lo que dice la pista cuando «Ver el edificio» no encuentra ningún edificio. No dice por qué,
 * porque no se sabe. Lo más probable es que el emplazamiento esté en una torre, aunque también
 * puede faltar el edificio en OpenStreetMap.
 */
export const PISTA_SIN_CONTORNO = "El mapa no tiene ningún edificio dibujado en el emplazamiento.";

/** Lo que se ve esa pista. */
export const PISTA_SIN_CONTORNO_MS = 4000;

export const FotoContexto = createContext<FotoDelMapa>();

const PARADO: EstadoEdificio = { tipo: "parado" };
const BUSCANDO: EstadoEdificio = { tipo: "buscando" };

/**
 * La foto aérea en el mapa y «Ver el edificio». Encender la foto y volar al edificio abren cosas
 * en el mapa (teselas del PNOA, un vuelo y sus escuchadores), así que se abren con `recurso()`:
 * cada uno con una clave que solo cambia cuando la persona pulsa, cambia de emplazamiento, la
 * cámara empieza o acaba un vuelo o el mapa se crea otra vez. Cambiar de emplazamiento o cerrar la
 * ficha quita el resaltado. Si no hay edificio que resaltar, la pista lo dice durante
 * `PISTA_SIN_CONTORNO_MS`, con su espera abierta también con `recurso()`.
 *
 * Mientras la cámara vuela, el mapa se ve sin la foto, como con ella apagada, y la foto vuelve al
 * llegar (#67): un vuelo de España a la calle pedía las teselas de cada zoom del camino, que solo
 * se ven de paso. Al llegar, la foto se pide sin enseñarla y sale de una vez cuando han llegado sus
 * teselas (`ponerFoto`). Con la foto se apaga todo lo que cambia con ella (`conFoto`): las vías blancas
 * sobre el fondo claro no se verían. Los gestos de la persona no son vuelos y no la apagan. Más
 * lejos de `ZOOM_FOTO` tampoco se ve, con el control encendido.
 */
export function crearFoto(entrada: EntradaFoto): FotoDelMapa {
  const [encendida, setEncendida] = createSignal(false);
  // El lienzo cuya cámara está volando. Un lienzo nuevo empieza quieto aunque el viejo volara.
  const [enVuelo, setEnVuelo] = createSignal<LienzoDeFoto>();
  const [pedido, setPedido] = createSignal<PedidoDeEdificio>();
  // El último pedido cuyo vuelo ya ha empezado.
  const [volado, setVolado] = createSignal<PedidoDeEdificio>();
  const [hallado, setHallado] = createSignal<Hallado>();

  recurso("mapa:vuelos", entrada.lienzo, (lienzo) =>
    lienzo.seguirVuelos((volando) => {
      setEnVuelo(volando ? lienzo : undefined);
    }),
  );

  // Un pedido de «Ver el edificio» cuyo vuelo aún no ha empezado cuenta ya como vuelo: así la foto
  // no se pone en el punto de partida para quitarse en la misma tarea.
  const seVe = createMemo(() => {
    const lienzo = entrada.lienzo();
    const porVolar = pedido() !== undefined && volado() !== pedido();
    return (
      encendida() && entrada.deCerca() && lienzo !== undefined && enVuelo() !== lienzo && !porVolar
    );
  });

  recurso(
    "mapa:foto",
    () => {
      const lienzo = entrada.lienzo();
      return lienzo === undefined ? undefined : { lienzo, encendida: seVe() };
    },
    ({ lienzo, encendida: si }) => {
      const dejar = lienzo.ponerFoto(si);
      return dejar === undefined ? undefined : () => dejar();
    },
    { iguales: mismosCampos },
  );

  // Otro emplazamiento o la ficha cerrada: lo pedido para el anterior ya no vale.
  createEffect(entrada.seleccionada, (clave) => {
    if (untrack(pedido)?.clave !== clave) setPedido(undefined);
  });

  recurso(
    "mapa:edificio",
    () => {
      const lienzo = entrada.lienzo();
      const actual = pedido();
      return lienzo === undefined || actual === undefined ? undefined : { lienzo, pedido: actual };
    },
    ({ lienzo, pedido: actual }) => {
      const dejar = lienzo.verEdificio(
        actual.posicion,
        untrack(entrada.desplazamiento),
        (encontrado) => setHallado({ pedido: actual, encontrado }),
      );
      setVolado(actual);
      return (siguiente) => {
        dejar();
        if (siguiente?.lienzo !== lienzo) lienzo.quitarEdificio();
      };
    },
    { iguales: mismosCampos },
  );

  // Sin edificio que contenga el emplazamiento, la pista lo dice un rato. Pulsar otra vez,
  // cambiar de emplazamiento o cerrar la ficha la quitan antes.
  const sinEdificio = createMemo(() => {
    const resultado = hallado();
    return resultado?.pedido === pedido() && resultado?.encontrado?.tipo === "ninguno"
      ? resultado
      : undefined;
  });
  const [pistaVista, setPistaVista] = createSignal<Hallado>();
  recurso("mapa:edificio-pista", sinEdificio, (resultado) =>
    entrada.esperar(PISTA_SIN_CONTORNO_MS, () => setPistaVista(resultado)),
  );
  const sinContorno = createMemo(() => {
    const resultado = sinEdificio();
    return resultado !== undefined && pistaVista() !== resultado;
  });

  const edificio = (clave: string): EstadoEdificio => {
    const actual = pedido();
    if (actual === undefined || actual.clave !== clave) return PARADO;
    const resultado = hallado();
    if (resultado?.pedido !== actual) return BUSCANDO;
    const { encontrado } = resultado;
    if (encontrado === undefined) return PARADO;
    return encontrado.tipo === "ninguno"
      ? { tipo: "sin-contorno" }
      : { tipo: "resaltado", numero: encontrado.portal?.numero };
  };

  return {
    encendida,
    seVe,
    alternar: () => setEncendida((si) => !si),
    encender: () => setEncendida(true),
    edificio,
    verEdificio: (clave, posicion) => {
      setEncendida(true);
      setPedido({ clave, posicion });
    },
    sinContorno,
  };
}
