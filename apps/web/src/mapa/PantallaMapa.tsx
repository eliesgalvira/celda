import { type Coordenada, ESPANA, mismaCoordenada, type Rectangulo } from "@celda/dominio/area";
import { hayFiltro, papelDe, redesUsadas } from "@celda/dominio/filtro";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { Atribucion } from "@celda/ui/Atribucion.tsx";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { ControlDelMapa } from "@celda/ui/ControlDelMapa.tsx";
import { Cabecera } from "@celda/ui/Cabecera.tsx";
import { CargaDelMapa, DatosDelMapa } from "@celda/ui/DatosDelMapa.tsx";
import { DisposicionMapa } from "@celda/ui/DisposicionMapa.tsx";
import { IconoAportaciones } from "@celda/ui/buzon/Compartir.tsx";
import { IconoAjustes, IconoEjercicio } from "@celda/ui/ejercicio/Ejercicio.tsx";
import { IconoFotoAerea } from "@celda/ui/foto/FotoAerea.tsx";
import { IconoListaDeEmplazamientos, IconoVistaAgrupada } from "@celda/ui/puntos/Puntos.tsx";
import { ZOOM_FOTO } from "@celda/ui/mapa/foto.ts";
import { FUENTE_LINEA_AL_PUNTO } from "@celda/ui/mapa/lineaAlPunto.ts";
import { FUENTE_ZONA } from "@celda/ui/mapa/zona.ts";
import { pixelesDeAltura } from "@celda/ui/panel/hoja.ts";
import { IconoSenal } from "@celda/ui/medir/Medir.tsx";
import { IconoSiAlgoVaMal } from "@celda/ui/problemas/Problemas.tsx";
import { Pista } from "@celda/ui/Pista.tsx";
import { recurso, recursoFijo } from "@celda/ui/recurso.ts";
import { CONSULTA_DEL_OSCURO } from "@celda/ui/temaElegido.ts";
import { Termino, TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import { PinCentral } from "@celda/ui/ubicacion/MarcadorReferencia.tsx";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal, Match, Show, Switch, untrack } from "solid-js";

import {
  creditoDeBarrios,
  creditoDeCapitales,
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
import { nivelDeZoom } from "../capa/agrupacion.ts";
import {
  type EstadoProvincia,
  NIVEL_DE_PROVINCIAS,
  provinciasDeLaVista,
} from "../capa/nacional.ts";
import type { PuntosDelMapa } from "../capa/puntos.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";
import { enumerar } from "@celda/dominio/enumerar";
import { DialogoLista } from "../puntos/DialogoLista.tsx";
import { crearPuntosEnMapa, lienzoDePuntos } from "../puntos/enMapa.ts";
import {
  emplazamientoDelPunto,
  NIVEL_DE_PROVINCIAS_CON_PUNTOS,
  posicionDePunto,
  provinciaDePunto,
  queHacerAlTocar,
  ZOOM_DE_LOGOS,
} from "../puntos/puntos.ts";
import {
  DETALLE_LISTA,
  DETALLE_VISTA_AGRUPADA,
  LISTA_DE_EMPLAZAMIENTOS,
  VISTA_AGRUPADA,
} from "../puntos/textos.ts";
import { AjustesContexto, crearAjustes } from "../ajustes/ajustes.ts";
import { DialogoAjustes } from "../ajustes/DialogoAjustes.tsx";
import { almacenDelNavegador, crearTema, repintarConElTema } from "../ajustes/tema.ts";
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
import { crearFiltro } from "../filtro/enMapa.ts";
import { AvisoDelFiltro, ControlDeCompanias } from "../filtro/Filtro.tsx";
import {
  crearFoto,
  FotoContexto,
  lienzoDeFoto,
  PISTA_ACERCATE,
  PISTA_SIN_CONTORNO,
} from "../foto/enMapa.ts";
import { aPieDeCalle, CREDITO_FOTO_AEREA, pideVerFoto } from "../foto/foto.ts";
import { PanelFicha } from "../ficha/PanelFicha.tsx";
import { type FichaPedida, FichasPublicadas } from "../ficha/servicio.ts";
import {
  conDialogo,
  conEjercicio,
  conEmplazamiento,
  dialogoAbierto,
  ejercicioDe,
  emplazamientoDe,
  navegar,
  provinciaDe,
  ruta,
  ubicacion,
} from "../lib/rutas.ts";
import { DialogoMedir } from "../medir/DialogoMedir.tsx";
import { DialogoSiAlgoVaMal } from "../problemas/DialogoSiAlgoVaMal.tsx";
import { detectarDispositivo } from "../medir/dispositivo.ts";
import { leerModelo, leerNavegador } from "../medir/navegador.ts";
import { crearUbicacion, UbicacionContexto } from "../ubicacion/controlador.ts";
import { posicionDe } from "../ubicacion/estado.ts";
import { lineaAlPunto } from "../ubicacion/lineaAlPunto.ts";
import { ReferenciaEnMapa } from "../ubicacion/ReferenciaEnMapa.tsx";
import {
  AvisosDeUbicacion,
  EleccionConBuscador,
  MenuDeUbicacion,
  PasoPrevio,
} from "../ubicacion/Ubicacion.tsx";
import { type Callejero, esperarDeVerdad } from "./callejero.ts";
import {
  CREDITO_DE_MARCAS,
  CREDITO_DEL_LOGO_DE_DIGI,
  CREDITOS_MAPA_BASE,
  CREDITOS_RESERVA,
  type EstadoMapa,
  hayWebgl,
  type MotivoFallo,
} from "./estado.ts";
import type { LectorDeRotulos } from "./rotulosDeCiudad.ts";
import { cuentaDelSitio, textoDeCuenta } from "./cuenta.ts";
import { type CargasDeZonas, crearLugares } from "./lugar.ts";
import { Marcadores } from "./Marcadores.tsx";
import { vistaDe } from "./vista.ts";
import {
  crearVistaInicial,
  type Pantalla,
  provinciaDelPunto,
  rellenoDeLaVista,
  zoomParaEncuadrar,
} from "./vistaInicial.ts";

type ModuloMapaBase = typeof import("./mapaBase.ts");

/** De dónde salen las provincias y sus contornos para saber dónde cae un punto. */
const CARGAS_DE_ZONAS: CargasDeZonas = {
  provincias: cargarProvinciasDeZonas,
  contornos: cargarContornos,
};

/** El ancho a partir del cual el panel va a la izquierda y el punto se elige con un clic. */
const ESCRITORIO = "(min-width: 48rem)";

/** El tamaño de la ventana, que el mapa ocupa entera. */
const pantalla = (): Pantalla => ({ ancho: window.innerWidth, alto: window.innerHeight });

/**
 * El mapa de España a pantalla completa con los emplazamientos de la capa vigente, provincia a
 * provincia (ADR 0016), la fecha de sus datos y un aviso claro si algo no carga o no está.
 */
export function PantallaMapa() {
  const datos = usarDatos();
  const puntoDeReferencia = crearUbicacion(datos);
  const ajustes = crearAjustes(datos);
  const tema = crearTema(document, almacenDelNavegador());
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
   * El mapa, en cuanto pinta la silueta de España. Los marcadores solo necesitan su proyección y
   * salen ya, sobre la silueta y los límites, sin esperar a las teselas del callejero.
   */
  const [mapaCreado, setMapaCreado] = createSignal<MapaMapLibre>();
  /** El lector de los rótulos de ciudad, que llega con el código del mapa (ADR 0024). */
  const [lectorDeRotulos, setLectorDeRotulos] = createSignal<LectorDeRotulos>();
  const listo = createMemo(() => estado().tipo === "listo");
  /** Si el mapa está a pie de calle, donde la pista ofrece la foto aérea. */
  const [calle, setCalle] = createSignal(false);
  /** Si el mapa está al zoom de la foto aérea o más cerca. */
  const [cercaDeLaFoto, setCercaDeLaFoto] = createSignal(false);
  /** Lo que se ve del mapa, puesto cada vez que se para: el centro dice el lugar de la cabecera. */
  const [vistaDelEncuadre, setVistaDelEncuadre] = createSignal<Vista>();
  let contenedor: HTMLDivElement | undefined;
  let mapa: MapaMapLibre | undefined;
  /** Repinta el mapa con los colores del tema activo (`crearMapaBase`). */
  let repintarMapa: (() => void) | undefined;
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

  /**
   * La vista que ha elegido la persona (ADR 0028): la de puntos o la agrupada, guardada en el
   * dispositivo. `undefined` mientras se leen los ajustes: hasta saberla no se pide ni se dibuja
   * nada que dependa de ella.
   */
  const vistaElegida = createMemo(() =>
    ajustes.leidos()
      ? ajustes.ajustes().vistaAgrupada === true
        ? "agrupada"
        : "puntos"
      : undefined,
  );
  /** Los puntos de toda España: se piden la primera vez que hace falta la vista de puntos. */
  const [puntos, setPuntos] = createSignal<
    | { readonly tipo: "cargando" }
    | { readonly tipo: "lista"; readonly puntos: PuntosDelMapa }
    | { readonly tipo: "fallo" }
  >();
  /** Para volver a pedirlos con «Reintentar»: cada intento es otra clave. */
  const [intentoDePuntos, setIntentoDePuntos] = createSignal(0);
  /**
   * La vista que dibuja el mapa: la elegida o, si los puntos no han llegado, la agrupada, que no
   * los necesita. Mientras llegan, la de puntos sin puntos: la marca de agua dice que carga.
   */
  const vistaDibujada = createMemo(() =>
    vistaElegida() === "puntos" && puntos()?.tipo === "fallo" ? "agrupada" : vistaElegida(),
  );
  /** Los puntos, si han llegado. */
  const puntosListos = createMemo(() => {
    const actual = puntos();
    return actual?.tipo === "lista" ? actual.puntos : undefined;
  });
  /** Desde qué nivel se piden las provincias de lo que se ve: con puntos, solo cerca de los logos. */
  const nivelDePedir = () =>
    vistaDibujada() === "agrupada" ? NIVEL_DE_PROVINCIAS : NIVEL_DE_PROVINCIAS_CON_PUNTOS;

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
  /** Si la página se abrió sin un emplazamiento en la dirección: con uno, el mapa empieza en él. */
  const sinEmplazamientoAlAbrir = untrack(() => emplazamientoDe(ubicacion()) === null);
  const vistaInicial = crearVistaInicial({
    activa: sinEmplazamientoAlAbrir,
    alAbrir: () => {
      const punto = puntoAlAbrir();
      return {
        punto,
        provinciaDelPunto:
          punto === null || punto === undefined
            ? null
            : provinciaDelPunto(lugares.dondeCae(punto), lugares.provincias()),
      };
    },
    mapa: mapaCreado,
    relleno: (caja) => rellenoDeLaVista(caja, pantalla(), escritorio()),
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
      const inicial = vistaInicial.alCrear() ?? ESPANA.encuadre;
      const { mapa: nuevo, repintar } = modulo.crearMapaBase(
        contenedor,
        { ...ESPANA, encuadre: inicial },
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
        rellenoDeLaVista(inicial, pantalla(), escritorio()),
        callejeroActual,
      );
      const mirarZoom = () => {
        setCalle(aPieDeCalle(nuevo.getZoom()));
        setCercaDeLaFoto(nuevo.getZoom() >= ZOOM_FOTO);
      };
      nuevo.on("zoom", mirarZoom);
      mirarZoom();
      const mirarEncuadre = () => setVistaDelEncuadre(vistaDe(nuevo));
      nuevo.on("moveend", mirarEncuadre);
      nuevo.once("load", mirarEncuadre);
      mapa = nuevo;
      repintarMapa = repintar;
      setLectorDeRotulos(() => modulo.LECTOR_DE_ROTULOS);
      // Los marcadores esperan a que se vea la silueta de España.
      modulo.trasLaSilueta(nuevo, () => {
        if (mapa === nuevo) setMapaCreado(nuevo);
      });
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
              pantalla(),
              rellenoDeLaVista(caja, pantalla(), escritorio()),
            ),
          };
    const vista = ultimaVista ?? inicial;
    if (vista !== undefined) {
      pedirProvincias(provinciasDeLaVista(resumenLeido, vista, nivelDePedir()));
    }
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
  // Con la silueta ya pintada, el estilo está cargado y se le pueden cambiar los colores.
  repintarConElTema(
    mapaCreado,
    tema.eleccion,
    () => repintarMapa?.(),
    () => window.matchMedia(CONSULTA_DEL_OSCURO),
  );
  recursoFijo("pantalla:escritorio", () => {
    const pantalla = window.matchMedia(ESCRITORIO);
    const medir = () => setEscritorio(pantalla.matches);
    pantalla.addEventListener("change", medir);
    return () => pantalla.removeEventListener("change", medir);
  });

  /** Quien espera el siguiente punto que se toque en el mapa: el ejercicio al elegir su zona. */
  let esperandoPunto: ((punto: Coordenada) => void) | undefined;
  /** Lo que hace un toque en el mapa que no es de nadie más: tocar los puntos (más abajo). */
  let alTocarElMapa: ((pixel: { readonly x: number; readonly y: number }) => void) | undefined;

  // En escritorio, mientras se elige un punto, un clic en el mapa lo marca (historia 26). Si el
  // ejercicio espera un punto para elegir su zona, el clic es suyo, también en el móvil. Si no,
  // es de los puntos.
  recurso(
    "mapa:clic",
    () => mapaListo(),
    (actual) => {
      const alClic = (evento: {
        readonly lngLat: { readonly lng: number; readonly lat: number };
        readonly point: { readonly x: number; readonly y: number };
      }) => {
        if (esperandoPunto !== undefined) {
          esperandoPunto({ longitud: evento.lngLat.lng, latitud: evento.lngLat.lat });
          return;
        }
        if (eligiendo()) {
          if (escritorio()) {
            puntoDeReferencia.elegir(
              { longitud: evento.lngLat.lng, latitud: evento.lngLat.lat },
              "mapa",
            );
          }
          return;
        }
        alTocarElMapa?.(evento.point);
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
  /** Las compañías que enseña el mapa, guardadas en el dispositivo (ADR 0026). */
  const filtro = crearFiltro(datos, {
    guardado: ajustes.filtro,
    guardar: ajustes.cambiarFiltro,
    cargadas,
  });
  /**
   * Los créditos del mapa base y, con el resumen, el de los límites de municipios y el de las
   * capitales, si el resumen las cita. El de los límites de barrio, solo con una provincia con
   * barrios cargada: la de Barcelona.
   */
  const conBarrios = createMemo(() => cargadas().some((p) => p.capa.barrios.length > 0));
  /**
   * Los logos de las compañías salen con la primera provincia que llega. Con ellos va el aviso de
   * que las marcas son de sus titulares y, si alguna provincia tiene emplazamientos de DIGI, la
   * cita de su logotipo que piden sus condiciones.
   */
  const conLogos = createMemo(() => emplazamientos().length > 0);
  const conDigi = createMemo(() => emplazamientos().some((e) => e.companias.includes("digi")));
  const creditos = createMemo(() => {
    const fuentes = resumen()?.fuentes;
    const delCallejero = callejero() === "reserva" ? CREDITOS_RESERVA : CREDITOS_MAPA_BASE;
    const deLosLogos = [
      ...(conLogos() ? [CREDITO_DE_MARCAS] : []),
      ...(conDigi() ? [CREDITO_DEL_LOGO_DE_DIGI] : []),
    ];
    return fuentes === undefined
      ? [...delCallejero, ...deLosLogos]
      : [
          ...delCallejero,
          creditoDeMunicipios(fuentes.municipios),
          ...(fuentes.capitales === undefined ? [] : [creditoDeCapitales(fuentes.capitales)]),
          ...(conBarrios() ? [creditoDeBarrios(fuentes.barrios)] : []),
          ...deLosLogos,
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
      return actual === undefined ? undefined : lienzoDeFoto(actual, esperarDeVerdad);
    }),
    seleccionada,
    deCerca: cercaDeLaFoto,
    desplazamiento: () => centroLibre(escritorio()),
    esperar: esperarDeVerdad,
  });

  // Un enlace sin provincia, o uno cuya provincia ya ha llegado sin su clave: se busca en el índice
  // de claves del resumen. Si está, la dirección pasa a llevar su provincia y la clave de hoy, que
  // es otra si el emplazamiento se juntó con otro, y se pide su provincia. Si no está, la ficha
  // dice que no existe.
  recurso(
    "capa:clave",
    () => {
      const clave = seleccionada();
      if (clave === null || resumen() === undefined) return undefined;
      const codigo = provinciaSeleccionada();
      if (codigo === null) return clave;
      const suya = provincias().get(codigo);
      return suya?.tipo === "lista" &&
        !suya.provincia.capa.emplazamientos.some((e) => e.clave === clave)
        ? clave
        : undefined;
    },
    (clave) => {
      const parar = new AbortController();
      void datos
        .runPromiseExit(
          Effect.flatMap(CapaEmplazamientos, (servicio) => servicio.situarClave(clave)),
          { signal: parar.signal },
        )
        .then((salida) => {
          if (parar.signal.aborted || !Exit.isSuccess(salida)) return;
          const situado = Option.getOrUndefined(salida.value);
          if (situado === undefined || emplazamientoDe(ubicacion()) !== clave) return;
          if (situado.clave === clave && situado.provincia === provinciaDe(ubicacion())) return;
          pedirProvincias([situado.provincia]);
          navegar(conEmplazamiento(ubicacion(), situado), { reemplazar: true });
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

  // ── La vista de puntos (ADR 0028) ─────────────────────────────────────────────────────────────

  // Los puntos se piden una vez, con la vista de puntos y el resumen, que dice su fichero. Lo que
  // está en marcha se termina aunque se cambie de vista: vale para la siguiente vez.
  let puntosPedidos: number | undefined;
  recurso(
    "capa:puntos",
    () => (vistaElegida() === "puntos" && resumen() !== undefined ? intentoDePuntos() : undefined),
    (intento) => {
      if (puntosPedidos === intento) return undefined;
      puntosPedidos = intento;
      setPuntos({ tipo: "cargando" });
      void datos
        .runPromiseExit(Effect.flatMap(CapaEmplazamientos, (servicio) => servicio.puntos))
        .then((salida) => {
          setPuntos(
            Exit.isSuccess(salida) ? { tipo: "lista", puntos: salida.value } : { tipo: "fallo" },
          );
        });
      return undefined;
    },
  );

  // Al cambiar de vista, se piden las provincias que esa vista dibuja en lo que se ve.
  createEffect(vistaDibujada, () => untrack(pedirLoQueSeVe));

  /**
   * Si se dibujan los marcadores: siempre con la vista agrupada y, con la de puntos, desde el zoom
   * de los logos y con todas las provincias que se ven ya agrupadas (con el filtro, si lo hay). Los
   * puntos se apagan a la vez, con su fundido, y los logos entran con el suyo: nunca hay unos
   * encima de los otros, ni un hueco sin ninguno.
   */
  const conMarcadores = createMemo(() => {
    const vista = vistaDibujada();
    if (vista === "agrupada") return true;
    if (vista === undefined || puntosListos() === undefined) return false;
    const actual = vistaDelMapa();
    const leido = resumen();
    if (actual === undefined || leido === undefined) return false;
    if (nivelDeZoom(actual.zoom) < ZOOM_DE_LOGOS) return false;
    const conFiltro = hayFiltro(filtro.aplicado());
    const agrupaciones = filtro.agrupaciones();
    return provinciasDeLaVista(leido, actual, ZOOM_DE_LOGOS).every((codigo) =>
      conFiltro ? agrupaciones.has(codigo) : provincias().get(codigo)?.tipo === "lista",
    );
  });

  /**
   * El emplazamiento que se acaba de tocar o elegir en la lista, mientras llega la capa de su
   * provincia: de ella sale su clave, que abre su ficha. El anillo ya lo marca.
   */
  const [pendiente, setPendiente] = createSignal<{
    readonly provincia: string;
    readonly posicion: Coordenada;
  }>();
  /** Abre la ficha de un punto: pide su provincia y, cuando llega, la abre. */
  const abrirPunto = (indice: number) => {
    const actuales = puntosListos();
    if (actuales === undefined) return;
    const provincia = provinciaDePunto(actuales.puntos, indice);
    setPendiente({ provincia, posicion: posicionDePunto(actuales.puntos, indice) });
    if (provincias().get(provincia)?.tipo === "fallo") reintentarProvincias([provincia]);
    else pedirProvincias([provincia]);
  };
  createEffect(
    () => {
      const actual = pendiente();
      if (actual === undefined) return undefined;
      const estado = provincias().get(actual.provincia);
      if (estado === undefined || estado.tipo === "cargando") return undefined;
      return {
        provincia: actual.provincia,
        clave:
          estado.tipo === "lista"
            ? emplazamientoDelPunto(estado.provincia.capa.emplazamientos, actual.posicion)?.clave
            : undefined,
      };
    },
    (resuelto) => {
      if (resuelto === undefined) return;
      setPendiente(undefined);
      // Si su provincia no llega, la marca de agua lo dice con un reintento.
      if (resuelto.clave !== undefined) seleccionar(resuelto.clave, resuelto.provincia);
    },
  );

  /**
   * Si los puntos del mapa están apagados porque se ven los logos. Lo dicen los marcadores, que
   * los apagan al salir y los vuelven a encender cuando los puntos que se mueven llegan a su sitio.
   */
  const [puntosApagados, setPuntosApagados] = createSignal(false);
  /** Si los puntos del mapa están tapados por los que vuelan al cambiar de vista. */
  const [puntosTapados, setPuntosTapados] = createSignal(false);

  crearPuntosEnMapa({
    lienzo: createMemo(() => {
      const actual = mapaCreado();
      return actual === undefined ? undefined : lienzoDePuntos(actual);
    }),
    puntos: puntosListos,
    visibles: () => vistaDibujada() === "puntos" && !puntosTapados(),
    apagados: puntosApagados,
    filtro: filtro.aplicado,
    elegido: () => pendiente()?.posicion ?? posicionSeleccionada(),
  });

  // Un toque en el mapa, con la vista de puntos y los puntos a la vista: acerca o abre una ficha.
  alTocarElMapa = (pixel) => {
    if (mapa === undefined || vistaDibujada() !== "puntos" || conMarcadores()) return;
    const actuales = puntosListos();
    if (actuales === undefined) return;
    const zoom = mapa.getZoom();
    const decision = queHacerAlTocar(zoom, lienzoDePuntos(mapa).tocados(pixel));
    if (decision.tipo === "acercar") {
      vistaInicial.yaColocado();
      mapa.easeTo({ center: mapa.unproject([pixel.x, pixel.y]), zoom: decision.zoom });
    } else if (decision.tipo === "abrir") {
      abrirPunto(decision.indice);
    }
  };

  /** Cuántos emplazamientos tiene el sitio que se mira, para la cabecera. */
  const cuenta = createMemo(() => {
    const leido = resumen();
    if (leido === undefined) return undefined;
    const suya = cuentaDelSitio(lugares.sitio(), {
      resumen: leido,
      puntos: puntosListos()?.puntos,
      provincias: provincias(),
      filtro: filtro.aplicado(),
    });
    return suya === undefined ? undefined : textoDeCuenta(suya);
  });

  // La línea del emplazamiento seleccionado al punto de referencia sigue al punto mientras se mueve.
  createEffect(
    () => ({
      actual: mapaListo(),
      linea: lineaAlPunto(posicionSeleccionada(), posicionDeReferencia()),
    }),
    ({ actual, linea }) => {
      actual?.getSource<GeoJSONSource>(FUENTE_LINEA_AL_PUNTO)?.setData(linea);
    },
  );
  /** Con un emplazamiento seleccionado a pie de calle, la pista ofrece la foto aérea. */
  const conPistaDeFoto = createMemo(() =>
    pideVerFoto({
      encendida: foto.encendida(),
      seleccionado: seleccionada() !== null,
      aPieDeCalle: calle(),
    }),
  );
  const pista = createMemo(() => {
    // Si «Ver el edificio» no encuentra nada que resaltar, la pista lo dice un rato, porque sorprende.
    if (foto.sinContorno()) return <Pista texto={PISTA_SIN_CONTORNO} />;
    if (foto.acercate()) return <Pista texto={PISTA_ACERCATE} />;
    if (!conPistaDeFoto()) return undefined;
    return (
      <Pista
        accion={
          <Boton variante="secundario" onClick={() => foto.encender()}>
            Ver la foto aérea
          </Boton>
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
  // después, abrir o cerrar la ficha no mueve el mapa (historia 22). Sin emplazamiento al abrir no
  // hay nada que enfocar: la primera ficha que se abre después tampoco salta a pie de calle.
  let enfocadoAlCargar = sinEmplazamientoAlAbrir;
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

  /**
   * Con un filtro, de lejos, y un resumen publicado antes de las combinaciones de compañías: los
   * hexágonos de las provincias aún cuentan todas, y el aviso del filtro lo dice.
   */
  const deLejosSinFiltrar = createMemo(
    () =>
      hayFiltro(filtro.aplicado()) &&
      Math.floor(vistaDelMapa()?.zoom ?? 0) < NIVEL_DE_PROVINCIAS &&
      (resumen()?.provincias.some((p) => p.combinaciones === undefined) ?? false),
  );
  /**
   * Si el emplazamiento seleccionado sale por la red que usa una compañía del filtro, cuál: la
   * ficha lo explica (ADR 0026).
   */
  const redUsadaDeLaSeleccionada = createMemo(() => {
    const clave = seleccionada();
    const actual = filtro.aplicado();
    const suyo = clave === null ? undefined : emplazamientos().find((e) => e.clave === clave);
    if (suyo === undefined || papelDe(suyo.companias, actual) !== "red-usada") return [];
    return redesUsadas(actual).filter((r) => suyo.companias.includes(r.red));
  });

  /**
   * El barrio de Barcelona del emplazamiento seleccionado, si la capa de su provincia ha llegado
   * y lo sabe: la ficha lo pone delante del municipio (#13).
   */
  const barrioDeLaSeleccionada = createMemo(() => {
    const clave = seleccionada();
    if (clave === null) return undefined;
    for (const { capa } of cargadas()) {
      const suyo = capa.emplazamientos.find((e) => e.clave === clave);
      if (suyo === undefined) continue;
      return suyo.barrio === null
        ? undefined
        : capa.barrios.find((b) => b.codigo === suyo.barrio)?.nombre;
    }
    return undefined;
  });

  /** Solo los fallos van en el centro. Mientras carga, la silueta y `CargaDelMapa` bastan. */
  const aviso = createMemo(() => {
    const actual = estado();
    return actual.tipo === "fallo" ? (
      <AvisoMapa motivo={actual.motivo} callejero={callejero()} reintentar={arrancar} />
    ) : undefined;
  });

  return (
    <AjustesContexto value={ajustes}>
      <UbicacionContexto value={puntoDeReferencia}>
        <FotoContexto value={foto}>
          <DisposicionMapa
            nombre={`Mapa de ${ESPANA.nombre}`}
            // Ocupado también mientras la vista inicial pueda mover el mapa: quien lo use desde
            // fuera, como `tools/rendimiento`, espera a eso antes de mover la cámara (#81).
            ocupado={
              estado().tipo === "cargando" ||
              capa().tipo === "cargando" ||
              (estado().tipo === "listo" && vistaInicial.pendiente())
            }
            lienzo={(elemento) => {
              contenedor = elemento;
            }}
            cabecera={<Cabecera lugar={lugares.nombre()} cuenta={cuenta()} />}
            datos={
              <EstadoDeLaCapa
                estado={capa()}
                vista={estadoVista()}
                emplazamientos={resumen()?.provincias.reduce((n, p) => n + p.emplazamientos, 0)}
                donde={donde()}
                puntos={vistaElegida() === "puntos" ? puntos()?.tipo : undefined}
                reintentarPuntos={() => setIntentoDePuntos((n) => n + 1)}
                reintentar={cargarCapa}
                reintentarProvincias={reintentarProvincias}
              />
            }
            carga={
              estado().tipo === "cargando" ? <CargaDelMapa texto="Cargando el mapa…" /> : undefined
            }
            filtro={
              <AvisoDelFiltro
                filtro={filtro.aplicado()}
                deLejosSinFiltrar={deLejosSinFiltrar()}
                alQuitar={() => filtro.elegir([])}
              />
            }
            ubicacion={
              <>
                <AvisosDeUbicacion panelAbierto={panelAbierto()} cobertura={resumen()} />
                <Show when={eligiendo()}>
                  <EleccionConBuscador
                    alUsarCentro={usarCentro}
                    alIrA={irA}
                    encuadre={vistaDelEncuadre()?.caja}
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
                          filtro={filtro.aplicado()}
                          agrupaciones={filtro.agrupaciones()}
                          seleccionada={seleccionada()}
                          alSeleccionar={seleccionar}
                          alVer={precargarFichas}
                          alCambiarVista={alCambiarVista}
                          lectorDeRotulos={lectorDeRotulos()}
                          conFoto={foto.seVe()}
                          conMarcadores={conMarcadores()}
                          vista={vistaDibujada()}
                          puntos={puntosListos()?.puntos}
                          alApagarPuntos={setPuntosApagados}
                          alTaparPuntos={setPuntosTapados}
                        />
                      )}
                    </Show>
                    <ReferenciaEnMapa
                      mapa={actual()}
                      escritorio={escritorio()}
                      emplazamiento={posicionSeleccionada()}
                    />
                  </>
                )}
              </Show>
            }
            pista={pista()}
            zoom={
              <>
                {/* Como los controles de MapLibre, llevan el evento de la pulsación: son un
                  gesto de la persona, no un vuelo, y no apagan la foto aérea (#67). */}
                <ControlDelMapa
                  etiqueta="Acercar"
                  icono="+"
                  disabled={!listo()}
                  onClick={(evento) => mapa?.zoomIn(undefined, { originalEvent: evento })}
                />
                <ControlDelMapa
                  etiqueta="Alejar"
                  icono="−"
                  disabled={!listo()}
                  onClick={(evento) => mapa?.zoomOut(undefined, { originalEvent: evento })}
                />
              </>
            }
            controles={
              <>
                <Show when={vistaDibujada() === "puntos"}>
                  <ControlDelMapa
                    etiqueta={LISTA_DE_EMPLAZAMIENTOS}
                    detalle={DETALLE_LISTA}
                    icono={<IconoListaDeEmplazamientos />}
                    aria-haspopup="dialog"
                    disabled={puntosListos() === undefined}
                    onClick={() => navegar(conDialogo(ubicacion(), "lista", true))}
                  />
                </Show>
                <ControlDelMapa
                  etiqueta={VISTA_AGRUPADA}
                  detalle={DETALLE_VISTA_AGRUPADA}
                  icono={<IconoVistaAgrupada />}
                  activo={vistaElegida() === "agrupada"}
                  disabled={vistaElegida() === undefined}
                  onClick={() => {
                    const agrupada = vistaElegida() !== "agrupada";
                    // Al volver a los puntos de lejos, vuelan desde sus hexágonos: los del mapa no
                    // se ven hasta que llegan (ver `Marcadores`).
                    if (!agrupada && (mapa?.getZoom() ?? ZOOM_DE_LOGOS) < ZOOM_DE_LOGOS) {
                      setPuntosTapados(true);
                    }
                    ajustes.cambiarVistaAgrupada(agrupada);
                  }}
                />
                <ControlDelMapa
                  etiqueta="Medir mi señal"
                  detalle="Cómo verla en el móvil."
                  icono={<IconoSenal />}
                  aria-haspopup="dialog"
                  onClick={() => navegar(conDialogo(ubicacion(), "medir", true))}
                />
                <ControlDelMapa
                  etiqueta="Si algo va mal"
                  detalle="A quién acudir en cada problema."
                  icono={<IconoSiAlgoVaMal />}
                  aria-haspopup="dialog"
                  onClick={() => navegar(conDialogo(ubicacion(), "si-algo-va-mal", true))}
                />
              </>
            }
            botonUbicacion={
              <>
                <ControlDeCompanias
                  filtro={filtro.elegido()}
                  disabled={resumen() === undefined}
                  alElegir={filtro.elegir}
                />
                <ControlDelMapa
                  etiqueta="Foto aérea"
                  icono={<IconoFotoAerea />}
                  activo={foto.encendida()}
                  disabled={!listo()}
                  aria-disabled={cercaDeLaFoto() ? undefined : "true"}
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
                    detalle="Los datos de un municipio o un barrio, paso a paso."
                    icono={<IconoEjercicio />}
                    activo={ejercicio() !== null}
                    onClick={() =>
                      navegar(conEjercicio(ubicacion(), ejercicio() === null ? "" : null))
                    }
                  />
                </Show>
                <ControlDelMapa
                  etiqueta="Tus aportaciones"
                  detalle="Para enviar tus medidas y correcciones."
                  icono={<IconoAportaciones />}
                  aria-haspopup="dialog"
                  onClick={() => navegar(conDialogo(ubicacion(), "aportaciones", true))}
                />
                <ControlDelMapa
                  etiqueta="Ajustes"
                  icono={<IconoAjustes />}
                  aria-haspopup="dialog"
                  onClick={() => navegar(conDialogo(ubicacion(), "ajustes", true))}
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
            panel={
              <Switch>
                <Match when={seleccionada()}>
                  {(clave) => (
                    <PanelFicha
                      clave={clave()}
                      provincia={provinciaSeleccionada()}
                      fechaCapa={fechaDeLaSeleccionada()}
                      redUsada={redUsadaDeLaSeleccionada()}
                      barrio={barrioDeLaSeleccionada()}
                      alCerrar={() => navegar(ruta.mapa)}
                      alAbrirSiAlgoVaMal={() =>
                        navegar(conDialogo(ubicacion(), "si-algo-va-mal", true))
                      }
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
          <Show when={dialogoAbierto(ubicacion(), "si-algo-va-mal")}>
            <DialogoSiAlgoVaMal
              alCerrar={() =>
                navegar(conDialogo(ubicacion(), "si-algo-va-mal", false), { reemplazar: true })
              }
              alMedir={() => navegar(conDialogo(ubicacion(), "medir", true))}
            />
          </Show>
          <Show when={dialogoAbierto(ubicacion(), "medir")}>
            <DialogoMedir
              navegador={{ ...leerNavegador(), modelo: modelo() }}
              direccionMovil={new URL(ruta.medir, window.location.origin).href}
              alCerrar={() =>
                navegar(conDialogo(ubicacion(), "medir", false), { reemplazar: true })
              }
            />
          </Show>
          <Show when={dialogoAbierto(ubicacion(), "aportaciones")}>
            <DialogoAportaciones
              dispositivo={detectarDispositivo({ ...leerNavegador(), modelo: modelo() }).tipo}
              alCerrar={() =>
                navegar(conDialogo(ubicacion(), "aportaciones", false), { reemplazar: true })
              }
              alElegirPunto={() => {
                navegar(conDialogo(ubicacion(), "aportaciones", false), { reemplazar: true });
                puntoDeReferencia.elegirEnMapa();
              }}
            />
          </Show>
          <Show when={dialogoAbierto(ubicacion(), "lista") ? puntosListos() : undefined}>
            {(actuales) => (
              <DialogoLista
                puntos={actuales().puntos}
                caja={vistaDelEncuadre()?.caja}
                filtro={filtro.aplicado()}
                alElegir={(indice) => {
                  navegar(conDialogo(ubicacion(), "lista", false), { reemplazar: true });
                  abrirPunto(indice);
                }}
                alCerrar={() =>
                  navegar(conDialogo(ubicacion(), "lista", false), { reemplazar: true })
                }
              />
            )}
          </Show>
          <Show when={dialogoAbierto(ubicacion(), "ajustes")}>
            <DialogoAjustes
              tema={tema}
              alCerrar={() =>
                navegar(conDialogo(ubicacion(), "ajustes", false), { reemplazar: true })
              }
            />
          </Show>
        </FotoContexto>
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
function EstadoDeLaCapa(props: {
  readonly estado: EstadoCapa;
  readonly vista: EstadoDeLaVista | undefined;
  /** Cuántos emplazamientos tiene el resumen. */
  readonly emplazamientos: number | undefined;
  /** Dónde los tiene (`dondeHayDatos`). */
  readonly donde: ReadonlyArray<string>;
  /** Cómo van los puntos de la vista de puntos, si se han pedido (ADR 0028). */
  readonly puntos?: "cargando" | "lista" | "fallo" | undefined;
  readonly reintentarPuntos?: () => void;
  readonly reintentar: () => void;
  readonly reintentarProvincias: (codigos: ReadonlyArray<string>) => void;
}) {
  // Todo sale de un solo memo que se lee en cada rama sin pasar por el valor de `Match`: al cambiar
  // de rama, la vieja puede volver a leer antes de desmontarse, y con el valor de `Match` eso es
  // una lectura caducada.
  const marca = createMemo(() => marcaDeLaCapa(props.estado, props.vista, props.puntos));
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
      <Match when={marca().tipo === "fallo-puntos"}>
        <Aviso
          tono="fallo"
          titulo="No han llegado los puntos"
          acciones={
            <Boton variante="secundario" onClick={() => props.reintentarPuntos?.()}>
              Reintentar
            </Boton>
          }
        >
          Puede que falle la conexión. Mientras, el mapa va agrupado.
        </Aviso>
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
          {EXPLICACION_FALLO_CAPA[motivo()]} El mapa sale sin marcadores aunque haya{" "}
          <Termino termino="emplazamiento">emplazamientos</Termino>.
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
          Puede que falle la conexión. De esa provincia solo se ve el total.
        </Aviso>
      </Match>
      <Match when={marca().tipo === "cargando-provincias"}>
        <DatosDelMapa tono="espera" texto={textoDeMarca(marca())} />
      </Match>
      <Match when={marca().tipo === "sin-datos"}>
        <DatosDelMapa
          tono="limite"
          texto="Celda aún no tiene datos de esta parte del mapa"
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
  | { readonly tipo: "fallo-puntos" }
  | { readonly tipo: "fallo"; readonly motivo: keyof typeof EXPLICACION_FALLO_CAPA }
  | {
      readonly tipo: "fallo-provincias";
      readonly provincias: ReadonlyArray<{ readonly codigo: string; readonly nombre: string }>;
    }
  | { readonly tipo: "cargando-provincias"; readonly nombres: ReadonlyArray<string> }
  | { readonly tipo: "sin-datos"; readonly barridas: ReadonlyArray<string> }
  | {
      readonly tipo: "datos";
      readonly fecha: number;
      readonly hasta: number;
      readonly barrido: number | null;
    };

const marcaDeLaCapa = (
  estado: EstadoCapa,
  vista: EstadoDeLaVista | undefined,
  puntos: "cargando" | "lista" | "fallo" | undefined,
): MarcaDeLaCapa => {
  if (estado.tipo !== "lista") return estado;
  // Con la vista de puntos, el mapa no enseña nada hasta que llegan.
  if (puntos === "cargando") return { tipo: "cargando" };
  if (puntos === "fallo") return { tipo: "fallo-puntos" };
  const { resumen } = estado;
  if (vista?.tipo === "fallo") return { tipo: "fallo-provincias", provincias: vista.provincias };
  if (vista?.tipo === "cargando") {
    return { tipo: "cargando-provincias", nombres: vista.provincias.map((p) => p.nombre) };
  }
  if (vista?.tipo === "sin-datos") return vista;
  return vista?.tipo === "datos"
    ? vista
    : {
        tipo: "datos",
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
    ? `${emplazamientos ?? 0} emplazamientos${donde.length === 0 ? "" : ` en ${enumerar(donde)}`}`
    : "";
};

const EXPLICACION_FALLO_CAPA = {
  "sin-publicar": "Celda todavía no ha publicado ningún emplazamiento.",
  "sin-origen": "Puede que falle la conexión o que el servidor esté bloqueado.",
  "sin-descarga": "Puede que falle la conexión o que el servidor esté bloqueado.",
  danada: "Es un fallo de Celda.",
  interno: "Es un fallo de Celda.",
} as const;

function AvisoMapa(props: {
  readonly motivo: MotivoFallo;
  readonly callejero: Callejero;
  readonly reintentar: () => void;
}) {
  const reintentar = <Boton onClick={() => props.reintentar()}>Reintentar</Boton>;
  return (
    <Switch>
      <Match when={props.motivo === "sin-webgl"}>
        <Aviso tono="fallo" titulo="Este navegador no puede dibujar el mapa">
          Hace falta WebGL. Prueba con otro navegador o activa la aceleración gráfica.
        </Aviso>
      </Match>
      <Match when={props.motivo === "sin-respuesta"}>
        <Aviso tono="fallo" titulo="No ha cargado el mapa base" acciones={reintentar}>
          {props.callejero === "reserva"
            ? "Tampoco ha cargado el de reserva del IGN. Puede que falle la conexión o que los servidores estén bloqueados."
            : "Puede que falle la conexión o que el servidor esté bloqueado."}
        </Aviso>
      </Match>
      <Match when={props.motivo === "interno"}>
        <Aviso tono="fallo" titulo="Algo ha fallado al preparar el mapa" acciones={reintentar}>
          Si se repite al reintentar, recarga la página.
        </Aviso>
      </Match>
    </Switch>
  );
}
