import {
  cajaDe,
  type Coordenada,
  ESPANA,
  mismaCoordenada,
  type Rectangulo,
} from "@celda/dominio/area";
import { origenCerca } from "@celda/dominio/plano";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { Atribucion } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { ControlDelMapa } from "@celda/ui/ControlDelMapa.tsx";
import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { DatosDelMapa } from "@celda/ui/DatosDelMapa.tsx";
import { DisposicionMapa } from "@celda/ui/DisposicionMapa.tsx";
import { IconoOndas } from "@celda/ui/interferencia/PanelInterferencia.tsx";
import { IconoAportaciones } from "@celda/ui/buzon/Compartir.tsx";
import { IconoAjustes, IconoEjercicio } from "@celda/ui/ejercicio/Ejercicio.tsx";
import { IconoFotoAerea } from "@celda/ui/foto/FotoAerea.tsx";
import { ZOOM_CELDAS } from "@celda/ui/mapa/celdas.ts";
import { FUENTE_ZONA } from "@celda/ui/mapa/zona.ts";
import { pixelesDeAltura } from "@celda/ui/panel/hoja.ts";
import { IconoSenal } from "@celda/ui/medir/Medir.tsx";
import { Pista } from "@celda/ui/Pista.tsx";
import { mismasListas, recurso, recursoFijo } from "@celda/ui/recurso.ts";
import { Termino, TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import { PinCentral } from "@celda/ui/ubicacion/MarcadorReferencia.tsx";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal, Match, Show, Switch, untrack } from "solid-js";

import {
  creditoDeBarrios,
  creditoDeMunicipios,
  dondeHayDatos,
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
import {
  cargadasDe,
  enumerar,
  estadoDeLasVecinas,
  mismasVecinas,
  provinciasCerca,
  rectanguloDePunto,
  VECINAS_LISTAS,
} from "../capa/vecinas.ts";
import { pistaDeCeldas, type ProvinciaFuera, provinciasQueFaltan } from "../celdas/celdas.ts";
import { crearCeldas, lienzoDelMapa } from "../celdas/enMapa.ts";
import { AjustesContexto, crearAjustes } from "../ajustes/ajustes.ts";
import { DialogoAjustes } from "../ajustes/DialogoAjustes.tsx";
import { DialogoAportaciones } from "../buzon/DialogoAportaciones.tsx";
import { usarDatos } from "../datos.tsx";
import { PanelEjercicio } from "../ejercicio/PanelEjercicio.tsx";
import {
  cargarContornos,
  cargarProvinciasDeZonas,
  SIN_ZONA,
  type ZonaEnMapa,
} from "../ejercicio/zona.ts";
import { centroLibre, desplazamientoParaVer } from "../ficha/enfoque.ts";
import { crearFoto, FotoContexto, lienzoDeFoto } from "../foto/enMapa.ts";
import { aPieDeCalle, CREDITO_FOTO_AEREA, pideVerFoto } from "../foto/foto.ts";
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
  provinciasParaSinr,
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
  aportacionesAbiertas,
  conAportaciones,
  conProvincia,
  ejercicioDe,
  emplazamientoDe,
  medirAbierto,
  navegar,
  provinciaDe,
  ruta,
  ubicacion,
} from "../lib/rutas.ts";
import { DialogoMedir } from "../medir/DialogoMedir.tsx";
import { detectarDispositivo } from "../medir/dispositivo.ts";
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
import type { Callejero } from "./callejero.ts";
import {
  CREDITOS_MAPA_BASE,
  CREDITOS_RESERVA,
  type EstadoMapa,
  hayWebgl,
  type MotivoFallo,
} from "./estado.ts";
import type { LectorDeRotulos } from "./rotulosDeCiudad.ts";
import { type CargasDeZonas, crearLugares } from "./lugar.ts";
import { Marcadores } from "./Marcadores.tsx";
import {
  crearVistaInicial,
  provinciaDelPunto,
  rellenoDeLaVista,
  zoomParaEncuadrar,
} from "./vistaInicial.ts";

type ModuloMapaBase = typeof import("./mapaBase.ts");

/** Solo para los tipos: el panel de la vista no se monta sin elección. */
const ELECCION_VACIA: EleccionVista = { compania: "movistar", mhz: 1800, ocupacion: 0.5 };

/** De dónde salen las provincias y sus contornos para saber dónde cae un punto. */
const CARGAS_DE_ZONAS: CargasDeZonas = {
  provincias: cargarProvinciasDeZonas,
  contornos: cargarContornos,
};

/** El ancho a partir del cual el panel va a la izquierda y el punto se elige con un clic. */
const ESCRITORIO = "(min-width: 48rem)";

/**
 * Hasta dónde, alrededor de lo que se ve al zoom de las celdas, se cargan las provincias vecinas
 * antes de calcular. Una celda de ciudad no pasa de unos cientos de metros; si una del campo llega
 * más lejos, la provincia que la puede recortar se pide igual (`provinciasQueFaltan`).
 */
const MARGEN_VECINAS_CELDAS_M = 2000;

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
  /**
   * De dónde sale el callejero. Pasa a la reserva si el principal no llega, y ya no vuelve en esta
   * visita: un reintento crea el mapa con la reserva.
   */
  const [callejero, setCallejero] = createSignal<Callejero>("principal");
  /** Lo mismo, para crear el mapa sin esperar al siguiente `flush`. */
  let callejeroActual: Callejero = "principal";
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
  /** El lector de los rótulos de ciudad, que llega con el código del mapa (ADR 0024). */
  const [lectorDeRotulos, setLectorDeRotulos] = createSignal<LectorDeRotulos>();
  const listo = createMemo(() => estado().tipo === "listo");
  /** Si el mapa está al zoom de las celdas o más cerca. */
  const [cerca, setCerca] = createSignal(false);
  /** Si el mapa está a pie de calle, donde la pista ofrece la foto aérea. */
  const [calle, setCalle] = createSignal(false);
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

  /** Lo que se ve, como vista de la capa: el centro dice el lugar de la cabecera. */
  const vistaDelEncuadre = createMemo((): Vista | undefined => {
    const actual = encuadre();
    return actual === undefined
      ? undefined
      : { caja: { suroeste: actual.suroeste, noreste: actual.noreste }, zoom: actual.zoom };
  });
  /** El punto de referencia guardado en el dispositivo, mientras decide la vista inicial. */
  const puntoAlAbrir = createMemo((): Coordenada | null | undefined => {
    if (!puntoDeReferencia.puntoGuardadoLeido()) return undefined;
    const referencia = puntoDeReferencia.referencia();
    return referencia === undefined ? null : posicionDe(referencia);
  });
  /** Si ya se sabe la vista inicial: entonces el punto guardado ya no hace falta situarlo. */
  const [inicialDecidida, setInicialDecidida] = createSignal(false);
  const lugares = crearLugares({
    vista: vistaDelEncuadre,
    puntos: () => {
      const punto = puntoAlAbrir();
      return inicialDecidida() || punto === null || punto === undefined ? [] : [punto];
    },
    cargas: CARGAS_DE_ZONAS,
  });
  // Con un emplazamiento en la dirección, el mapa empieza en él (más abajo).
  const vistaInicial = crearVistaInicial({
    activa: emplazamientoDe(ubicacion()) === null,
    alAbrir: () => {
      const punto = puntoAlAbrir();
      const actual = capa();
      return {
        punto,
        provinciaDelPunto:
          punto === null || punto === undefined
            ? null
            : provinciaDelPunto(lugares.dondeCae(punto), lugares.provincias()),
        resumen:
          actual.tipo === "cargando" ? undefined : actual.tipo === "lista" ? actual.resumen : null,
      };
    },
    mapa: mapaCreado,
    relleno: () => rellenoDeLaVista(escritorio()),
  });
  createEffect(
    () => vistaInicial.encuadre() !== undefined,
    (decidida) => {
      if (decidida) setInicialDecidida(true);
    },
  );

  const crear = (modulo: ModuloMapaBase) => {
    if (contenedor === undefined) return;
    try {
      const inicial = vistaInicial.alCrear();
      const nuevo = modulo.crearMapaBase(
        contenedor,
        inicial === undefined ? ESPANA : { ...ESPANA, encuadre: inicial },
        {
          listo: () => {
            setEstado({ tipo: "listo" });
            setMapaListo(nuevo);
          },
          fallo: fallar,
          aReserva: () => {
            callejeroActual = "reserva";
            setCallejero("reserva");
          },
        },
        rellenoDeLaVista(escritorio()),
        callejeroActual,
      );
      const mirarZoom = () => {
        setCerca(nuevo.getZoom() >= ZOOM_CELDAS);
        setCalle(aPieDeCalle(nuevo.getZoom()));
      };
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
      setLectorDeRotulos(() => modulo.LECTOR_DE_ROTULOS);
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
    const caja = vistaInicial.encuadre();
    const inicial: Vista | undefined =
      caja === undefined
        ? undefined
        : {
            caja,
            zoom: zoomParaEncuadrar(
              caja,
              { ancho: window.innerWidth, alto: window.innerHeight },
              rellenoDeLaVista(escritorio()),
            ),
          };
    const vista = ultimaVista ?? inicial;
    if (vista !== undefined) pedirProvincias(provinciasDeLaVista(resumenLeido, vista));
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
        // Sin provincia en el enlace, la pide `recurso("capa:clave")` cuando la encuentra.
        const suya = provinciaDe(ubicacion());
        if (emplazamientoDe(ubicacion()) !== null && suya !== null) pedirProvincias([suya]);
      });
  };

  // Cuando se sabe la vista inicial, sus provincias se piden sin esperar al mapa.
  recurso(
    "capa:vista-inicial",
    () => vistaInicial.encuadre(),
    () => {
      pedirLoQueSeVe();
      return undefined;
    },
  );

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

  /** Quien espera el siguiente punto que se toque en el mapa: el ejercicio al elegir su zona. */
  let esperandoPunto: ((punto: Coordenada) => void) | undefined;

  // En escritorio, mientras se elige un punto, un clic en el mapa lo marca (historia 26). Si el
  // ejercicio espera un punto para elegir su zona, el clic es suyo, también en el móvil.
  recurso(
    "mapa:clic",
    () => mapaListo(),
    (actual) => {
      const alClic = (evento: {
        readonly lngLat: { readonly lng: number; readonly lat: number };
      }) => {
        if (esperandoPunto !== undefined) {
          esperandoPunto({ longitud: evento.lngLat.lng, latitud: evento.lngLat.lat });
          return;
        }
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
    vistaInicial.yaColocado();
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
  /** Dónde tiene Celda emplazamientos, para la marca de agua. */
  const donde = createMemo(() => {
    const actual = resumen();
    return actual === undefined ? [] : dondeHayDatos(actual);
  });
  /** Las provincias que han llegado. */
  const cargadas = createMemo(() =>
    [...provincias().values()].flatMap((estado) =>
      estado.tipo === "lista" ? [estado.provincia] : [],
    ),
  );
  /** Los emplazamientos de las provincias que han llegado: los que el mapa conoce ahora. */
  const emplazamientos = createMemo(() => cargadas().flatMap((p) => p.capa.emplazamientos));
  /**
   * Los créditos del mapa base y, con el resumen, el de los límites de municipios. El de los
   * límites de barrio, solo con una provincia con barrios cargada: la de Barcelona.
   */
  const conBarrios = createMemo(() => cargadas().some((p) => p.capa.barrios.length > 0));
  const creditos = createMemo(() => {
    const fuentes = resumen()?.fuentes;
    const delCallejero = callejero() === "reserva" ? CREDITOS_RESERVA : CREDITOS_MAPA_BASE;
    return fuentes === undefined
      ? delCallejero
      : [
          ...delCallejero,
          creditoDeMunicipios(fuentes.municipios),
          ...(conBarrios() ? [creditoDeBarrios(fuentes.barrios)] : []),
        ];
  });
  /** Lo que dice la marca de agua del mapa de lo que se ve. */
  const estadoVista = createMemo(() => {
    const actual = resumen();
    return actual === undefined ? undefined : estadoDeLaVista(actual, provincias(), vistaDelMapa());
  });

  /** El emplazamiento con la ficha abierta, que dice la URL. */
  const seleccionada = createMemo(() => emplazamientoDe(ubicacion()));
  /** La provincia en cuya capa va, que también dice la URL, o `null` si no la dice. */
  const provinciaSeleccionada = createMemo(() => provinciaDe(ubicacion()));

  /** La foto aérea (ADR 0022), apagada al abrir, y «Ver el edificio» de la ficha. */
  const foto = crearFoto({
    lienzo: createMemo(() => {
      const actual = mapaListo();
      return actual === undefined ? undefined : lienzoDeFoto(actual);
    }),
    seleccionada,
    desplazamiento: () => centroLibre(escritorio()),
  });

  // Un enlace sin provincia: se busca en el índice de claves del resumen y, si está, la dirección
  // pasa a llevarla y se pide su provincia. Si no está, la ficha dice que no existe.
  recurso(
    "capa:clave",
    () => {
      const clave = seleccionada();
      return clave !== null && provinciaSeleccionada() === null && resumen() !== undefined
        ? clave
        : undefined;
    },
    (clave) => {
      const parar = new AbortController();
      void datos
        .runPromiseExit(
          Effect.flatMap(CapaEmplazamientos, (servicio) => servicio.provinciaDeClave(clave)),
          { signal: parar.signal },
        )
        .then((salida) => {
          if (parar.signal.aborted || !Exit.isSuccess(salida)) return;
          const provincia = Option.getOrUndefined(salida.value);
          if (provincia === undefined || emplazamientoDe(ubicacion()) !== clave) return;
          pedirProvincias([provincia]);
          navegar(conProvincia(ubicacion(), provincia), { reemplazar: true });
        });
      return () => parar.abort();
    },
  );
  /**
   * La zona del ejercicio abierto (`""` sin zona), o `null` si está cerrado. Sin el modo
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
      vistaInicial.yaColocado();
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
    const codigo = provinciaSeleccionada();
    const estado = codigo === null ? undefined : provincias().get(codigo);
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

  /** Dónde está el emplazamiento seleccionado, si su provincia ya ha llegado. */
  const posicionSeleccionada = createMemo(
    () => {
      const clave = seleccionada();
      return clave === null ? undefined : emplazamientos().find((e) => e.clave === clave)?.posicion;
    },
    { equals: mismaCoordenada },
  );

  /**
   * Lo que miran las celdas: lo que se ve al zoom de las celdas y el emplazamiento seleccionado,
   * cuyo sector que da servicio usa su celda. Alejado, lo último que miraron: así alejarse no
   * cambia las provincias de las celdas ni las recalcula.
   */
  const zonaDeCeldas = createMemo<ReadonlyArray<Rectangulo> | undefined>((antes) => {
    const actual = encuadre();
    if (!cerca() || actual === undefined) return antes;
    const posicion = posicionSeleccionada();
    return [
      { suroeste: actual.suroeste, noreste: actual.noreste },
      ...(posicion === undefined ? [] : [rectanguloDePunto(posicion)]),
    ];
  });
  /** Las provincias cerca de lo que miran las celdas, por código. */
  const cercaDeLasCeldas = createMemo(
    () => {
      const actual = resumen();
      const zona = zonaDeCeldas();
      return actual === undefined || zona === undefined
        ? []
        : provinciasCerca(actual, zona, MARGEN_VECINAS_CELDAS_M);
    },
    { equals: mismasListas },
  );
  /**
   * Las provincias que alguna celda que se ve necesita además de las cercanas: las que podrían
   * recortarla (`provinciasQueFaltan`). Valen mientras no cambien las cercanas; se acumulan, y así
   * una provincia pedida no sale del cálculo en cuanto su celda deja de ser dudosa.
   */
  const [lejanas, setLejanas] = createSignal<{
    readonly cerca: ReadonlyArray<string>;
    readonly codigos: ReadonlyArray<string>;
  }>({ cerca: [], codigos: [] });
  /** Las provincias con que se calculan las celdas, por código. */
  const provinciasDeCeldas = createMemo(
    () => {
      const base = cercaDeLasCeldas();
      const extra = lejanas();
      return extra.cerca === base ? [...new Set([...base, ...extra.codigos])].sort() : base;
    },
    { equals: mismasListas },
  );
  /** Las que ya han llegado: con ellas se calcula. */
  const cargadasDeCeldas = createMemo(() => cargadasDe(provincias(), provinciasDeCeldas()), {
    equals: mismasListas,
  });
  const emplazamientosDeCeldas = createMemo(() =>
    cargadasDeCeldas().flatMap((p) => p.capa.emplazamientos),
  );
  /** Las provincias con emplazamientos que no entran en el cálculo, con su caja. */
  const fueraDeCeldas = createMemo((): ReadonlyArray<ProvinciaFuera> => {
    const actual = resumen();
    const dentro = new Set(cargadasDeCeldas().map((p) => p.codigo));
    return (actual?.provincias ?? []).flatMap((p) =>
      p.caja === undefined || p.fichero === undefined || dentro.has(p.codigo)
        ? []
        : [{ codigo: p.codigo, caja: p.caja }],
    );
  });
  /**
   * Hasta dónde llegan las celdas: la caja de las provincias del cálculo, también de las que aún
   * no han llegado. Así una celda que ya se dibuja no cambia cuando llegan las demás.
   */
  const cajaDeCeldas = createMemo(
    () => {
      const codigos = provinciasDeCeldas();
      const cajas = (resumen()?.provincias ?? []).flatMap((p) =>
        codigos.includes(p.codigo) && p.caja !== undefined ? [p.caja.suroeste, p.caja.noreste] : [],
      );
      return cajaDe(cajas);
    },
    {
      equals: (a, b) =>
        a === b ||
        (a !== undefined &&
          b !== undefined &&
          mismaCoordenada(a.suroeste, b.suroeste) &&
          mismaCoordenada(a.noreste, b.noreste)),
    },
  );
  /**
   * El origen del plano de las celdas: el de la casilla de lo que se ve (`origenCerca`). Así las
   * celdas que se ven se miden sin deformarse, estén en Barcelona o en Canarias, y moverse dentro
   * de la casilla no las recalcula.
   */
  const origenDeCeldas = createMemo(
    () => {
      const [vista] = zonaDeCeldas() ?? [];
      return vista === undefined
        ? undefined
        : origenCerca({
            longitud: (vista.suroeste.longitud + vista.noreste.longitud) / 2,
            latitud: (vista.suroeste.latitud + vista.noreste.latitud) / 2,
          });
    },
    { equals: mismaCoordenada },
  );
  /** Cómo van las provincias de las celdas: la pista lo dice mientras falta alguna. */
  const vecinasDeCeldas = createMemo(
    () => {
      const actual = resumen();
      return actual === undefined
        ? VECINAS_LISTAS
        : estadoDeLasVecinas(actual, provincias(), provinciasDeCeldas());
    },
    { equals: mismasVecinas },
  );

  const celdas = crearCeldas(datos, {
    lienzo: createMemo(() => {
      const actual = mapaListo();
      return actual === undefined ? undefined : lienzoDelMapa(actual);
    }),
    emplazamientos: emplazamientosDeCeldas,
    fuera: fueraDeCeldas,
    caja: cajaDeCeldas,
    origen: origenDeCeldas,
    cerca,
    seleccionada,
  });

  // Si alguna celda que se ve es dudosa, se piden también las provincias que podrían recortarla.
  createEffect(
    () => {
      const calculadas = celdas.calculadas();
      const zona = zonaDeCeldas();
      return {
        base: cercaDeLasCeldas(),
        faltan:
          calculadas === undefined || zona === undefined
            ? []
            : zona.flatMap((r) => provinciasQueFaltan(calculadas.dudosas, r)),
      };
    },
    ({ base, faltan }) => {
      const antes = untrack(lejanas);
      const previas = antes.cerca === base ? antes.codigos : [];
      const nuevas = faltan.filter((codigo) => !previas.includes(codigo));
      if (nuevas.length > 0 || antes.cerca !== base) {
        setLejanas({ cerca: base, codigos: [...previas, ...nuevas].sort() });
      }
    },
  );

  /** Las provincias con estaciones que mira la vista de interferencia, por código. */
  const provinciasDeInterferencia = createMemo(
    () => {
      const actual = resumen();
      return actual === undefined || !vistaActiva()
        ? []
        : provinciasParaSinr(actual.provincias, encuadre(), posicionDeReferencia());
    },
    { equals: mismasListas },
  );
  const cargadasDeInterferencia = createMemo(
    () => cargadasDe(provincias(), provinciasDeInterferencia()),
    { equals: mismasListas },
  );
  const interferencia = crearInterferencia(datos, {
    lienzo: createMemo(() => {
      const actual = mapaListo();
      return actual === undefined ? undefined : lienzoDeInterferencia(actual);
    }),
    activa: vistaActiva,
    emplazamientos: createMemo(() =>
      cargadasDeInterferencia().flatMap((p) => p.capa.emplazamientos),
    ),
    eleccion,
    encuadre,
    referencia: posicionDeReferencia,
    vecinas: () => {
      const actual = resumen();
      return actual === undefined
        ? VECINAS_LISTAS
        : estadoDeLasVecinas(actual, provincias(), provinciasDeInterferencia());
    },
  });

  // Las provincias vecinas que necesitan las celdas y la vista se piden como las que se ven: una
  // vez por visita. Una que falla se reintenta con su botón.
  recurso(
    "capa:vecinas",
    () => [...new Set([...provinciasDeCeldas(), ...provinciasDeInterferencia()])].sort(),
    (codigos) => {
      pedirProvincias(codigos);
      return undefined;
    },
    { iguales: mismasListas },
  );

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
        reintentar={() => {
          const { estado, faltan } = interferencia.calculo();
          if (estado === "sin-vecinas") {
            reintentarProvincias((faltan ?? []).map((p) => p.codigo));
          } else {
            interferencia.reintentar();
          }
        }}
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
  /** Con un emplazamiento seleccionado a pie de calle, la pista ofrece la foto aérea. */
  const conPistaDeFoto = createMemo(() =>
    pideVerFoto({
      encendida: foto.encendida(),
      seleccionado: seleccionada() !== null,
      aPieDeCalle: calle(),
      vistaActiva: vistaActiva(),
    }),
  );
  const pista = createMemo(() => {
    // Con la vista de interferencia, su panel dice qué es cada cosa y las celdas no se ven.
    if (vistaActiva()) return undefined;
    if (conPistaDeFoto()) {
      return (
        <Pista
          texto="¿Cuál es el edificio? Míralo en la foto aérea."
          accion={
            <Boton variante="secundario" onClick={() => foto.encender()}>
              Ver foto
            </Boton>
          }
        />
      );
    }
    const actual = pistaDeCeldas(cerca(), celdas.calculo(), vecinasDeCeldas());
    if (actual === undefined) return undefined;
    const { reintentar } = actual;
    return (
      <Pista
        texto={actual.texto}
        modelo={actual.modelo}
        accion={
          reintentar === false ? undefined : (
            <Boton
              variante="secundario"
              onClick={() =>
                reintentar === "calculo" ? celdas.reintentar() : reintentarProvincias(reintentar)
              }
            >
              Reintentar
            </Boton>
          )
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
      const codigo = provinciaSeleccionada();
      const suya = codigo === null ? undefined : provincias().get(codigo);
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
      <AvisoMapa estado={actual} callejero={callejero()} reintentar={arrancar} />
    );
  });

  return (
    <AjustesContexto value={ajustes}>
      <UbicacionContexto value={puntoDeReferencia}>
        <ServicioContexto value={servicio}>
          <FotoContexto value={foto}>
            <DisposicionMapa
              nombre={`Mapa de ${ESPANA.nombre}`}
              ocupado={estado().tipo === "cargando" || capa().tipo === "cargando"}
              lienzo={(elemento) => {
                contenedor = elemento;
              }}
              cabecera={<Cabecera lugar={lugares.nombre()} />}
              datos={
                <EstadoDeLaCapa
                  estado={capa()}
                  vista={estadoVista()}
                  emplazamientos={resumen()?.provincias.reduce((n, p) => n + p.emplazamientos, 0)}
                  donde={donde()}
                  reintentar={cargarCapa}
                  reintentarProvincias={reintentarProvincias}
                />
              }
              ubicacion={
                <>
                  <AvisosDeUbicacion panelAbierto={panelAbierto()} cobertura={resumen()} />
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
                            lectorDeRotulos={lectorDeRotulos()}
                            conFoto={foto.encendida()}
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
                <>
                  <ControlDelMapa
                    etiqueta="Foto aérea"
                    detalle="La ortofoto del IGN bajo las calles y los datos."
                    icono={<IconoFotoAerea />}
                    activo={foto.encendida()}
                    disabled={!listo()}
                    onClick={() => foto.alternar()}
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
              controlesSecundarios={
                <>
                  <Show when={ajustes.ajustes().modoEstudiante}>
                    <ControlDelMapa
                      etiqueta="Ejercicio"
                      detalle="Los cálculos de un municipio o un barrio paso a paso, con sus fuentes."
                      icono={<IconoEjercicio />}
                      activo={ejercicio() !== null}
                      onClick={() =>
                        navegar(conEjercicio(ubicacion(), ejercicio() === null ? "" : null))
                      }
                    />
                  </Show>
                  <ControlDelMapa
                    etiqueta="Tus aportaciones"
                    detalle="Tus medidas y correcciones, y compartirlas con Celda."
                    icono={<IconoAportaciones />}
                    aria-haspopup="dialog"
                    onClick={() => navegar(conAportaciones(ubicacion(), true))}
                  />
                  <ControlDelMapa
                    etiqueta="Ajustes"
                    detalle="Las preferencias de Celda en este dispositivo."
                    icono={<IconoAjustes />}
                    aria-haspopup="dialog"
                    onClick={() => navegar(conAjustes(ubicacion(), true))}
                  />
                </>
              }
              atribucion={
                <Atribucion
                  creditos={foto.encendida() ? [...creditos(), CREDITO_FOTO_AEREA] : creditos()}
                />
              }
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
                      zona={ejercicio() ?? ""}
                      resumen={resumen()}
                      provincias={provincias()}
                      emplazamientos={emplazamientos()}
                      alElegirZona={(codigo) =>
                        navegar(conEjercicio(ubicacion(), codigo), { reemplazar: true })
                      }
                      alPedirProvincias={pedirProvincias}
                      alReintentarProvincias={reintentarProvincias}
                      alEsperarPunto={(alTocar) => {
                        esperandoPunto = alTocar;
                      }}
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
            <Show when={aportacionesAbiertas(ubicacion())}>
              <DialogoAportaciones
                dispositivo={detectarDispositivo({ ...leerNavegador(), modelo: modelo() }).tipo}
                alCerrar={() => navegar(conAportaciones(ubicacion(), false), { reemplazar: true })}
                alElegirPunto={() => {
                  navegar(conAportaciones(ubicacion(), false), { reemplazar: true });
                  puntoDeReferencia.elegirEnMapa();
                }}
              />
            </Show>
            <Show when={ajustesAbiertos(ubicacion())}>
              <DialogoAjustes
                alCerrar={() => navegar(conAjustes(ubicacion(), false), { reemplazar: true })}
              />
            </Show>
          </FotoContexto>
        </ServicioContexto>
      </UbicacionContexto>
    </AjustesContexto>
  );
}

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
  /** Dónde los tiene (`dondeHayDatos`). */
  readonly donde: ReadonlyArray<string>;
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
          detalle={detalleDeMarca(marca(), props.emplazamientos, props.donde)}
        />
      </Match>
      <Match when={marca().tipo === "datos"}>
        <DatosDelMapa
          texto={<TextoConTerminos texto={textoMarcadoDe(marca())} />}
          detalle={detalleDeMarca(marca(), props.emplazamientos, props.donde)}
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

const detalleDeMarca = (
  marca: MarcaDeLaCapa,
  emplazamientos: number | undefined,
  donde: ReadonlyArray<string>,
): string => {
  if (marca.tipo === "sin-datos") {
    return marca.barridas.length === 0
      ? "Celda aún no ha barrido ninguna zona."
      : `Por ahora tiene los emplazamientos de ${enumerar(marca.barridas)}.`;
  }
  return marca.tipo === "datos"
    ? `${emplazamientos ?? 0} emplazamientos${donde.length === 0 ? "" : ` en ${enumerar(donde)}`} · capa ${marca.version}`
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

function AvisoMapa(props: {
  readonly estado: EstadoMapa;
  readonly callejero: Callejero;
  readonly reintentar: () => void;
}) {
  const reintentar = <Boton onClick={() => props.reintentar()}>Reintentar</Boton>;
  return (
    <Switch>
      <Match when={props.estado.tipo === "cargando"}>
        <Aviso tono="espera" titulo="Cargando el mapa base">
          {props.callejero === "reserva"
            ? "OpenFreeMap no responde: el callejero llega desde el IGN."
            : "El callejero llega desde OpenFreeMap."}
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
          {props.callejero === "reserva"
            ? "No ha llegado el callejero de OpenFreeMap ni el de reserva del IGN. Puede fallar la conexión o estar bloqueados los servidores."
            : "El callejero viene de los servidores de OpenFreeMap y no ha llegado. Puede fallar la conexión o estar bloqueado el servidor."}
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
