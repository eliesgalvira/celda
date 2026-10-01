import type { Coordenada } from "@celda/dominio/area";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { quitarRotulosDeMunicipios } from "@celda/ui/mapa/estilo.ts";
import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import { mismasListas, recurso, recursoFijo } from "@celda/ui/recurso.ts";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal } from "solid-js";

import { type ElementoAbrible, nivelDeZoom } from "../capa/agrupacion.ts";
import { formasDeEtiquetas } from "../capa/etiquetas.ts";
import { cajaConMargen, combinacionesDe, type Vista } from "../capa/marcadores.ts";
import {
  crearAgrupadorNacional,
  type EstadoProvincia,
  NIVEL_DE_PROVINCIAS,
} from "../capa/nacional.ts";
import type { FichaPedida } from "../ficha/servicio.ts";
import { PROVINCIA_DE_LOS_ENLACES_VIEJOS } from "../lib/rutas.ts";
import { CapaAgrupada } from "./CapaAgrupada.tsx";
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
}

/**
 * Los emplazamientos sobre el mapa, agrupados por zoom: el resumen por provincias de lejos y, de
 * cerca, las provincias que han llegado (ADR 0016). Los marcadores se recolocan en cada fotograma
 * del movimiento, pero qué se dibuja se decide al asentarse el mapa (ver `seguirVista`): crear y
 * quitar nodos es lo caro.
 */
export function Marcadores(props: MarcadoresProps) {
  const agrupador = createMemo(() => crearAgrupadorNacional(props.resumen, props.provincias));
  const combinaciones = createMemo(() =>
    combinacionesDe(
      [...props.provincias.values()].flatMap((estado) =>
        estado.tipo === "lista" ? estado.provincia.capa.emplazamientos : [],
      ),
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
  // si los que se ven son los mismos, no se vuelve a pedir nada.
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
      return pedidas.length > 0 ? pedidas : undefined;
    },
    (pedidas) => {
      props.alVer?.(pedidas);
      return undefined;
    },
    {
      iguales: (a, b) =>
        mismasListas(
          a.map((p) => p.clave),
          b.map((p) => p.clave),
        ),
    },
  );

  /**
   * Las zonas (barrios, municipios y provincias) que caben enteras en la pantalla, con su nombre, y
   * las que van compactas. Se decide con la escena, al pararse el mapa o al cambiar de nivel, como
   * qué se dibuja.
   */
  const formas = createMemo(() => {
    const proyectarAhora = proyectar();
    return formasDeEtiquetas([...(escena()?.elementos.values() ?? [])], (elemento) =>
      proyectarAhora(elemento.posicion),
    );
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
    <CapaAgrupada
      contenedor={props.mapa.getCanvasContainer()}
      combinaciones={combinaciones()}
      escena={escena()}
      transicion={agrupador().transicion}
      proyectar={proyectar()}
      seVe={seVe()}
      fotograma={fotograma()}
      movimientoReducido={reducido()}
      formas={formas()}
      seleccionada={props.seleccionada}
      alSeleccionar={(clave) => props.alSeleccionar(clave, provinciaDe(clave))}
      alAbrir={abrir}
    />
  );
}
