import { BARCELONA } from "@celda/dominio/area";
import { Atribucion } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { BotonHexagonal } from "@celda/ui/BotonHexagonal.tsx";
import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { DatosDelMapa } from "@celda/ui/DatosDelMapa.tsx";
import { DisposicionMapa } from "@celda/ui/DisposicionMapa.tsx";
import { Pista } from "@celda/ui/Pista.tsx";
import * as Effect from "effect/Effect";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal, Match, onSettled, Show, Switch } from "solid-js";

import { type EstadoCapa, estadoDeCarga, textoDatosDelMapa } from "../capa/estado.ts";
import {
  combinacionesDe,
  distanciaDeZoom,
  marcadoresVisibles,
  type Vista,
} from "../capa/marcadores.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";
import { usarDatos } from "../datos.tsx";
import { desplazamientoParaVer } from "../ficha/enfoque.ts";
import { PanelFicha } from "../ficha/PanelFicha.tsx";
import { emplazamientoDe, navegar, ruta, ubicacion } from "../lib/rutas.ts";
import { CREDITOS_MAPA_BASE, type EstadoMapa, hayWebgl, type MotivoFallo } from "./estado.ts";
import { Marcadores } from "./Marcadores.tsx";

type ModuloMapaBase = typeof import("./mapaBase.ts");

/** La vista que enseña ahora el mapa. */
const vistaDe = (mapa: MapaMapLibre): Vista => {
  const caja = mapa.getBounds();
  return {
    caja: {
      suroeste: { longitud: caja.getWest(), latitud: caja.getSouth() },
      noreste: { longitud: caja.getEast(), latitud: caja.getNorth() },
    },
    zoom: mapa.getZoom(),
  };
};

/**
 * El mapa de Barcelona a pantalla completa con los emplazamientos de la capa vigente, la fecha
 * de sus datos y un aviso claro si algo no carga.
 */
export function PantallaMapa() {
  const datos = usarDatos();
  const [estado, setEstado] = createSignal<EstadoMapa>({ tipo: "cargando" });
  const [capa, setCapa] = createSignal<EstadoCapa>({ tipo: "cargando" });
  /** El mapa, cuando ya enseña el callejero, y el módulo que lo ha creado. */
  const [mapaListo, setMapaListo] = createSignal<{
    readonly mapa: MapaMapLibre;
    readonly modulo: ModuloMapaBase;
  }>();
  const [fotograma, setFotograma] = createSignal(0);
  const [vista, setVista] = createSignal<Vista>();
  const listo = createMemo(() => estado().tipo === "listo");
  let contenedor: HTMLDivElement | undefined;
  let mapa: MapaMapLibre | undefined;
  // Cada arranque tiene su número; un arranque viejo o una pantalla ya cerrada
  // no crean mapa cuando MapLibre termina de descargarse.
  let intento = 0;
  // Lo mismo para cada carga de la capa: una respuesta vieja no pisa a la nueva.
  let intentoCapa = 0;

  const fallar = (motivo: MotivoFallo) => setEstado({ tipo: "fallo", motivo });

  /**
   * Los marcadores se recolocan en cada fotograma del movimiento, pero cuáles hay solo se decide
   * al pararse o al cruzar el zoom de los logos: crear y quitar nodos es lo caro.
   */
  const seguirMapa = (nuevo: MapaMapLibre) => {
    let pendiente = 0;
    const mover = () => {
      pendiente = 0;
      setFotograma((n) => n + 1);
      const actual = vista();
      if (
        actual === undefined ||
        distanciaDeZoom(actual.zoom) !== distanciaDeZoom(nuevo.getZoom())
      ) {
        setVista(vistaDe(nuevo));
      }
    };
    // Como mucho una vez por fotograma: el mapa emite varios `move` entre dos.
    nuevo.on("move", () => {
      if (pendiente === 0) pendiente = requestAnimationFrame(mover);
    });
    nuevo.on("moveend", () => setVista(vistaDe(nuevo)));
    setVista(vistaDe(nuevo));
  };

  const crear = (modulo: ModuloMapaBase) => {
    if (contenedor === undefined) return;
    try {
      const nuevo = modulo.crearMapaBase(contenedor, BARCELONA, {
        listo: () => {
          setEstado({ tipo: "listo" });
          setMapaListo({ mapa: nuevo, modulo });
          seguirMapa(nuevo);
        },
        fallo: fallar,
      });
      mapa = nuevo;
    } catch (causa) {
      // MapLibre lanza un Error que nombra WebGL si no consigue el contexto.
      fallar(causa instanceof Error && /webgl/iu.test(causa.message) ? "sin-webgl" : "interno");
    }
  };

  const arrancar = () => {
    intento += 1;
    const este = intento;
    mapa?.remove();
    mapa = undefined;
    setMapaListo(undefined);
    setVista(undefined);
    if (!hayWebgl()) {
      fallar("sin-webgl");
      return;
    }
    setEstado({ tipo: "cargando" });
    // MapLibre pesa casi un mega: se descarga aparte para que la pantalla
    // salga antes. Si no llega, es que no hay conexión con Celda.
    void import("./mapaBase.ts").then(
      (modulo) => {
        if (este === intento) crear(modulo);
      },
      () => {
        if (este === intento) fallar("sin-respuesta");
      },
    );
  };

  /** Pide la capa vigente y la descarga, a la vez que el mapa base. */
  const cargarCapa = () => {
    intentoCapa += 1;
    const este = intentoCapa;
    setCapa({ tipo: "cargando" });
    void datos
      .runPromiseExit(Effect.flatMap(CapaEmplazamientos, (servicio) => servicio.cargar))
      .then((salida) => {
        if (este === intentoCapa) setCapa(estadoDeCarga(salida));
      });
  };

  onSettled(() => {
    arrancar();
    cargarCapa();
    return () => {
      intento += 1;
      intentoCapa += 1;
      mapa?.remove();
    };
  });

  const emplazamientos = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista" ? actual.capa.emplazamientos : [];
  });

  // Los puntos de zoom bajo los pinta el mapa: se le pasan cuando están el mapa y la capa.
  createEffect(
    () => ({ listo: mapaListo(), puntos: emplazamientos() }),
    ({ listo: actual, puntos }) => {
      actual?.modulo.ponerEmplazamientos(actual.mapa, puntos);
    },
  );

  /** Qué marcadores tocan con la capa y la vista actuales. */
  const marcadores = createMemo(() => {
    const ahora = vista();
    if (capa().tipo !== "lista" || ahora === undefined) return undefined;
    const decision = marcadoresVisibles(emplazamientos(), ahora);
    return decision.tipo === "lejos"
      ? decision
      : {
          tipo: decision.tipo,
          emplazamientos: decision.indices.flatMap((i) => emplazamientos()[i] ?? []),
        };
  });

  const visibles = createMemo(() => {
    const actual = marcadores();
    return actual?.tipo === "cerca" ? actual.emplazamientos : [];
  });

  const combinaciones = createMemo(() => combinacionesDe(emplazamientos()));

  /** El emplazamiento con la ficha abierta, que dice la URL. */
  const seleccionada = createMemo(() => emplazamientoDe(ubicacion()));
  const fechaCapa = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista" ? actual.capa.fecha : undefined;
  });

  /** Abre la ficha y, si el marcador queda debajo del panel, mueve el mapa lo justo. */
  const seleccionar = (clave: string) => {
    navegar(ruta.emplazamiento(clave));
    const posicion = emplazamientos().find((e) => e.clave === clave)?.posicion;
    if (mapa === undefined || posicion === undefined) return;
    const desplazamiento = desplazamientoParaVer(
      mapa.project([posicion.longitud, posicion.latitud]),
      {
        ancho: window.innerWidth,
        alto: window.innerHeight,
        escritorio: window.matchMedia("(min-width: 48rem)").matches,
      },
    );
    if (desplazamiento !== undefined) mapa.panBy([...desplazamiento], { duration: 300 });
  };

  // Si la página se abre con un emplazamiento en la URL, el mapa empieza en él. Solo al cargar:
  // después, abrir o cerrar la ficha no mueve el mapa (historia 22).
  let enfocadoAlCargar = false;
  createEffect(
    () => ({ listo: mapaListo(), lista: capa().tipo === "lista", clave: seleccionada() }),
    ({ listo: actual, lista, clave }) => {
      if (enfocadoAlCargar || actual === undefined || !lista) return;
      enfocadoAlCargar = true;
      const posicion = emplazamientos().find((e) => e.clave === clave)?.posicion;
      if (posicion === undefined) return;
      actual.mapa.jumpTo({
        center: [posicion.longitud, posicion.latitud],
        zoom: Math.max(actual.mapa.getZoom(), 16),
      });
    },
  );

  const aviso = createMemo(() => {
    const actual = estado();
    return actual.tipo === "listo" ? undefined : (
      <AvisoMapa estado={actual} reintentar={arrancar} />
    );
  });

  return (
    <DisposicionMapa
      nombre={`Mapa de ${BARCELONA.nombre}`}
      ocupado={estado().tipo === "cargando" || capa().tipo === "cargando"}
      lienzo={(elemento) => {
        contenedor = elemento;
      }}
      cabecera={<Cabecera lugar={BARCELONA.nombre} />}
      datos={<EstadoDeLaCapa estado={capa()} reintentar={cargarCapa} />}
      marcadores={
        <Show when={mapaListo()}>
          {(actual) => (
            <Marcadores
              mapa={actual().mapa}
              fotograma={fotograma()}
              emplazamientos={visibles()}
              combinaciones={combinaciones()}
              seleccionada={seleccionada()}
              alSeleccionar={seleccionar}
            />
          )}
        </Show>
      }
      pista={
        marcadores()?.tipo === "lejos" ? (
          <Pista texto="Acércate para ver las compañías de cada emplazamiento" />
        ) : undefined
      }
      controles={
        <>
          <BotonHexagonal
            etiqueta="Acercar"
            icono="+"
            disabled={!listo()}
            onClick={() => mapa?.zoomIn()}
          />
          <BotonHexagonal
            etiqueta="Alejar"
            icono="−"
            disabled={!listo()}
            onClick={() => mapa?.zoomOut()}
          />
        </>
      }
      atribucion={<Atribucion creditos={CREDITOS_MAPA_BASE} />}
      aviso={aviso()}
      panelAbierto={seleccionada() !== null}
      panel={
        <Show when={seleccionada()}>
          {(clave) => (
            <PanelFicha
              clave={clave()}
              fechaCapa={fechaCapa()}
              alCerrar={() => navegar(ruta.mapa)}
            />
          )}
        </Show>
      }
    />
  );
}

/**
 * La fecha de los datos del mapa o, mientras llega la capa, que está cargando. Si no llega, lo
 * dice con un reintento: un mapa sin marcadores no quiere decir que no haya emplazamientos.
 */
export function EstadoDeLaCapa(props: {
  readonly estado: EstadoCapa;
  readonly reintentar: () => void;
}) {
  const reintentar = (
    <Boton variante="secundario" onClick={() => props.reintentar()}>
      Reintentar
    </Boton>
  );
  return (
    <Switch>
      <Match when={props.estado.tipo === "cargando"}>
        <DatosDelMapa tono="espera" texto="Cargando los emplazamientos…" />
      </Match>
      <Match when={props.estado.tipo === "lista" ? props.estado.capa : undefined}>
        {(lista) => (
          <DatosDelMapa
            texto={textoDatosDelMapa(lista().fecha)}
            detalle={`${lista().emplazamientos.length} emplazamientos · capa ${lista().version}`}
          />
        )}
      </Match>
      <Match when={props.estado.tipo === "fallo" ? props.estado.motivo : undefined}>
        {(motivo) => (
          <Aviso
            tono="fallo"
            titulo="No se han podido cargar los emplazamientos"
            acciones={reintentar}
          >
            {EXPLICACION_FALLO_CAPA[motivo()]} El mapa se ve, pero sin marcadores: eso no quiere
            decir que no haya emplazamientos.
          </Aviso>
        )}
      </Match>
    </Switch>
  );
}

const EXPLICACION_FALLO_CAPA = {
  "sin-publicar": "Todavía no hay ninguna capa de emplazamientos publicada.",
  "sin-backend":
    "El servidor de Celda no ha dicho qué datos cargar. Puede fallar la conexión o estar bloqueado el servidor.",
  "sin-descarga":
    "El fichero con los emplazamientos no ha llegado. Puede fallar la conexión o estar bloqueado el servidor.",
  danada: "El fichero con los emplazamientos no es el que se esperaba. Es un error de Celda.",
  interno: "Es un error de Celda, no de tu conexión.",
} as const;

function AvisoMapa(props: { readonly estado: EstadoMapa; readonly reintentar: () => void }) {
  const reintentar = <Boton onClick={() => props.reintentar()}>Reintentar</Boton>;
  return (
    <Switch>
      <Match when={props.estado.tipo === "cargando"}>
        <Aviso tono="espera" titulo="Cargando el mapa base">
          El callejero llega desde OpenFreeMap.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo" && props.estado.motivo === "sin-webgl"}>
        <Aviso tono="fallo" titulo="Este navegador no puede dibujar el mapa">
          El mapa se dibuja con WebGL y este navegador lo tiene apagado o no lo admite. Prueba con
          otro navegador o activa la aceleración gráfica en su configuración.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo" && props.estado.motivo === "sin-respuesta"}>
        <Aviso tono="fallo" titulo="No se ha podido cargar el mapa base" acciones={reintentar}>
          El callejero viene de los servidores de OpenFreeMap y no ha llegado. Puede fallar la
          conexión o estar bloqueado el servidor.
        </Aviso>
      </Match>
      <Match when={props.estado.tipo === "fallo"}>
        <Aviso tono="fallo" titulo="Algo ha fallado al preparar el mapa" acciones={reintentar}>
          Es un error de Celda, no de tu conexión. Si se repite al reintentar, recarga la página.
        </Aviso>
      </Match>
    </Switch>
  );
}
