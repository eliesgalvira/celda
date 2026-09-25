import { Aviso } from "@celda/ui/Aviso.tsx";
import { Enlace } from "@celda/ui/Boton.tsx";
import { PantallaCentrada } from "@celda/ui/PantallaCentrada.tsx";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, Show } from "solid-js";

import { esClicDeNavegacion, navegar, ruta, ubicacion } from "./lib/rutas.ts";
import { PantallaMapa } from "./mapa/PantallaMapa.tsx";

interface Ruta {
  readonly patron: string;
  readonly titulo: string;
  readonly vista: () => JSX.Element;
}

/** La tabla de rutas: dirección, título de la pestaña y vista. */
const RUTAS: ReadonlyArray<Ruta> = [
  { patron: ruta.mapa, titulo: "Mapa de Barcelona", vista: () => <PantallaMapa /> },
];

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
        La dirección {ubicacion().pathname} no lleva a ninguna parte de Celda.
      </Aviso>
    </PantallaCentrada>
  );
}

export function App() {
  const actual = createMemo(
    () => RUTAS.find((candidata) => candidata.patron === ubicacion().pathname) ?? null,
  );

  createEffect(
    () => actual()?.titulo,
    (titulo) => {
      document.title = titulo === undefined ? "Celda" : `${titulo} · Celda`;
    },
  );

  return (
    <Show when={actual()} keyed fallback={<NoEncontrada />}>
      {(encontrada) => encontrada.vista()}
    </Show>
  );
}
