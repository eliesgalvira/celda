import { BARCELONA } from "@celda/dominio/area";
import { Atribucion } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { BotonHexagonal } from "@celda/ui/BotonHexagonal.tsx";
import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { DatosDelMapa } from "@celda/ui/DatosDelMapa.tsx";
import { DisposicionMapa } from "@celda/ui/DisposicionMapa.tsx";
import { IconoOndas } from "@celda/ui/interferencia/PanelInterferencia.tsx";
import { ZOOM_CELDAS } from "@celda/ui/mapa/celdas.ts";
import { IconoSenal } from "@celda/ui/medir/Medir.tsx";
import { Pista } from "@celda/ui/Pista.tsx";
import { Termino, TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import { PinCentral } from "@celda/ui/ubicacion/MarcadorReferencia.tsx";
import * as Effect from "effect/Effect";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal, Match, onSettled, Show, Switch } from "solid-js";

import {
  creditoDeBarrios,
  type EstadoCapa,
  estadoDeCarga,
  textoDatosDelMapa,
} from "../capa/estado.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";
import { pistaDeCeldas } from "../celdas/celdas.ts";
import { crearCeldas, lienzoDelMapa } from "../celdas/enMapa.ts";
import { usarDatos } from "../datos.tsx";
import { desplazamientoParaVer } from "../ficha/enfoque.ts";
import { PanelFicha } from "../ficha/PanelFicha.tsx";
import {
  crearInterferencia,
  lienzoDelMapa as lienzoDeInterferencia,
} from "../interferencia/enMapa.ts";
import {
  bandaInicial,
  companiasDeLaCapa,
  type EleccionVista,
  type Encuadre,
  OCUPACION,
  ZOOM_INTERFERENCIA,
} from "../interferencia/interferencia.ts";
import { VistaInterferencia } from "../interferencia/VistaInterferencia.tsx";
import { conMedir, emplazamientoDe, medirAbierto, navegar, ruta, ubicacion } from "../lib/rutas.ts";
import { DialogoMedir } from "../medir/DialogoMedir.tsx";
import { leerModelo, leerNavegador } from "../medir/navegador.ts";
import { crearUbicacion, UbicacionContexto } from "../ubicacion/controlador.ts";
import { posicionDe } from "../ubicacion/estado.ts";
import { ReferenciaEnMapa } from "../ubicacion/ReferenciaEnMapa.tsx";
import {
  AvisosDeUbicacion,
  EleccionConBuscador,
  MenuDeUbicacion,
  PasoPrevio,
} from "../ubicacion/Ubicacion.tsx";
import { CREDITOS_MAPA_BASE, type EstadoMapa, hayWebgl, type MotivoFallo } from "./estado.ts";
import { Marcadores } from "./Marcadores.tsx";

type ModuloMapaBase = typeof import("./mapaBase.ts");

/** Solo para los tipos: el panel de la vista no se monta sin elección. */
const ELECCION_VACIA: EleccionVista = { compania: "movistar", mhz: 1800, ocupacion: 0.5 };

/** El ancho a partir del cual el panel va a la izquierda y el punto se elige con un clic. */
const ESCRITORIO = "(min-width: 48rem)";

/**
 * El mapa de Barcelona a pantalla completa con los emplazamientos de la capa vigente, la fecha
 * de sus datos y un aviso claro si algo no carga.
 */
export function PantallaMapa() {
  const datos = usarDatos();
  const puntoDeReferencia = crearUbicacion(datos);
  const eligiendo = createMemo(() => puntoDeReferencia.ubicacion().estado.tipo === "eligiendo");
  const [escritorio, setEscritorio] = createSignal(window.matchMedia(ESCRITORIO).matches);
  const [estado, setEstado] = createSignal<EstadoMapa>({ tipo: "cargando" });
  const [capa, setCapa] = createSignal<EstadoCapa>({ tipo: "cargando" });
  /** El mapa, cuando ya enseña el callejero. */
  const [mapaListo, setMapaListo] = createSignal<MapaMapLibre>();
  const listo = createMemo(() => estado().tipo === "listo");
  /** Si el mapa está al zoom de las celdas o más cerca. */
  const [cerca, setCerca] = createSignal(false);
  /** Lo que se ve del mapa, puesto cada vez que se para. */
  const [encuadre, setEncuadre] = createSignal<Encuadre>();
  /** La vista de interferencia (historia 38) y lo que se ha elegido en ella. */
  const [vistaActiva, setVistaActiva] = createSignal(false);
  const [eleccion, setEleccion] = createSignal<EleccionVista>();
  let contenedor: HTMLDivElement | undefined;
  let mapa: MapaMapLibre | undefined;
  // Cada arranque tiene su número; un arranque viejo o una pantalla ya cerrada
  // no crean mapa cuando MapLibre termina de descargarse.
  let intento = 0;
  // Lo mismo para cada carga de la capa: una respuesta vieja no pisa a la nueva.
  let intentoCapa = 0;

  const fallar = (motivo: MotivoFallo) => setEstado({ tipo: "fallo", motivo });

  const crear = (modulo: ModuloMapaBase) => {
    if (contenedor === undefined) return;
    try {
      const nuevo = modulo.crearMapaBase(contenedor, BARCELONA, {
        listo: () => {
          setEstado({ tipo: "listo" });
          setMapaListo(nuevo);
        },
        fallo: fallar,
      });
      const mirarZoom = () => setCerca(nuevo.getZoom() >= ZOOM_CELDAS);
      nuevo.on("zoom", mirarZoom);
      mirarZoom();
      const mirarEncuadre = () => {
        const limites = nuevo.getBounds();
        setEncuadre({
          suroeste: { longitud: limites.getWest(), latitud: limites.getSouth() },
          noreste: { longitud: limites.getEast(), latitud: limites.getNorth() },
          zoom: nuevo.getZoom(),
        });
      };
      nuevo.on("moveend", mirarEncuadre);
      nuevo.once("load", mirarEncuadre);
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
    const pantalla = window.matchMedia(ESCRITORIO);
    const medir = () => setEscritorio(pantalla.matches);
    pantalla.addEventListener("change", medir);
    return () => {
      intento += 1;
      intentoCapa += 1;
      pantalla.removeEventListener("change", medir);
      mapa?.remove();
    };
  });

  // En escritorio, mientras se elige un punto, un clic en el mapa lo marca (historia 26).
  createEffect(
    () => mapaListo(),
    (actual) => {
      if (actual === undefined) return;
      const alClic = (evento: {
        readonly lngLat: { readonly lng: number; readonly lat: number };
      }) => {
        if (!eligiendo() || !escritorio()) return;
        puntoDeReferencia.elegir(
          { longitud: evento.lngLat.lng, latitud: evento.lngLat.lat },
          "mapa",
        );
      };
      actual.on("click", alClic);
      return () => {
        actual.off("click", alClic);
      };
    },
  );

  /** Lleva el mapa hasta una posición, sin alejarlo si ya está cerca. */
  const irA = (posicion: { readonly longitud: number; readonly latitud: number }) => {
    mapa?.easeTo({
      center: [posicion.longitud, posicion.latitud],
      zoom: Math.max(mapa.getZoom(), 16),
      duration: 600,
    });
  };

  /** En el móvil, el punto es el que queda bajo el pin, en el centro del mapa. */
  const usarCentro = () => {
    if (mapa === undefined) return;
    const centro = mapa.getCenter();
    puntoDeReferencia.elegir({ longitud: centro.lng, latitud: centro.lat }, "mapa");
  };

  // Con la primera lectura del GPS, el mapa va hasta ella.
  createEffect(
    () => puntoDeReferencia.ubicacion().estado,
    (actual, anterior) => {
      if (actual.tipo === "gps" && anterior?.tipo === "pidiendo") irA(actual.lectura.posicion);
    },
  );

  const emplazamientos = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista" ? actual.capa.emplazamientos : [];
  });
  const barrios = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista" ? actual.capa.barrios : [];
  });
  /** Los créditos del mapa base y, con la capa, los de los límites de barrio que usa. */
  const creditos = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista"
      ? [...CREDITOS_MAPA_BASE, creditoDeBarrios(actual.capa.fuenteDeBarrios)]
      : CREDITOS_MAPA_BASE;
  });

  /** El emplazamiento con la ficha abierta, que dice la URL. */
  const seleccionada = createMemo(() => emplazamientoDe(ubicacion()));
  const fechaCapa = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista" ? actual.capa.fecha : undefined;
  });

  const celdas = crearCeldas(datos, {
    lienzo: createMemo(() => {
      const actual = mapaListo();
      return actual === undefined ? undefined : lienzoDelMapa(actual);
    }),
    emplazamientos,
    cerca,
    seleccionada,
  });
  const interferencia = crearInterferencia(datos, {
    lienzo: createMemo(() => {
      const actual = mapaListo();
      return actual === undefined ? undefined : lienzoDeInterferencia(actual);
    }),
    activa: vistaActiva,
    emplazamientos,
    eleccion,
    encuadre,
    referencia: createMemo(() => {
      const referencia = puntoDeReferencia.referencia();
      return referencia === undefined ? undefined : posicionDe(referencia);
    }),
  });

  /**
   * Abre o cierra la vista. Al abrirla por primera vez elige la compañía del emplazamiento
   * seleccionado, o la primera de la capa, y la banda con más estaciones confirmadas.
   */
  const cambiarVista = () => {
    if (vistaActiva()) {
      setVistaActiva(false);
      return;
    }
    if (eleccion() === undefined) {
      const todos = emplazamientos();
      const clave = seleccionada();
      const compania =
        todos.find((e) => e.clave === clave)?.companias[0] ?? companiasDeLaCapa(todos)[0];
      if (compania !== undefined) {
        setEleccion({
          compania,
          mhz: bandaInicial(todos, compania),
          ocupacion: OCUPACION.inicial,
        });
      }
    }
    setVistaActiva(true);
  };

  /**
   * El panel de la vista. Es un memo que solo cambia al abrirla o cerrarla: la elección llega al
   * panel como prop, y moverla no vuelve a montarlo (el deslizador no pierde el dedo).
   */
  const conVista = createMemo(() => vistaActiva() && eleccion() !== undefined);
  const vista = createMemo(() =>
    conVista() ? (
      <VistaInterferencia
        emplazamientos={emplazamientos()}
        eleccion={eleccion() ?? ELECCION_VACIA}
        alCambiar={(nueva) => {
          const anterior = eleccion();
          // Otra compañía abre en su banda con más estaciones confirmadas.
          setEleccion(
            anterior !== undefined && nueva.compania !== anterior.compania
              ? { ...nueva, mhz: bandaInicial(emplazamientos(), nueva.compania) }
              : nueva,
          );
        }}
        calculo={interferencia.calculo()}
        reintentar={() => interferencia.reintentar()}
        referencia={puntoDeReferencia.referencia()?.tipo}
        cerca={(encuadre()?.zoom ?? 0) >= ZOOM_INTERFERENCIA}
        alCerrar={() => setVistaActiva(false)}
      />
    ) : undefined,
  );

  const pista = createMemo(() => {
    // Con la vista de interferencia, su panel dice qué es cada cosa y las celdas no se ven.
    if (vistaActiva()) return undefined;
    const actual = pistaDeCeldas(cerca(), celdas.calculo());
    return actual === undefined ? undefined : (
      <Pista
        texto={actual.texto}
        modelo={actual.modelo}
        accion={
          actual.reintentar ? (
            <Boton variante="secundario" onClick={() => celdas.reintentar()}>
              Reintentar
            </Boton>
          ) : undefined
        }
      />
    );
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
        escritorio: escritorio(),
      },
    );
    if (desplazamiento !== undefined) mapa.panBy([...desplazamiento], { duration: 300 });
  };

  // Si la página se abre con un emplazamiento en la URL, el mapa empieza en él. Solo al cargar:
  // después, abrir o cerrar la ficha no mueve el mapa (historia 22).
  let enfocadoAlCargar = false;
  createEffect(
    () => {
      const clave = seleccionada();
      return {
        listo: mapaListo(),
        lista: capa().tipo === "lista",
        posicion: emplazamientos().find((e) => e.clave === clave)?.posicion,
      };
    },
    ({ listo: actual, lista, posicion }) => {
      if (enfocadoAlCargar || actual === undefined || !lista) return;
      enfocadoAlCargar = true;
      if (posicion === undefined) return;
      actual.jumpTo({
        center: [posicion.longitud, posicion.latitud],
        zoom: Math.max(actual.getZoom(), 16),
      });
    },
  );

  /** El modelo del móvil, que Chromium da un momento después de pedirlo. */
  const [modelo, setModelo] = createSignal<string>();
  onSettled(() => {
    let vigente = true;
    void leerModelo().then((leido) => {
      if (vigente) setModelo(leido);
    });
    return () => {
      vigente = false;
    };
  });
  const midiendo = createMemo(() => medirAbierto(ubicacion()));

  const aviso = createMemo(() => {
    const actual = estado();
    return actual.tipo === "listo" ? undefined : (
      <AvisoMapa estado={actual} reintentar={arrancar} />
    );
  });

  return (
    <UbicacionContexto value={puntoDeReferencia}>
      <DisposicionMapa
        nombre={`Mapa de ${BARCELONA.nombre}`}
        ocupado={estado().tipo === "cargando" || capa().tipo === "cargando"}
        lienzo={(elemento) => {
          contenedor = elemento;
        }}
        cabecera={<Cabecera lugar={BARCELONA.nombre} />}
        datos={<EstadoDeLaCapa estado={capa()} reintentar={cargarCapa} />}
        ubicacion={
          <>
            <AvisosDeUbicacion panelAbierto={seleccionada() !== null} />
            <Show when={eligiendo()}>
              <EleccionConBuscador alUsarCentro={usarCentro} alIrA={irA} />
            </Show>
          </>
        }
        eligiendo={eligiendo()}
        pinCentral={<PinCentral />}
        dialogo={<PasoPrevio />}
        marcadores={
          <Show when={mapaListo()}>
            {(actual) => (
              <>
                <Marcadores
                  mapa={actual()}
                  emplazamientos={emplazamientos()}
                  barrios={barrios()}
                  seleccionada={seleccionada()}
                  alSeleccionar={seleccionar}
                />
                <ReferenciaEnMapa mapa={actual()} escritorio={escritorio()} />
              </>
            )}
          </Show>
        }
        pista={pista()}
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
            <BotonHexagonal
              etiqueta="Interferencia"
              icono={<IconoOndas />}
              activo={vistaActiva()}
              disabled={!listo() || emplazamientos().length === 0}
              onClick={cambiarVista}
            />
            <BotonHexagonal
              etiqueta="Medir mi señal"
              icono={<IconoSenal />}
              aria-haspopup="dialog"
              onClick={() => navegar(conMedir(ubicacion(), true))}
            />
            <MenuDeUbicacion
              puedeCentrar={listo()}
              alCentrar={() => {
                const referencia = puntoDeReferencia.referencia();
                if (referencia !== undefined) irA(posicionDe(referencia));
              }}
            />
          </>
        }
        atribucion={<Atribucion creditos={creditos()} />}
        aviso={aviso()}
        panelAbierto={seleccionada() !== null}
        vista={vista()}
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
      <Show when={midiendo()}>
        <DialogoMedir
          navegador={{ ...leerNavegador(), modelo: modelo() }}
          direccionMovil={new URL(ruta.medir, window.location.origin).href}
          alCerrar={() => navegar(conMedir(ubicacion(), false), { reemplazar: true })}
        />
      </Show>
    </UbicacionContexto>
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
            texto={<TextoConTerminos texto={textoDatosDelMapa(lista().fecha)} />}
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
            decir que no haya <Termino termino="emplazamiento">emplazamientos</Termino>.
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
