import type { Coordenada } from "@celda/dominio/area";
import { type FiltroDeCompanias, mascarasDeFiltro, SIN_FILTRO } from "@celda/dominio/filtro";
import type { PuntosLeidos } from "@celda/dominio/puntos";
import { habitantesDeRotulo, indiceDeCiudades } from "@celda/dominio/poblacionDeRotulos";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { type MapaConRotulos, quitarRotulosDeMunicipios } from "@celda/ui/mapa/estilo.ts";
import { FUENTE_HUECOS, puestaDeHuecos } from "@celda/ui/mapa/huecos.ts";
import { leerOklch } from "@celda/ui/mapa/color.ts";
import {
  CAPA_DE_PUNTOS,
  FUNDIDO_DE_PUNTOS_MS,
  opacidadDePunto,
  radioDePunto,
} from "@celda/ui/mapa/puntos.ts";
import { CAPA_DE_VUELO, capaDeVuelo } from "@celda/ui/mapa/vuelo.ts";
import { DURACION_MOVIMIENTO_MS, type Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import { CapaDeTraspaso, PuntoDeTraspaso } from "@celda/ui/puntos/Puntos.tsx";
import { CapaDeRotulos, RotuloDeCiudad } from "@celda/ui/marcadores/RotuloDeCiudad.tsx";
import { mismasListas, recurso, recursoFijo } from "@celda/ui/recurso.ts";
import type {
  CustomLayerInterface,
  GeoJSONSource,
  LngLatLike,
  Map as MapaMapLibre,
} from "maplibre-gl";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";

import {
  type Elemento,
  type ElementoAbrible,
  type Escena,
  nivelDeZoom,
} from "../capa/agrupacion.ts";
import { huecosDe, resolverChoques, type RotuloEnElMapa, tamanoDeNivel } from "../capa/choques.ts";
import { cajaConMargen, logosDe, type Vista } from "../capa/marcadores.ts";
import {
  type AgrupacionConFiltro,
  crearAgrupadorNacional,
  type EstadoProvincia,
  NIVEL_DE_PROVINCIAS,
} from "../capa/nacional.ts";
import type { FichaPedida } from "../ficha/servicio.ts";
import { PROVINCIA_DE_LOS_ENLACES_VIEJOS } from "../lib/rutas.ts";
import {
  CON,
  type EstadoDelTraspaso,
  type PuntoDelTraspaso,
  puntosDelTraspaso,
  SIN,
  siguienteTraspaso,
  type Traspaso,
} from "../capa/traspaso.ts";
import { ZOOM_DE_LOGOS } from "../puntos/puntos.ts";
import { posicionesDelVuelo } from "../puntos/vuelo.ts";
import { CapaAgrupada } from "./CapaAgrupada.tsx";
import type {
  LecturaDeRotulos,
  LectorDeRotulos,
  MapaConRotulosColocados,
  RotuloLeido,
  ZoomsDeCapa,
} from "./rotulosDeCiudad.ts";
import { type Lamina, type MapaQueSeMueve, seguirVista } from "./vista.ts";

const REDUCIR_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

/** Medio marcador, en píxeles: lo que asoma de uno cuyo punto está justo fuera de la pantalla. */
const MEDIO_MARCADOR = 30;

/** Hasta dónde acerca pulsar una provincia para verla entera: más cerca se ven sus calles. */
const ZOOM_MAXIMO_DE_PROVINCIA = 12;

/**
 * Lo que los marcadores usan del mapa de MapLibre: seguirlo, proyectar, sus contenedores, la capa
 * del vuelo al cambiar de vista, los huecos y los rótulos del mapa base, y acercar al abrir un
 * hexágono. `Map` lo cumple; las pruebas, con un doble.
 */
export interface MapaDeMarcadores extends MapaQueSeMueve, MapaConRotulos, MapaConRotulosColocados {
  readonly on: (evento: "move" | "moveend" | "idle", oyente: () => void) => void;
  readonly off: (evento: "move" | "moveend" | "idle", oyente: () => void) => void;
  readonly getContainer: () => HTMLElement;
  readonly getCanvasContainer: () => HTMLElement;
  readonly getCanvas: () => HTMLElement;
  readonly getLayer: (id: string) => ZoomsDeCapa | undefined;
  readonly getLayersOrder: () => Array<string>;
  readonly addLayer: (capa: CustomLayerInterface, antes?: string) => void;
  readonly removeLayer: (id: string) => void;
  readonly getSource: MapaMapLibre["getSource"];
  readonly isMoving: () => boolean;
  readonly getMaxZoom: () => number;
  readonly easeTo: (opciones: { readonly center: LngLatLike; readonly zoom: number }) => void;
  readonly cameraForBounds: (
    caja: [[number, number], [number, number]],
    opciones: { readonly padding: number; readonly maxZoom: number },
  ) => { readonly center?: LngLatLike | undefined; readonly zoom?: number | undefined } | undefined;
}

export interface MarcadoresProps {
  readonly mapa: MapaDeMarcadores;
  /** El resumen nacional: un hexágono por provincia, y qué provincias tienen capa. */
  readonly resumen: ResumenLeido;
  /** Cómo va cada provincia pedida. Las listas se agrupan aquí y se dibujan las de la vista. */
  readonly provincias: ReadonlyMap<string, EstadoProvincia>;
  /** Las compañías que se ven (ADR 0026). Sin él, todas. */
  readonly filtro?: FiltroDeCompanias;
  /**
   * Con un filtro, la agrupación de cada provincia lista: la del filtro o, mientras llega, la que
   * ya se veía (`crearAgrupadorNacional`).
   */
  readonly agrupaciones?: ReadonlyMap<string, AgrupacionConFiltro>;
  /** Clave del emplazamiento con la ficha abierta. */
  readonly seleccionada: string | null;
  /** Se ha pulsado el marcador de un emplazamiento (con el ratón, el dedo o el teclado). */
  readonly alSeleccionar: (clave: string, provincia: string) => void;
  /**
   * Los emplazamientos sueltos que se ven al decidir qué se dibuja: sus fichas se pueden abrir
   * con un toque, así que conviene tenerlas ya.
   */
  readonly alVer?: (pedidas: ReadonlyArray<FichaPedida>) => void;
  /** Cada vez que se decide qué se dibuja, la vista: con ella se piden las provincias. */
  readonly alCambiarVista?: (vista: Vista) => void;
  /**
   * Lee los rótulos de ciudad que MapLibre ha colocado, para dibujarlos encima de los marcadores
   * (ADR 0024). Llega con el código del mapa. Sin él, no se copia ningún rótulo.
   */
  readonly lectorDeRotulos?: LectorDeRotulos | undefined;
  /** Con la foto aérea encendida: los rótulos copiados van en blanco con halo oscuro. */
  readonly conFoto?: boolean;
  /**
   * Si se dibujan los marcadores. Con la vista de puntos, solo desde el zoom de los logos y con
   * las provincias que se ven ya agrupadas (ADR 0028); mientras, los puntos dibujan los
   * emplazamientos y aquí solo van los rótulos de ciudad. Sin él, siempre.
   */
  readonly conMarcadores?: boolean;
  /**
   * La vista que se dibuja (ADR 0028). Con la de puntos, al cruzar el zoom de los logos, cada logo
   * crece desde su punto y los puntos de una agrupación se deslizan a su hexágono, y al alejar al
   * revés. Al cambiar de una a otra de lejos, los puntos vuelan a sus hexágonos o salen de ellos.
   */
  readonly vista?: "puntos" | "agrupada" | undefined;
  /** Los puntos de toda España, si han llegado: los que vuelan al cambiar de vista. */
  readonly puntos?: PuntosLeidos | undefined;
  /** Mientras los puntos que vuelan tapan los del mapa, que no se ven. */
  readonly alTaparPuntos?: (tapados: boolean) => void;
  /**
   * Cuándo se apagan los puntos del mapa y cuándo vuelven: al salir los logos, y al alejar, cuando
   * los puntos que se mueven están llegando a su sitio.
   */
  readonly alApagarPuntos?: (apagados: boolean) => void;
}

/** El tamaño de un logo de un marcador, en píxeles: de él a un punto va la escala del paso. */
const LOGO_PX = 34;

const SIN_ROTULOS: LecturaDeRotulos = { zoom: 0, rotulos: [] };

/** Dos lecturas iguales: los mismos rótulos al mismo zoom. Así un `idle` sin cambios no cuesta. */
const mismaLectura = (a: LecturaDeRotulos, b: LecturaDeRotulos): boolean =>
  Math.abs(a.zoom - b.zoom) < 0.01 &&
  mismasListas(
    a.rotulos.map((r) => r.clave),
    b.rotulos.map((r) => r.clave),
  );

/**
 * Los emplazamientos sobre el mapa, agrupados por zoom: el resumen por provincias de lejos y, de
 * cerca, las provincias que han llegado (ADR 0016). Los marcadores y los rótulos copiados van en
 * dos láminas que siguen al mapa en cada fotograma; cada marcador solo se vuelve a colocar al
 * cambiar el zoom, y qué se dibuja se decide al asentarse el mapa (ver `seguirVista`): crear y
 * quitar nodos es lo caro.
 */
export function Marcadores(props: MarcadoresProps) {
  const filtro = () => props.filtro ?? SIN_FILTRO;
  const agrupador = createMemo(() =>
    crearAgrupadorNacional(props.resumen, props.provincias, {
      filtro: filtro(),
      agrupaciones: props.agrupaciones,
    }),
  );
  const logos = createMemo(() =>
    logosDe(
      [...props.provincias.values()].flatMap((estado) =>
        estado.tipo === "lista" ? estado.provincia.capa.emplazamientos : [],
      ),
      filtro(),
    ),
  );
  const [lamina, setLamina] = createSignal<Lamina>({ zoom: 0, salto: { x: 0, y: 0 } });
  /** El zoom al que se colocan los marcadores: no cambia mientras solo se mueve la lámina. */
  const zoomColocado = createMemo(() => lamina().zoom);
  const [vista, setVista] = createSignal<Vista>();
  const [reducido, setReducido] = createSignal(false);

  recurso(
    "marcadores:vista",
    () => props.mapa,
    (mapa) =>
      seguirVista(mapa, {
        lamina: setLamina,
        vista: (nueva) => {
          setVista(nueva);
          props.alCambiarVista?.(nueva);
        },
      }),
  );

  recursoFijo("marcadores:movimiento-reducido", () => {
    const preferencia = matchMedia(REDUCIR_MOVIMIENTO);
    const alCambiarPreferencia = () => setReducido(preferencia.matches);
    preferencia.addEventListener("change", alCambiarPreferencia);
    alCambiarPreferencia();
    return () => preferencia.removeEventListener("change", alCambiarPreferencia);
  });

  /** El vuelo de los puntos al cambiar de vista, mientras dura: hacia dónde y si ya llegan. */
  const [vuelo, setVuelo] = createSignal<{
    readonly hacia: "puntos" | "agrupada";
    readonly llegado: boolean;
  }>();

  const escena = createMemo(() => {
    const ahora = vista();
    if (ahora === undefined) return undefined;
    const enVuelo = vuelo();
    // Sin marcadores, una escena vacía: los que había se van con su transición. Mientras los
    // puntos vuelan hacia sus hexágonos, tampoco: salen cuando llegan.
    if (props.conMarcadores === false || (enVuelo?.hacia === "agrupada" && !enVuelo.llegado)) {
      return { nivel: nivelDeZoom(ahora.zoom), elementos: new Map<string, Elemento>() };
    }
    return agrupador().escena(
      nivelDeZoom(ahora.zoom),
      cajaConMargen(ahora.caja),
      // El seleccionado se ve siempre, aunque al alejar quede dentro de una agrupación.
      props.seleccionada,
    );
  });

  /**
   * Si hay marcadores, la última escena que los tenía y el último paso entre los puntos y los
   * marcadores: uno nuevo cada vez que, con la vista de puntos, salen o se van.
   */
  const estadoDelTraspaso = createMemo<EstadoDelTraspaso | undefined>((antes) =>
    siguienteTraspaso(antes, {
      vista: props.vista,
      con: props.conMarcadores !== false,
      escena: escena(),
    }),
  );

  // Funciones por mapa, que no leen props al llamarlas: se usan dentro de efectos.
  const proyectar = createMemo(() => {
    const mapa = props.mapa;
    return (posicion: Coordenada) => mapa.project([posicion.longitud, posicion.latitud]);
  });
  const seVe = createMemo(() => {
    const lienzo = props.mapa.getContainer();
    return (punto: Salto) =>
      punto.x > -MEDIO_MARCADOR &&
      punto.y > -MEDIO_MARCADOR &&
      punto.x < lienzo.clientWidth + MEDIO_MARCADOR &&
      punto.y < lienzo.clientHeight + MEDIO_MARCADOR;
  });
  /**
   * `proyectar` y `seVe` dentro de las láminas, que van desplazadas `salto`. Lo leen sin seguirlo:
   * un marcador nuevo se coloca donde está la lámina, y los demás no se recolocan al moverla.
   */
  const proyectarEnLamina = createMemo(() => {
    const enPantalla = proyectar();
    return (posicion: Coordenada) => {
      const punto = enPantalla(posicion);
      const { salto } = untrack(lamina);
      return { x: punto.x - salto.x, y: punto.y - salto.y };
    };
  });
  const seVeEnLamina = createMemo(() => {
    const enPantalla = seVe();
    return (punto: Salto) => {
      const { salto } = untrack(lamina);
      return enPantalla({ x: punto.x + salto.x, y: punto.y + salto.y });
    };
  });

  /** Los puntos que se mueven en el paso entre los puntos y los logos, mientras se mueven. */
  const [moviendose, setMoviendose] = createSignal<{
    readonly hacia: "logos" | "puntos";
    readonly puntos: ReadonlyArray<PuntoDelTraspaso>;
  }>();
  recurso(
    "marcadores:traspaso",
    () => estadoDelTraspaso()?.traspaso ?? (estadoDelTraspaso()?.con === false ? SIN : CON),
    (paso) => {
      const apagar = props.alApagarPuntos;
      if (paso.tipo !== "traspaso" || untrack(reducido)) {
        apagar?.(paso.tipo === "traspaso" ? paso.hacia === "logos" : paso.tipo === "con");
        setMoviendose(undefined);
        return undefined;
      }
      const enPantalla = untrack(proyectar);
      const seVeAhora = untrack(seVe);
      const puntos = puntosDelTraspaso(
        paso.marcadores,
        (elemento) => untrack(agrupador).emplazamientosDe(elemento),
        (posicion) => seVeAhora(enPantalla(posicion)),
      );
      setMoviendose({ hacia: paso.hacia, puntos });
      const relojes: Array<number> = [];
      if (paso.hacia === "logos") {
        apagar?.(true);
      } else {
        // Los puntos del mapa vuelven con su fundido cuando los que se mueven llegan a su sitio.
        relojes.push(
          window.setTimeout(() => apagar?.(false), DURACION_MOVIMIENTO_MS - FUNDIDO_DE_PUNTOS_MS),
        );
      }
      relojes.push(window.setTimeout(() => setMoviendose(undefined), DURACION_MOVIMIENTO_MS));
      return () => {
        for (const reloj of relojes) window.clearTimeout(reloj);
      };
    },
  );

  /** Cada cambio de vista, después de la primera que se sabe: el que hace volar los puntos. */
  const cambioDeVista = createMemo<{
    readonly vista: "puntos" | "agrupada" | undefined;
    readonly cambio: { readonly hacia: "puntos" | "agrupada" } | undefined;
  }>((antes) => {
    const actual = props.vista;
    return {
      vista: actual,
      cambio:
        antes?.vista !== undefined && actual !== undefined && antes.vista !== actual
          ? { hacia: actual }
          : antes?.cambio,
    };
  });
  // Al cambiar de vista de lejos, los puntos vuelan a sus hexágonos o salen de ellos, en una capa
  // propia de MapLibre (`capaDeVuelo`). Desde el zoom de los logos las dos vistas son iguales y
  // no vuela nada; con la preferencia de reducir movimiento, tampoco.
  recurso(
    "marcadores:vuelo",
    () => cambioDeVista().cambio,
    ({ hacia }) => {
      const mapa = props.mapa;
      const ahora = untrack(vista);
      const puntos = props.puntos;
      const zoom = mapa.getZoom();
      const escenaAgrupada =
        ahora === undefined
          ? undefined
          : hacia === "agrupada"
            ? untrack(agrupador).escena(
                nivelDeZoom(ahora.zoom),
                cajaConMargen(ahora.caja),
                props.seleccionada,
              )
            : untrack(estadoDelTraspaso)?.ultima;
      const color = leerOklch(
        getComputedStyle(document.documentElement).getPropertyValue("--mapa-punto"),
      );
      if (
        untrack(reducido) ||
        puntos === undefined ||
        ahora === undefined ||
        escenaAgrupada === undefined ||
        color === null ||
        nivelDeZoom(zoom) >= ZOOM_DE_LOGOS
      ) {
        setVuelo(undefined);
        props.alTaparPuntos?.(false);
        return undefined;
      }
      const posiciones = posicionesDelVuelo(
        puntos,
        escenaAgrupada,
        (elemento) => untrack(agrupador).emplazamientosDe(elemento),
        cajaConMargen(ahora.caja),
        mascarasDeFiltro(untrack(filtro)),
      );
      const juntan = hacia === "agrupada";
      const quitar = () => {
        if (mapa.getLayer(CAPA_DE_VUELO) !== undefined) mapa.removeLayer(CAPA_DE_VUELO);
      };
      quitar();
      setVuelo({ hacia, llegado: false });
      if (!juntan) props.alTaparPuntos?.(true);
      const orden = mapa.getLayersOrder();
      mapa.addLayer(
        capaDeVuelo({
          desde: juntan ? posiciones.desde : posiciones.hasta,
          hasta: juntan ? posiciones.hasta : posiciones.desde,
          color,
          opacidad: opacidadDePunto(zoom),
          diametro: 2 * radioDePunto(zoom),
          sentido: juntan ? "junta" : "separa",
          // Al llegar, los puntos del mapa salen ya en el mismo sitio: no hace falta fundido.
          fundidoMs: 0,
          alLlegar: () => {
            setVuelo({ hacia, llegado: true });
            if (!juntan) props.alTaparPuntos?.(false);
          },
          alAcabar: quitar,
        }),
        // Justo encima de los puntos, bajo los rótulos.
        orden[orden.indexOf(CAPA_DE_PUNTOS) + 1],
      );
      return quitar;
    },
  );

  /**
   * Con qué escena llega un paso entre los puntos y los marcadores, para que cada logo crezca desde
   * su punto o se encoja hasta él: la del último paso al cruzar el zoom de los logos o la del último
   * vuelo al cambiar de vista, la que haya cambiado.
   */
  const traspasoDeCapa = createMemo<
    | {
        readonly paso: Traspaso | undefined;
        readonly cambio: ReturnType<typeof cambioDeVista>["cambio"];
        readonly vuelo: ReturnType<typeof vuelo>;
        readonly escena: Escena;
        readonly escala: number;
      }
    | undefined
  >((antes) => {
    const paso = estadoDelTraspaso()?.traspaso;
    const { cambio } = cambioDeVista();
    const enVuelo = vuelo();
    const actual = escena();
    const escala = () => (2 * radioDePunto(untrack(() => props.mapa.getZoom()))) / LOGO_PX;
    const de = { paso, cambio, vuelo: enVuelo };
    if (paso !== undefined && paso !== antes?.paso) {
      return { ...de, escena: paso.llega, escala: escala() };
    }
    // Al volver a los puntos, los marcadores se van a la vez que cambia la vista; al pasar a la
    // agrupada, salen cuando los puntos llegan a sus hexágonos.
    const vuelven = cambio?.hacia === "puntos" && cambio !== antes?.cambio;
    const llegan = enVuelo?.hacia === "agrupada" && enVuelo.llegado && enVuelo !== antes?.vuelo;
    if ((vuelven || llegan) && actual !== undefined) {
      return { ...de, escena: actual, escala: escala() };
    }
    return antes === undefined ? undefined : { ...antes, ...de };
  });

  // Precarga las fichas de los sueltos que se ven. La escena cambia también al seleccionar uno;
  // si los que se ven son los mismos, no se vuelve a pedir nada. Solo al mover el mapa o al
  // llegar una provincia: cambiar el filtro de compañías no descarga nada (ADR 0026).
  let vistaPrecargada: Vista | undefined;
  let provinciasPrecargadas: ReadonlyMap<string, EstadoProvincia> | undefined;
  recurso(
    "fichas:precarga",
    () => {
      const ahora = escena();
      const proyectarAhora = proyectar();
      const seVeAhora = seVe();
      const pedidas = [...(ahora?.elementos.values() ?? [])].flatMap((elemento) =>
        elemento.tipo === "emplazamiento" && seVeAhora(proyectarAhora(elemento.posicion))
          ? [
              {
                clave: elemento.emplazamiento.clave,
                provincia: elemento.emplazamiento.provincia ?? PROVINCIA_DE_LOS_ENLACES_VIEJOS,
              },
            ]
          : [],
      );
      return pedidas.length > 0
        ? { pedidas, vista: vista(), provincias: props.provincias }
        : undefined;
    },
    ({ pedidas, vista: vistaAhora, provincias }) => {
      const porElFiltro = vistaAhora === vistaPrecargada && provincias === provinciasPrecargadas;
      vistaPrecargada = vistaAhora;
      provinciasPrecargadas = provincias;
      if (!porElFiltro) props.alVer?.(pedidas);
      return undefined;
    },
    {
      iguales: (a, b) =>
        mismasListas(
          a.pedidas.map((p) => p.clave),
          b.pedidas.map((p) => p.clave),
        ),
    },
  );

  /**
   * Los rótulos de ciudad colocados. Se leen cuando el mapa queda quieto y pintado (`idle`), que no
   * vuelve a llegar mientras nada cambia: nunca en cada fotograma.
   */
  const [lectura, setLectura] = createSignal<LecturaDeRotulos>(SIN_ROTULOS, {
    equals: mismaLectura,
  });
  /** Cuántas veces ha quedado quieto el mapa: los huecos se ponen entonces, no al moverse. */
  const [quieto, setQuieto] = createSignal(0);
  recurso(
    "marcadores:rotulos",
    () => (props.lectorDeRotulos === undefined ? undefined : props.mapa),
    (mapa) => {
      const lector = props.lectorDeRotulos;
      if (lector === undefined) return undefined;
      const leer = () => {
        setLectura(lector.leer(mapa));
        setQuieto((n) => n + 1);
      };
      mapa.on("idle", leer);
      return () => mapa.off("idle", leer);
    },
  );

  /**
   * Los municipios de las provincias que han llegado, por su nombre de lugar: de cerca dan los
   * habitantes de cualquier rótulo, también de los pueblos que no están en la tabla del mapa.
   */
  const municipiosDeLasCapas = createMemo(() =>
    indiceDeCiudades(
      [...props.provincias.values()].flatMap((estado) =>
        estado.tipo === "lista"
          ? estado.provincia.capa.municipios.flatMap((m) =>
              m.habitantes === null
                ? []
                : [{ nombre: m.nombre, etiqueta: m.etiqueta, habitantes: m.habitantes }],
            )
          : [],
      ),
    ),
  );
  const rotulosConHabitantes = createMemo((): ReadonlyArray<RotuloEnElMapa> => {
    const lector = props.lectorDeRotulos;
    const deCapas = municipiosDeLasCapas();
    return lectura().rotulos.map((rotulo) => ({
      ...rotulo,
      habitantes:
        lector === undefined
          ? 0
          : habitantesDeRotulo(rotulo.texto, rotulo.posicion, deCapas, lector.ciudades),
    }));
  });

  /** Lo grande que van los hexágonos al zoom de la escena. */
  const tamano = createMemo(() => tamanoDeNivel(escena()?.nivel ?? 0));

  /**
   * Qué se dibuja cuando rótulos y marcadores se pisan, y la forma de cada zona (ADR 0024). Se
   * decide con la escena y con los rótulos, al pararse el mapa o al cambiar de nivel, como qué se
   * dibuja.
   */
  const choques = createMemo(() => {
    const lienzo = props.mapa.getContainer();
    return resolverChoques({
      elementos: [...(escena()?.elementos.values() ?? [])],
      rotulos: rotulosConHabitantes(),
      proyectar: proyectar(),
      tamano: tamano(),
      pantalla: { ancho: lienzo.clientWidth, alto: lienzo.clientHeight },
      seleccionada: props.seleccionada,
    });
  });
  const formas = createMemo(() => choques().formas);
  const ocultos = createMemo(() => choques().ocultos);

  // Los huecos de los marcadores en el mapa base, para que sus rótulos los esquiven. Se ponen con
  // el mapa quieto: cada `setData` manda la fuente a los workers y vuelve a colocar los rótulos, y
  // a mitad de un gesto costaba fotogramas. Si son los mismos, no se toca el mapa.
  const ponerHuecos = createMemo(() => {
    const mapa = props.mapa;
    return puestaDeHuecos((datos) => {
      mapa.getSource<GeoJSONSource>(FUENTE_HUECOS)?.setData(datos);
    });
  });
  createEffect(
    () => ({
      huecos: huecosDe([...(escena()?.elementos.values() ?? [])], choques(), tamano()),
      quieto: quieto(),
    }),
    ({ huecos }) => {
      if (!props.mapa.isMoving()) ponerHuecos()(huecos);
    },
  );

  /** Los rótulos de ciudad que se copian encima: los colocados que no ceden su sitio. */
  const rotulosEncima = createMemo(() => {
    const fuera = choques().rotulosOcultos;
    return lectura().rotulos.filter((rotulo) => !fuera.has(rotulo.clave));
  });

  /**
   * Los municipios que son zona en la escena. Sus rótulos del mapa base se quitan: Celda ya pone
   * su nombre bajo el hexágono, como en los barrios (`estilo.ts`).
   */
  const municipiosConEtiqueta = createMemo(
    () =>
      [...(escena()?.elementos.values() ?? [])].flatMap((elemento) =>
        elemento.tipo === "municipio" ? [elemento.resumen.municipio.nombre] : [],
      ),
    { equals: mismasListas },
  );
  createEffect(municipiosConEtiqueta, (nombres) => {
    quitarRotulosDeMunicipios(props.mapa, nombres);
  });

  /**
   * Acerca el mapa hasta que la agrupación, el barrio, el municipio o la provincia se abre: una provincia con
   * emplazamientos, hasta verlos todos. Con el teclado, el foco vuelve al mapa. Con la preferencia
   * de reducir movimiento, MapLibre salta sin animación.
   */
  const abrir = (elemento: ElementoAbrible) => {
    const mapa = props.mapa;
    const lienzo = mapa.getCanvas();
    if (mapa.getCanvasContainer().contains(document.activeElement)) {
      lienzo.focus({ preventScroll: true });
    }
    const caja = elemento.tipo === "provincia" ? elemento.provincia.caja : undefined;
    const encuadre =
      caja === undefined
        ? undefined
        : mapa.cameraForBounds(
            [
              [caja.suroeste.longitud, caja.suroeste.latitud],
              [caja.noreste.longitud, caja.noreste.latitud],
            ],
            { padding: 60, maxZoom: ZOOM_MAXIMO_DE_PROVINCIA },
          );
    if (encuadre?.center !== undefined && encuadre.zoom !== undefined) {
      mapa.easeTo({
        center: encuadre.center,
        zoom: Math.max(encuadre.zoom, NIVEL_DE_PROVINCIAS),
      });
      return;
    }
    mapa.easeTo({
      center: [elemento.posicion.longitud, elemento.posicion.latitud],
      zoom: Math.min(agrupador().zoomDeApertura(elemento), mapa.getMaxZoom()),
    });
  };

  /** La provincia en cuya capa va un emplazamiento que se ve. */
  const provinciaDe = (clave: string): string => {
    for (const estado of props.provincias.values()) {
      if (estado.tipo !== "lista") continue;
      if (estado.provincia.capa.emplazamientos.some((e) => e.clave === clave)) {
        return estado.provincia.codigo;
      }
    }
    return PROVINCIA_DE_LOS_ENLACES_VIEJOS;
  };

  return (
    <>
      <Show when={moviendose()}>
        {(paso) => (
          <CapaDeTraspaso contenedor={props.mapa.getCanvasContainer()} salto={lamina().salto}>
            <For each={paso().puntos} keyed={(punto) => punto.clave}>
              {(punto) => (
                <PuntoQueSeMueve
                  punto={punto()}
                  hacia={paso().hacia}
                  zoom={zoomColocado()}
                  proyectar={proyectarEnLamina()}
                />
              )}
            </For>
          </CapaDeTraspaso>
        )}
      </Show>
      <CapaAgrupada
        contenedor={props.mapa.getCanvasContainer()}
        logos={logos()}
        filtro={filtro()}
        escena={escena()}
        transicion={agrupador().transicion}
        proyectar={proyectarEnLamina()}
        seVe={seVeEnLamina()}
        zoom={zoomColocado()}
        salto={lamina().salto}
        movimientoReducido={reducido()}
        formas={formas()}
        ocultos={ocultos()}
        tamano={tamano()}
        seleccionada={props.seleccionada}
        alSeleccionar={(clave) => props.alSeleccionar(clave, provinciaDe(clave))}
        alAbrir={abrir}
        traspaso={traspasoDeCapa()}
      />
      <CapaDeRotulos contenedor={props.mapa.getCanvasContainer()} salto={lamina().salto}>
        <For each={rotulosEncima()} keyed={(rotulo) => rotulo.clave}>
          {(rotulo) => (
            <RotuloEnPantalla
              rotulo={rotulo()}
              zoom={zoomColocado()}
              proyectar={proyectarEnLamina()}
              conFoto={props.conFoto ?? false}
            />
          )}
        </For>
      </CapaDeRotulos>
    </>
  );
}

/**
 * Un rótulo de ciudad copiado encima de los marcadores. Se vuelve a colocar al cambiar el zoom,
 * como los marcadores; su letra es la del zoom en que se leyó.
 */
function RotuloEnPantalla(props: {
  readonly rotulo: RotuloLeido;
  /** El zoom al que se colocan: la proyección cambia con él aunque no lo lea. */
  readonly zoom: number;
  readonly proyectar: (posicion: Coordenada) => Salto;
  readonly conFoto: boolean;
}) {
  const punto = createMemo(() => {
    void props.zoom;
    return props.proyectar(props.rotulo.posicion);
  });
  return (
    <RotuloDeCiudad
      x={punto().x}
      y={punto().y}
      texto={props.rotulo.texto}
      tamano={props.rotulo.tamano}
      importancia={props.rotulo.importancia}
      conFoto={props.conFoto}
    />
  );
}

/**
 * Un punto que se mueve entre su sitio y su marcador en el paso entre los puntos y los logos: va
 * hacia él al acercar y sale de él al alejar. Se vuelve a colocar al cambiar el zoom, como los
 * marcadores, aunque el gesto siga a mitad de paso: colocado solo al empezar, se quedaba donde
 * caía su emplazamiento a ese zoom y se separaba de él mientras el mapa seguía alejándose (#74).
 */
function PuntoQueSeMueve(props: {
  readonly punto: PuntoDelTraspaso;
  readonly hacia: "logos" | "puntos";
  /** El zoom al que se colocan: la proyección cambia con él aunque no lo lea. */
  readonly zoom: number;
  readonly proyectar: (posicion: Coordenada) => Salto;
}) {
  const sitio = createMemo(() => {
    void props.zoom;
    return props.proyectar(props.punto.posicion);
  });
  const marcador = createMemo(() => {
    void props.zoom;
    return props.proyectar(props.punto.marcador);
  });
  return (
    <PuntoDeTraspaso
      x={sitio().x}
      y={sitio().y}
      marcador={{ x: marcador().x - sitio().x, y: marcador().y - sitio().y }}
      sentido={props.hacia === "logos" ? "va" : "viene"}
      diametro={2 * radioDePunto(props.zoom)}
      opacidad={opacidadDePunto(props.zoom)}
    />
  );
}
