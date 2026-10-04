import type { Coordenada } from "@celda/dominio/area";
import { type FiltroDeCompanias, SIN_FILTRO } from "@celda/dominio/filtro";
import { habitantesDeRotulo, indiceDeCiudades } from "@celda/dominio/poblacionDeRotulos";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { quitarRotulosDeMunicipios } from "@celda/ui/mapa/estilo.ts";
import { FUENTE_HUECOS, puestaDeHuecos } from "@celda/ui/mapa/huecos.ts";
import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import { CapaDeRotulos, RotuloDeCiudad } from "@celda/ui/marcadores/RotuloDeCiudad.tsx";
import { mismasListas, recurso, recursoFijo } from "@celda/ui/recurso.ts";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal, For } from "solid-js";

import { type ElementoAbrible, nivelDeZoom } from "../capa/agrupacion.ts";
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
import { CapaAgrupada } from "./CapaAgrupada.tsx";
import type { LecturaDeRotulos, LectorDeRotulos, RotuloLeido } from "./rotulosDeCiudad.ts";
import { seguirVista } from "./vista.ts";

const REDUCIR_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

/** Medio marcador, en píxeles: lo que asoma de uno cuyo punto está justo fuera de la pantalla. */
const MEDIO_MARCADOR = 30;

/** Hasta dónde acerca pulsar una provincia para verla entera: más cerca se ven sus calles. */
const ZOOM_MAXIMO_DE_PROVINCIA = 12;

export interface MarcadoresProps {
  readonly mapa: MapaMapLibre;
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
}

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
 * cerca, las provincias que han llegado (ADR 0016). Los marcadores se recolocan en cada fotograma
 * del movimiento, pero qué se dibuja se decide al asentarse el mapa (ver `seguirVista`): crear y
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
  const [fotograma, setFotograma] = createSignal(0);
  const [vista, setVista] = createSignal<Vista>();
  const [reducido, setReducido] = createSignal(false);

  recurso(
    "marcadores:vista",
    () => props.mapa,
    (mapa) =>
      seguirVista(mapa, {
        fotograma: () => setFotograma((n) => n + 1),
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

  const escena = createMemo(() => {
    const ahora = vista();
    return ahora === undefined
      ? undefined
      : agrupador().escena(
          nivelDeZoom(ahora.zoom),
          cajaConMargen(ahora.caja),
          // El seleccionado se ve siempre, aunque al alejar quede dentro de una agrupación.
          props.seleccionada,
        );
  });

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
      <CapaAgrupada
        contenedor={props.mapa.getCanvasContainer()}
        logos={logos()}
        filtro={filtro()}
        escena={escena()}
        transicion={agrupador().transicion}
        proyectar={proyectar()}
        seVe={seVe()}
        fotograma={fotograma()}
        movimientoReducido={reducido()}
        formas={formas()}
        ocultos={ocultos()}
        tamano={tamano()}
        seleccionada={props.seleccionada}
        alSeleccionar={(clave) => props.alSeleccionar(clave, provinciaDe(clave))}
        alAbrir={abrir}
      />
      <CapaDeRotulos contenedor={props.mapa.getCanvasContainer()}>
        <For each={rotulosEncima()} keyed={(rotulo) => rotulo.clave}>
          {(rotulo) => (
            <RotuloEnPantalla
              rotulo={rotulo()}
              fotograma={fotograma()}
              proyectar={proyectar()}
              conFoto={props.conFoto ?? false}
            />
          )}
        </For>
      </CapaDeRotulos>
    </>
  );
}

/**
 * Un rótulo de ciudad copiado encima de los marcadores. Se recoloca en cada fotograma del
 * movimiento, como los marcadores, con su `transform`; su letra es la del zoom en que se leyó.
 */
function RotuloEnPantalla(props: {
  readonly rotulo: RotuloLeido;
  readonly fotograma: number;
  readonly proyectar: (posicion: Coordenada) => Salto;
  readonly conFoto: boolean;
}) {
  const punto = createMemo(() => {
    // La proyección cambia con cada fotograma aunque no lo lea.
    void props.fotograma;
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
