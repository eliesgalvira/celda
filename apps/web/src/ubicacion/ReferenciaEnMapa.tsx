import {
  CapaDeReferencia,
  PuntoElegido,
  UbicacionGps,
} from "@celda/ui/ubicacion/MarcadorReferencia.tsx";
import { recurso } from "@celda/ui/recurso.ts";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createMemo, createSignal, Match, Show, Switch, useContext } from "solid-js";

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
  const [fotograma, setFotograma] = createSignal(0);

  // El punto se recoloca en cada `move`, en el fotograma en que se mueve el mapa (`seguirVista`).
  recurso(
    "referencia:movimiento",
    () => props.mapa,
    (mapa) => {
      const alMover = () => setFotograma((n) => n + 1);
      mapa.on("move", alMover);
      // El mapa puede haberse movido entre el primer cálculo y ahora (al abrir con un emplazamiento
      // en la dirección salta hasta él): se recoloca una vez.
      alMover();
      return () => mapa.off("move", alMover);
    },
  );

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
        </CapaDeReferencia>
      )}
    </Show>
  );
}
