import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import {
  CapaDeMarcadores,
  MarcadorEmplazamiento,
} from "@celda/ui/marcadores/MarcadorEmplazamiento.tsx";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createMemo, For } from "solid-js";

import { nombreDeMarcador } from "../capa/marcadores.ts";

export interface MarcadoresProps {
  readonly mapa: MapaMapLibre;
  /** Cambia en cada fotograma en que se mueve el mapa: los marcadores se vuelven a colocar. */
  readonly fotograma: number;
  /** Los emplazamientos que se dibujan: solo los que están a la vista. */
  readonly emplazamientos: ReadonlyArray<EmplazamientoDeCapa>;
  /** Todas las combinaciones de compañías de la capa. */
  readonly combinaciones: ReadonlyArray<ReadonlyArray<Compania>>;
}

/** Los marcadores DOM de los emplazamientos visibles, colocados sobre el mapa en cada fotograma. */
export function Marcadores(props: MarcadoresProps) {
  return (
    <CapaDeMarcadores
      nombre="Emplazamientos"
      contenedor={props.mapa.getCanvasContainer()}
      combinaciones={props.combinaciones}
    >
      <For each={props.emplazamientos}>
        {(emplazamiento) => {
          const punto = createMemo(() => {
            // La proyección cambia con cada fotograma aunque no lo lea.
            void props.fotograma;
            return props.mapa.project([
              emplazamiento.posicion.longitud,
              emplazamiento.posicion.latitud,
            ]);
          });
          return (
            <MarcadorEmplazamiento
              x={punto().x}
              y={punto().y}
              companias={emplazamiento.companias}
              estado={emplazamiento.estado}
              nombre={nombreDeMarcador(emplazamiento)}
            />
          );
        }}
      </For>
    </CapaDeMarcadores>
  );
}
