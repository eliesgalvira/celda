import { Aviso } from "@celda/ui/Aviso.tsx";
import { Enlace } from "@celda/ui/Boton.tsx";
import { PantallaCentrada } from "@celda/ui/PantallaCentrada.tsx";
import type * as Layer from "effect/Layer";
import { createEffect, createMemo, Show } from "solid-js";

import { ProveedorDeDatos, type ServiciosDeDatos } from "./datos.tsx";
import { esClicDeNavegacion, navegar, ruta, ubicacion } from "./lib/rutas.ts";
import { PantallaMapa } from "./mapa/PantallaMapa.tsx";

function NoEncontrada() {
  return (
    <PantallaCentrada>
      <Aviso
        tono="fallo"
        titulo="Esta página no existe"
        acciones={
          <Enlace
            href={ruta.mapa}
            onClick={(evento) => {
              if (esClicDeNavegacion(evento)) {
                evento.preventDefault();
                navegar(ruta.mapa);
              }
            }}
          >
            Volver al mapa
          </Enlace>
        }
      >
        La dirección {ubicacion().pathname} no corresponde a ninguna página de Celda.
      </Aviso>
    </PantallaCentrada>
  );
}

export function App(props: { readonly servicios: Layer.Layer<ServiciosDeDatos> }) {
  // El mapa es la única página: lo demás va en la búsqueda de la dirección.
  const enElMapa = createMemo(() => ubicacion().pathname === ruta.mapa);

  createEffect(enElMapa, (si) => {
    document.title = si ? "Mapa de España · Celda" : "Celda";
  });

  return (
    <ProveedorDeDatos servicios={props.servicios}>
      <Show when={enElMapa()} fallback={<NoEncontrada />}>
        <PantallaMapa />
      </Show>
    </ProveedorDeDatos>
  );
}
