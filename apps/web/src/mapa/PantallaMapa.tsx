import { ESPANA, mismaCoordenada, type Rectangulo } from "@celda/dominio/area";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { Atribucion } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { ControlDelMapa } from "@celda/ui/ControlDelMapa.tsx";
import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { DatosDelMapa } from "@celda/ui/DatosDelMapa.tsx";
import { DisposicionMapa } from "@celda/ui/DisposicionMapa.tsx";
import { IconoOndas } from "@celda/ui/interferencia/PanelInterferencia.tsx";
import { IconoAjustes, IconoEjercicio } from "@celda/ui/ejercicio/Ejercicio.tsx";
import { ZOOM_CELDAS } from "@celda/ui/mapa/celdas.ts";
import { FUENTE_ZONA } from "@celda/ui/mapa/zona.ts";
import { pixelesDeAltura } from "@celda/ui/panel/hoja.ts";
import { IconoSenal } from "@celda/ui/medir/Medir.tsx";
import { Pista } from "@celda/ui/Pista.tsx";
import { recurso, recursoFijo } from "@celda/ui/recurso.ts";
import { Termino, TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import { PinCentral } from "@celda/ui/ubicacion/MarcadorReferencia.tsx";
import * as Effect from "effect/Effect";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js";

import {
  creditoDeBarrios,
  creditoDeMunicipios,
  type EstadoCapa,
  estadoDeCarga,
  type EstadoDeLaVista,
  estadoDeLaVista,
  estadoDeProvincia,
  textoDatosDelMapa,
} from "../capa/estado.ts";
import type { Vista } from "../capa/marcadores.ts";
import { type EstadoProvincia, provinciasDeLaVista } from "../capa/nacional.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";
import { pistaDeCeldas } from "../celdas/celdas.ts";
import { crearCeldas, lienzoDelMapa } from "../celdas/enMapa.ts";
import { AjustesContexto, crearAjustes } from "../ajustes/ajustes.ts";
import { DialogoAjustes } from "../ajustes/DialogoAjustes.tsx";
import { usarDatos } from "../datos.tsx";
import { PanelEjercicio } from "../ejercicio/PanelEjercicio.tsx";
import { SIN_ZONA, type ZonaEnMapa } from "../ejercicio/zona.ts";
import { desplazamientoParaVer } from "../ficha/enfoque.ts";
import { orientacionDe } from "../ficha/diagrama.ts";
import { PanelFicha } from "../ficha/PanelFicha.tsx";
import { type FichaPedida, FichasPublicadas } from "../ficha/servicio.ts";
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
import { crearServicio, lienzoDeServicio, ServicioContexto } from "../servicio/enMapa.ts";
import { celdaDe } from "../servicio/servicio.ts";
import {
  ajustesAbiertos,
  conAjustes,
  conEjercicio,
  conMedir,
  ejercicioDe,
  emplazamientoDe,
  medirAbierto,
  navegar,
  provinciaDe,
  ruta,
  ubicacion,
} from "../lib/rutas.ts";
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
 * El mapa de España a pantalla completa con los emplazamientos de la capa vigente, provincia a
 * provincia (ADR 0016), la fecha de sus datos y un aviso claro si algo no carga o no está.
 */
export function PantallaMapa() {
  const datos = usarDatos();
  const puntoDeReferencia = crearUbicacion(datos);
  const ajustes = crearAjustes(datos);
  const eligiendo = createMemo(() => puntoDeReferencia.ubicacion().estado.tipo === "eligiendo");
  const [escritorio, setEscritorio] = createSignal(window.matchMedia(ESCRITORIO).matches);
  const [estado, setEstado] = createSignal<EstadoMapa>({ tipo: "cargando" });
  const [capa, setCapa] = createSignal<EstadoCapa>({ tipo: "cargando" });
  /** Cómo va cada provincia pedida. Una vez pedida, se queda para la visita. */
  const [provincias, setProvincias] = createSignal<ReadonlyMap<string, EstadoProvincia>>(new Map());
  /** Lo que enseña el mapa cada vez que se decide qué se dibuja. */
  const [vistaDelMapa, setVistaDelMapa] = createSignal<Vista>();
  /** El mapa, cuando ya enseña el callejero. */
  const [mapaListo, setMapaListo] = createSignal<MapaMapLibre>();
  /**
   * El mapa, en cuanto existe. Los marcadores solo necesitan su proyección y salen ya, sobre el
   * fondo, sin esperar a las teselas del callejero.
   */
  const [mapaCreado, setMapaCreado] = createSignal<MapaMapLibre>();
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
  /** Las provincias que se están pidiendo, para cancelarlas al cerrar la pantalla. */
  const pidiendose = new Map<string, AbortController>();
  /**
   * Las provincias ya pedidas en esta visita. No es una señal: se consulta justo después de
   * escribir, y en Solid 2 una señal escrita no cambia hasta el siguiente `flush`.
   */
  const yaPedidas = new Set<string>();

  const fallar = (motivo: MotivoFallo) => setEstado({ tipo: "fallo", motivo });

  const crear = (modulo: ModuloMapaBase) => {
    if (contenedor === undefined) return;
    try {
      const nuevo = modulo.crearMapaBase(contenedor, ESPANA, {
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
      setMapaCreado(nuevo);
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
    setMapaCreado(undefined);
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

  /**
   * Pide las provincias que aún no se han pedido. Una que falló no se vuelve a pedir sola al mover
   * el mapa: se reintenta con su botón.
   */
  const pedirProvincias = (codigos: ReadonlyArray<string>) => {
    const nuevas = codigos.filter((codigo) => !yaPedidas.has(codigo));
    if (nuevas.length === 0) return;
    for (const codigo of nuevas) yaPedidas.add(codigo);
    setProvincias((antes) => {
      const despues = new Map(antes);
      for (const codigo of nuevas) despues.set(codigo, { tipo: "cargando" });
      return despues;
    });
    for (const codigo of nuevas) {
      const parar = new AbortController();
      pidiendose.set(codigo, parar);
      void datos
        .runPromiseExit(
          Effect.flatMap(CapaEmplazamientos, (servicio) => servicio.provincia(codigo)),
          { signal: parar.signal },
        )
        .then((salida) => {
          if (parar.signal.aborted) return;
          pidiendose.delete(codigo);
          setProvincias((antes) => new Map(antes).set(codigo, estadoDeProvincia(salida)));
        });
    }
  };

  const reintentarProvincias = (codigos: ReadonlyArray<string>) => {
    for (const codigo of codigos) yaPedidas.delete(codigo);
    pedirProvincias(codigos);
  };

  /** El resumen ya leído, para pedir provincias sin esperar al siguiente `flush`. */
  let resumenLeido: ResumenLeido | undefined;
  /** La última vista del mapa, por lo mismo. */
  let ultimaVista: Vista | undefined;

  /** Lo que hay que pedir para ver la vista, o la inicial si el mapa aún no ha dicho nada. */
  const pedirLoQueSeVe = () => {
    if (resumenLeido === undefined) return;
    const inicial: Vista = { caja: ESPANA.encuadre, zoom: 10 };
    pedirProvincias(provinciasDeLaVista(resumenLeido, ultimaVista ?? inicial));
  };

  /** El mapa ha decidido qué dibuja: se piden las provincias que se ven. */
  const alCambiarVista = (vista: Vista) => {
    ultimaVista = vista;
    setVistaDelMapa(vista);
    pedirLoQueSeVe();
  };

  /**
   * Pide el resumen de la capa vigente, a la vez que el mapa base. En cuanto llega pide las
   * provincias de lo que se ve y la del emplazamiento de la dirección, si la hay.
   */
  const cargarCapa = () => {
    intentoCapa += 1;
    const este = intentoCapa;
    setCapa({ tipo: "cargando" });
    void datos
      .runPromiseExit(Effect.flatMap(CapaEmplazamientos, (servicio) => servicio.resumen))
      .then((salida) => {
        if (este !== intentoCapa) return;
        const cargada = estadoDeCarga(salida);
        setCapa(cargada);
        if (cargada.tipo !== "lista") return;
        resumenLeido = cargada.resumen;
        pedirLoQueSeVe();
        if (emplazamientoDe(ubicacion()) !== null) pedirProvincias([provinciaDe(ubicacion())]);
      });
  };

  recursoFijo("mapa", () => {
    arrancar();
    return () => {
      intento += 1;
      mapa?.remove();
    };
  });
  recursoFijo("capa", () => {
    cargarCapa();
    return () => {
      intentoCapa += 1;
      for (const parar of pidiendose.values()) parar.abort();
      pidiendose.clear();
    };
  });
  recursoFijo("pantalla:escritorio", () => {
    const pantalla = window.matchMedia(ESCRITORIO);
    const medir = () => setEscritorio(pantalla.matches);
    pantalla.addEventListener("change", medir);
    return () => pantalla.removeEventListener("change", medir);
  });

  // En escritorio, mientras se elige un punto, un clic en el mapa lo marca (historia 26).
  recurso(
    "mapa:clic",
    () => mapaListo(),
    (actual) => {
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

  const resumen = createMemo(() => {
    const actual = capa();
    return actual.tipo === "lista" ? actual.resumen : undefined;
  });
  /** Las provincias que han llegado. */
  const cargadas = createMemo(() =>
    [...provincias().values()].flatMap((estado) =>
      estado.tipo === "lista" ? [estado.provincia] : [],
    ),
  );
  /** Los emplazamientos de las provincias que han llegado: los que el mapa conoce ahora. */
  const emplazamientos = createMemo(() => cargadas().flatMap((p) => p.capa.emplazamientos));
  /** Hasta dónde llegan los datos: las zonas barridas del resumen. */
  const cobertura = createMemo(() => resumen()?.cobertura);
  /**
   * Los créditos del mapa base y, con el resumen, los de los límites de municipios y de barrio
   * que usan las capas.
   */
  const creditos = createMemo(() => {
    const fuentes = resumen()?.fuentes;
    return fuentes === undefined
      ? CREDITOS_MAPA_BASE
      : [
          ...CREDITOS_MAPA_BASE,
          creditoDeMunicipios(fuentes.municipios),
          creditoDeBarrios(fuentes.barrios),
        ];
  });
  /** Lo que dice la marca de agua del mapa de lo que se ve. */
  const estadoVista = createMemo(() => {
    const actual = resumen();
    return actual === undefined ? undefined : estadoDeLaVista(actual, provincias(), vistaDelMapa());
  });

  /** El emplazamiento con la ficha abierta, que dice la URL. */
  const seleccionada = createMemo(() => emplazamientoDe(ubicacion()));
  /** La provincia en cuya capa va, que también dice la URL. */
  const provinciaSeleccionada = createMemo(() => provinciaDe(ubicacion()));
  /**
   * El barrio del ejercicio abierto (`""` sin barrio), o `null` si está cerrado. Sin el modo
   * estudiante el ejercicio no se abre, aunque lo pida la URL.
   */
  const ejercicio = createMemo(() =>
    ajustes.ajustes().modoEstudiante && seleccionada() === null ? ejercicioDe(ubicacion()) : null,
  );
  const panelAbierto = createMemo(() => seleccionada() !== null || ejercicio() !== null);

  /** Lo que el mapa dibuja de la zona del ejercicio y dónde encuadrarla. */
  const [zona, setZona] = createSignal<{
    readonly zona: ZonaEnMapa;
    readonly encuadre: Rectangulo | undefined;
  }>({ zona: SIN_ZONA, encuadre: undefined });
  createEffect(
    () => ({ actual: mapaListo(), dibujo: zona() }),
    ({ actual, dibujo }) => {
      if (actual === undefined) return;
      actual.getSource<GeoJSONSource>(FUENTE_ZONA)?.setData(dibujo.zona);
      const encuadre = dibujo.encuadre;
      if (encuadre === undefined) return;
      // Deja libre lo que tapa el panel: la columna en escritorio y la hoja media en el móvil.
      actual.fitBounds(
        [
          [encuadre.suroeste.longitud, encuadre.suroeste.latitud],
          [encuadre.noreste.longitud, encuadre.noreste.latitud],
        ],
        {
          padding: escritorio()
            ? {
                top: 90,
                bottom: 60,
                left: Math.min(46 * 16, window.innerWidth - 8 * 16) + 40,
                right: 110,
              }
            : {
                top: 80,
                bottom: pixelesDeAltura("media", window.innerHeight) + 20,
                left: 20,
                right: 90,
              },
          duration: 600,
          maxZoom: 16,
        },
      );
    },
  );
  /** La fecha de los datos del mapa: la del resumen. */
  const fechaCapa = createMemo(() => resumen()?.fecha);
  /** La de la provincia del emplazamiento seleccionado, que puede ser de otra versión. */
  const fechaDeLaSeleccionada = createMemo(() => {
    const estado = provincias().get(provinciaSeleccionada());
    return estado?.tipo === "lista" ? estado.provincia.fecha : fechaCapa();
  });

  /**
   * Dónde está el punto de referencia. Cada lectura del GPS trae un objeto nuevo aunque no se haya
   * movido; solo cambia si cambian las coordenadas, y así no se vuelve a calcular nada.
   */
  const posicionDeReferencia = createMemo(
    () => {
      const referencia = puntoDeReferencia.referencia();
      return referencia === undefined ? undefined : posicionDe(referencia);
    },
    { equals: mismaCoordenada },
  );

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
    referencia: posicionDeReferencia,
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

  // Ninguna fuente publica hacia dónde apuntan los sectores: la orientación es la supuesta.
  const servicio = crearServicio(datos, {
    lienzo: createMemo(() => {
      const actual = mapaListo();
      return actual === undefined ? undefined : lienzoDeServicio(actual);
    }),
    emplazamiento: createMemo(() => {
      const clave = seleccionada();
      const emplazamiento = emplazamientos().find((e) => e.clave === clave);
      return emplazamiento === undefined
        ? undefined
        : { clave: emplazamiento.clave, posicion: emplazamiento.posicion };
    }),
    punto: posicionDeReferencia,
    celda: (clave) => celdaDe(celdas.calculadas(), clave),
    orientacion: orientacionDe([]),
  });
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

  /** Las fichas de lo que se ve de cerca se descargan antes de tocarlas (ver `FichasPublicadas`). */
  const precargarFichas = (pedidas: ReadonlyArray<FichaPedida>) => {
    void datos.runPromise(Effect.flatMap(FichasPublicadas, (fichas) => fichas.precargar(pedidas)));
  };

  /** Abre la ficha y, si el marcador queda debajo del panel, mueve el mapa lo justo. */
  const seleccionar = (clave: string, provincia: string) => {
    navegar(ruta.emplazamiento(clave, provincia));
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
      const suya = provincias().get(provinciaSeleccionada());
      return {
        listo: mapaListo(),
        lista: suya !== undefined && suya.tipo !== "cargando",
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
  recursoFijo("navegador:modelo", () => {
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
    <AjustesContexto value={ajustes}>
      <UbicacionContexto value={puntoDeReferencia}>
        <ServicioContexto value={servicio}>
          <DisposicionMapa
            nombre={`Mapa de ${ESPANA.nombre}`}
            ocupado={estado().tipo === "cargando" || capa().tipo === "cargando"}
            lienzo={(elemento) => {
              contenedor = elemento;
            }}
            cabecera={<Cabecera lugar={ESPANA.nombre} />}
            datos={
              <EstadoDeLaCapa
                estado={capa()}
                vista={estadoVista()}
                emplazamientos={resumen()?.provincias.reduce((n, p) => n + p.emplazamientos, 0)}
                reintentar={cargarCapa}
                reintentarProvincias={reintentarProvincias}
              />
            }
            ubicacion={
              <>
                <AvisosDeUbicacion panelAbierto={panelAbierto()} cobertura={cobertura()} />
                <Show when={eligiendo()}>
                  <EleccionConBuscador
                    alUsarCentro={usarCentro}
                    alIrA={irA}
                    encuadre={encuadre()}
                  />
                </Show>
              </>
            }
            eligiendo={eligiendo()}
            pinCentral={<PinCentral />}
            dialogo={<PasoPrevio />}
            marcadores={
              <Show when={mapaCreado()}>
                {(actual) => (
                  <>
                    <Show when={resumen()}>
                      {(leido) => (
                        <Marcadores
                          mapa={actual()}
                          resumen={leido()}
                          provincias={provincias()}
                          seleccionada={seleccionada()}
                          alSeleccionar={seleccionar}
                          alVer={precargarFichas}
                          alCambiarVista={alCambiarVista}
                        />
                      )}
                    </Show>
                    <ReferenciaEnMapa
                      mapa={actual()}
                      escritorio={escritorio()}
                      conEtiqueta={!vistaActiva()}
                    />
                  </>
                )}
              </Show>
            }
            pista={pista()}
            zoom={
              <>
                <ControlDelMapa
                  etiqueta="Acercar"
                  icono="+"
                  disabled={!listo()}
                  onClick={() => mapa?.zoomIn()}
                />
                <ControlDelMapa
                  etiqueta="Alejar"
                  icono="−"
                  disabled={!listo()}
                  onClick={() => mapa?.zoomOut()}
                />
              </>
            }
            controles={
              <>
                <ControlDelMapa
                  etiqueta="Interferencia"
                  detalle="Simula dónde se pisan las señales de una compañía."
                  icono={<IconoOndas />}
                  activo={vistaActiva()}
                  disabled={!listo() || emplazamientos().length === 0}
                  onClick={cambiarVista}
                />
                <ControlDelMapa
                  etiqueta="Medir mi señal"
                  detalle="Cómo leer en el móvil la señal que te llega."
                  icono={<IconoSenal />}
                  aria-haspopup="dialog"
                  onClick={() => navegar(conMedir(ubicacion(), true))}
                />
              </>
            }
            botonUbicacion={
              <MenuDeUbicacion
                puedeCentrar={listo()}
                alCentrar={() => {
                  const referencia = puntoDeReferencia.referencia();
                  if (referencia !== undefined) irA(posicionDe(referencia));
                }}
              />
            }
            controlesSecundarios={
              <>
                <Show when={ajustes.ajustes().modoEstudiante}>
                  <ControlDelMapa
                    etiqueta="Ejercicio"
                    detalle="Los cálculos de un barrio paso a paso, con sus fuentes."
                    icono={<IconoEjercicio />}
                    activo={ejercicio() !== null}
                    onClick={() =>
                      navegar(conEjercicio(ubicacion(), ejercicio() === null ? "" : null))
                    }
                  />
                </Show>
                <ControlDelMapa
                  etiqueta="Ajustes"
                  detalle="Las preferencias de Celda en este dispositivo."
                  icono={<IconoAjustes />}
                  aria-haspopup="dialog"
                  onClick={() => navegar(conAjustes(ubicacion(), true))}
                />
              </>
            }
            atribucion={<Atribucion creditos={creditos()} />}
            aviso={aviso()}
            panelAbierto={panelAbierto()}
            panelAncho={seleccionada() === null && ejercicio() !== null}
            vista={vista()}
            panel={
              <Switch>
                <Match when={seleccionada()}>
                  {(clave) => (
                    <PanelFicha
                      clave={clave()}
                      provincia={provinciaSeleccionada()}
                      fechaCapa={fechaDeLaSeleccionada()}
                      alCerrar={() => navegar(ruta.mapa)}
                    />
                  )}
                </Match>
                <Match when={ejercicio() !== null}>
                  <PanelEjercicio
                    barrio={ejercicio() ?? ""}
                    emplazamientos={emplazamientos()}
                    fechaCapa={fechaCapa()}
                    alElegirBarrio={(codigo) =>
                      navegar(conEjercicio(ubicacion(), codigo), { reemplazar: true })
                    }
                    alDibujar={(dibujo, encuadre) => setZona({ zona: dibujo, encuadre })}
                    alCerrar={() => navegar(conEjercicio(ubicacion(), null))}
                  />
                </Match>
              </Switch>
            }
          />
          <Show when={midiendo()}>
            <DialogoMedir
              navegador={{ ...leerNavegador(), modelo: modelo() }}
              direccionMovil={new URL(ruta.medir, window.location.origin).href}
              alCerrar={() => navegar(conMedir(ubicacion(), false), { reemplazar: true })}
            />
          </Show>
          <Show when={ajustesAbiertos(ubicacion())}>
            <DialogoAjustes
              alCerrar={() => navegar(conAjustes(ubicacion(), false), { reemplazar: true })}
            />
          </Show>
        </ServicioContexto>
      </UbicacionContexto>
    </AjustesContexto>
  );
}

/** «Barcelona», «Barcelona y Girona», «Barcelona, Girona y Lleida». */
const enumerar = (nombres: ReadonlyArray<string>): string =>
  nombres.length <= 1
    ? (nombres[0] ?? "")
    : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1) ?? ""}`;

/**
 * La fecha de los datos de lo que se ve o, mientras llega la capa, que está cargando. Si no llega,
 * lo dice con un reintento: un mapa sin marcadores no quiere decir que no haya emplazamientos. Lo
 * mismo con cada provincia que se ve, y si lo que se ve queda fuera de lo barrido, lo dice
 * (ADR 0016).
 */
export function EstadoDeLaCapa(props: {
  readonly estado: EstadoCapa;
  readonly vista: EstadoDeLaVista | undefined;
  /** Cuántos emplazamientos tiene el resumen. */
  readonly emplazamientos: number | undefined;
  readonly reintentar: () => void;
  readonly reintentarProvincias: (codigos: ReadonlyArray<string>) => void;
}) {
  // Todo sale de un solo memo que se lee en cada rama sin pasar por el valor de `Match`: al cambiar
  // de rama, la vieja puede volver a leer antes de desmontarse, y con el valor de `Match` eso es
  // una lectura caducada.
  const marca = createMemo(() => marcaDeLaCapa(props.estado, props.vista));
  const fallidas = () => {
    const actual = marca();
    return actual.tipo === "fallo-provincias" ? actual.provincias : [];
  };
  const motivo = () => {
    const actual = marca();
    return actual.tipo === "fallo" ? actual.motivo : "interno";
  };
  return (
    <Switch>
      <Match when={marca().tipo === "cargando"}>
        <DatosDelMapa tono="espera" texto="Cargando los emplazamientos…" />
      </Match>
      <Match when={marca().tipo === "fallo"}>
        <Aviso
          tono="fallo"
          titulo="No se han podido cargar los emplazamientos"
          acciones={
            <Boton variante="secundario" onClick={() => props.reintentar()}>
              Reintentar
            </Boton>
          }
        >
          {EXPLICACION_FALLO_CAPA[motivo()]} El mapa se ve, pero sin marcadores: eso no quiere decir
          que no haya <Termino termino="emplazamiento">emplazamientos</Termino>.
        </Aviso>
      </Match>
      <Match when={marca().tipo === "fallo-provincias"}>
        <Aviso
          tono="fallo"
          titulo={`No han llegado los emplazamientos de ${enumerar(fallidas().map((p) => p.nombre))}`}
          acciones={
            <Boton
              variante="secundario"
              onClick={() => props.reintentarProvincias(fallidas().map((p) => p.codigo))}
            >
              Reintentar
            </Boton>
          }
        >
          Puede fallar la conexión o estar bloqueado el servidor. Lo que se ve de esa provincia es
          su resumen: eso no quiere decir que no haya{" "}
          <Termino termino="emplazamiento">emplazamientos</Termino>.
        </Aviso>
      </Match>
      <Match when={marca().tipo === "cargando-provincias"}>
        <DatosDelMapa tono="espera" texto={textoDeMarca(marca())} />
      </Match>
      <Match when={marca().tipo === "sin-datos"}>
        <DatosDelMapa
          tono="limite"
          texto="Celda aún no tiene datos de aquí"
          detalle={detalleDeMarca(marca(), props.emplazamientos)}
        />
      </Match>
      <Match when={marca().tipo === "datos"}>
        <DatosDelMapa
          texto={<TextoConTerminos texto={textoMarcadoDe(marca())} />}
          detalle={detalleDeMarca(marca(), props.emplazamientos)}
        />
      </Match>
    </Switch>
  );
}

/** Lo que dice la marca de agua del mapa, de la capa y de lo que se ve. */
type MarcaDeLaCapa =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "fallo"; readonly motivo: keyof typeof EXPLICACION_FALLO_CAPA }
  | {
      readonly tipo: "fallo-provincias";
      readonly provincias: ReadonlyArray<{ readonly codigo: string; readonly nombre: string }>;
    }
  | { readonly tipo: "cargando-provincias"; readonly nombres: ReadonlyArray<string> }
  | { readonly tipo: "sin-datos"; readonly barridas: ReadonlyArray<string> }
  | {
      readonly tipo: "datos";
      readonly version: string;
      readonly fecha: number;
      readonly hasta: number;
      readonly barrido: number | null;
    };

const marcaDeLaCapa = (estado: EstadoCapa, vista: EstadoDeLaVista | undefined): MarcaDeLaCapa => {
  if (estado.tipo !== "lista") return estado;
  const { resumen } = estado;
  if (vista?.tipo === "fallo") return { tipo: "fallo-provincias", provincias: vista.provincias };
  if (vista?.tipo === "cargando") {
    return { tipo: "cargando-provincias", nombres: vista.provincias.map((p) => p.nombre) };
  }
  if (vista?.tipo === "sin-datos") return vista;
  return vista?.tipo === "datos"
    ? { ...vista, version: resumen.version }
    : {
        tipo: "datos",
        version: resumen.version,
        fecha: resumen.fecha,
        hasta: resumen.fecha,
        barrido: null,
      };
};

const textoDeMarca = (marca: MarcaDeLaCapa): string =>
  marca.tipo === "cargando-provincias" ? `Cargando ${enumerar(marca.nombres)}…` : "";

const textoMarcadoDe = (marca: MarcaDeLaCapa) =>
  marca.tipo === "datos"
    ? textoDatosDelMapa(marca.fecha, { hasta: marca.hasta, barrido: marca.barrido })
    : [];

const detalleDeMarca = (marca: MarcaDeLaCapa, emplazamientos: number | undefined): string => {
  if (marca.tipo === "sin-datos") {
    return marca.barridas.length === 0
      ? "Celda aún no ha barrido ninguna zona."
      : `Por ahora tiene los emplazamientos de ${enumerar(marca.barridas)}.`;
  }
  return marca.tipo === "datos"
    ? `${emplazamientos ?? 0} emplazamientos en España · capa ${marca.version}`
    : "";
};

const EXPLICACION_FALLO_CAPA = {
  "sin-publicar": "Todavía no hay ninguna capa de emplazamientos publicada.",
  "sin-origen":
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
