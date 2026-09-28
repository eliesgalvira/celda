import type { Coordenada } from "@celda/dominio/area";
import type { Barrio } from "@celda/dominio/barrio";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";
import { mismasListas, recurso, recursoFijo } from "@celda/ui/recurso.ts";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createMemo, createSignal } from "solid-js";

import {
  crearAgrupador,
  type ElementoAbrible,
  type ElementoBarrio,
  nivelDeZoom,
} from "../capa/agrupacion.ts";
import { formasDeBarrios } from "../capa/etiquetas.ts";
import { cajaConMargen, combinacionesDe, type Vista } from "../capa/marcadores.ts";
import { CapaAgrupada } from "./CapaAgrupada.tsx";
import { seguirVista } from "./vista.ts";

const REDUCIR_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

/** Medio marcador, en píxeles: lo que asoma de uno cuyo punto está justo fuera de la pantalla. */
const MEDIO_MARCADOR = 30;

export interface MarcadoresProps {
  readonly mapa: MapaMapLibre;
  /** Todos los emplazamientos de la capa. Se agrupan aquí y se dibujan solo los de la vista. */
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  /** Los barrios de la misma capa: a su nivel, los emplazamientos se recogen por barrio. */
  readonly barrios: ReadonlyArray<Barrio>;
  /** Clave del emplazamiento con la ficha abierta. */
  readonly seleccionada: string | null;
  /** Se ha pulsado el marcador de un emplazamiento (con el ratón, el dedo o el teclado). */
  readonly alSeleccionar: (clave: string) => void;
  /**
   * Los emplazamientos sueltos que se ven al decidir qué se dibuja: sus fichas se pueden abrir
   * con un toque, así que conviene tenerlas ya.
   */
  readonly alVer?: (claves: ReadonlyArray<string>) => void;
}

/**
 * Los emplazamientos sobre el mapa, agrupados por zoom. Los marcadores se recolocan en cada
 * fotograma del movimiento, pero qué se dibuja se decide al asentarse el mapa (ver `seguirVista`):
 * crear y quitar nodos es lo caro.
 */
export function Marcadores(props: MarcadoresProps) {
  const agrupador = createMemo(() => crearAgrupador(props.emplazamientos, props.barrios));
  const combinaciones = createMemo(() => combinacionesDe(props.emplazamientos));
  const [fotograma, setFotograma] = createSignal(0);
  const [vista, setVista] = createSignal<Vista>();
  const [reducido, setReducido] = createSignal(false);

  recurso(
    "marcadores:vista",
    () => props.mapa,
    (mapa) =>
      seguirVista(mapa, {
        fotograma: () => setFotograma((n) => n + 1),
        vista: setVista,
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
      const claves = [...(ahora?.elementos.values() ?? [])].flatMap((elemento) =>
        elemento.tipo === "emplazamiento" && seVeAhora(proyectarAhora(elemento.posicion))
          ? [elemento.emplazamiento.clave]
          : [],
      );
      return claves.length > 0 ? claves : undefined;
    },
    (claves) => {
      props.alVer?.(claves);
      return undefined;
    },
    { iguales: mismasListas },
  );

  /**
   * Las etiquetas de barrio que caben enteras en la pantalla y las que van compactas. Se decide
   * con la escena, al pararse el mapa o al cambiar de nivel, como qué se dibuja.
   */
  const formas = createMemo(() => {
    const barrios = [...(escena()?.elementos.values() ?? [])].filter(
      (elemento): elemento is ElementoBarrio => elemento.tipo === "barrio",
    );
    const proyectarAhora = proyectar();
    return formasDeBarrios(barrios, (barrio) => proyectarAhora(barrio.posicion));
  });

  /**
   * Acerca el mapa hasta que la agrupación o el barrio se abre. Con el teclado, el foco vuelve al
   * mapa. Con la preferencia de reducir movimiento, MapLibre salta sin animación.
   */
  const abrir = (elemento: ElementoAbrible) => {
    const mapa = props.mapa;
    const lienzo = mapa.getCanvas();
    if (mapa.getCanvasContainer().contains(document.activeElement)) {
      lienzo.focus({ preventScroll: true });
    }
    mapa.easeTo({
      center: [elemento.posicion.longitud, elemento.posicion.latitud],
      zoom: Math.min(agrupador().zoomDeApertura(elemento), mapa.getMaxZoom()),
    });
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
      alSeleccionar={(clave) => props.alSeleccionar(clave)}
      alAbrir={abrir}
    />
  );
}
