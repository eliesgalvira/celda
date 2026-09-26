import {
  CapaDeReferencia,
  EtiquetaReferencia,
  PuntoElegido,
  UbicacionGps,
} from "@celda/ui/ubicacion/MarcadorReferencia.tsx";
import type { Map as MapaMapLibre } from "maplibre-gl";
import {
  createMemo,
  createSignal,
  Match,
  onSettled,
  Show,
  Switch,
  untrack,
  useContext,
} from "solid-js";

import { ServicioContexto } from "../servicio/enMapa.ts";
import { lecturaDe } from "../servicio/servicio.ts";
import { textosServicio } from "../servicio/textos.ts";
import { UbicacionContexto } from "./controlador.ts";
import { posicionDe } from "./estado.ts";
import { textoPrecision } from "./textos.ts";

/** Metros de un grado de latitud: basta para dibujar el círculo de precisión. */
const METROS_POR_GRADO = 111_320;

export interface ReferenciaEnMapaProps {
  readonly mapa: MapaMapLibre;
  /** En escritorio el punto elegido se arrastra; en el móvil el dedo mueve el mapa. */
  readonly escritorio: boolean;
}

/** El punto de referencia sobre el mapa: la ubicación GPS con su precisión o el punto elegido. */
export function ReferenciaEnMapa(props: ReferenciaEnMapaProps) {
  const control = useContext(UbicacionContexto);
  const servicio = useContext(ServicioContexto);
  const [fotograma, setFotograma] = createSignal(0);

  // El punto se recoloca en cada fotograma en que se mueve el mapa, como los marcadores.
  onSettled(() => {
    const mapa = untrack(() => props.mapa);
    let pendiente = 0;
    const alMover = () => {
      if (pendiente === 0) {
        pendiente = requestAnimationFrame(() => {
          pendiente = 0;
          setFotograma((n) => n + 1);
        });
      }
    };
    mapa.on("move", alMover);
    // El mapa puede haberse movido entre el primer cálculo y ahora (al abrir con un emplazamiento
    // en la dirección salta hasta él): se recoloca una vez.
    alMover();
    return () => {
      mapa.off("move", alMover);
      cancelAnimationFrame(pendiente);
    };
  });

  const enPantalla = createMemo(() => {
    const referencia = control.referencia();
    if (referencia === undefined) return undefined;
    // La proyección cambia con cada fotograma aunque no lo lea.
    void fotograma();
    const { longitud, latitud } = posicionDe(referencia);
    const punto = props.mapa.project([longitud, latitud]);
    const precision = referencia.tipo === "gps" ? referencia.lectura.precision : 0;
    const borde = props.mapa.project([longitud, latitud + precision / METROS_POR_GRADO]);
    return {
      tipo: referencia.tipo,
      precision,
      x: punto.x,
      y: punto.y,
      radio: Math.abs(punto.y - borde.y),
    };
  });

  /**
   * La distancia y el sector que da servicio junto al punto, con un emplazamiento seleccionado.
   * Va al lado contrario del emplazamiento, para no tapar la línea que los une.
   */
  const etiqueta = createMemo(() => {
    const referencia = control.referencia();
    const calculado = servicio.calculado();
    if (referencia === undefined || calculado === undefined) return undefined;
    const lectura = lecturaDe(calculado.resultado);
    if (lectura === undefined) return undefined;
    const texto = textosServicio(lectura, referencia.tipo, servicio.orientacion).enMapa;
    // El emplazamiento queda al este del punto si el rumbo del emplazamiento al punto va al oeste.
    const emplazamientoAlEste = Math.sin((lectura.rumbo * Math.PI) / 180) < 0;
    return { texto, lado: emplazamientoAlEste ? ("izquierda" as const) : ("derecha" as const) };
  });

  return (
    <Show when={enPantalla()}>
      {(actual) => (
        <CapaDeReferencia contenedor={props.mapa.getCanvasContainer()}>
          <Switch>
            <Match when={actual().tipo === "gps"}>
              <UbicacionGps
                x={actual().x}
                y={actual().y}
                radio={actual().radio}
                nombre={`Tu ubicación, con ${textoPrecision(actual().precision)} de precisión`}
              />
            </Match>
            <Match when={actual().tipo === "elegido"}>
              <PuntoElegido
                x={actual().x}
                y={actual().y}
                arrastrable={props.escritorio}
                nombre={
                  props.escritorio
                    ? "El punto elegido. Arrástralo, o muévelo con las flechas, para cambiarlo."
                    : "El punto elegido"
                }
                alMover={(x, y) => {
                  const nueva = props.mapa.unproject([x, y]);
                  control.mover({ longitud: nueva.lng, latitud: nueva.lat });
                }}
                alSoltar={() => control.soltar()}
              />
            </Match>
          </Switch>
          <Show when={etiqueta()}>
            {(texto) => (
              <EtiquetaReferencia
                x={actual().x}
                y={actual().y - 14}
                texto={texto().texto}
                lado={texto().lado}
              />
            )}
          </Show>
        </CapaDeReferencia>
      )}
    </Show>
  );
}
