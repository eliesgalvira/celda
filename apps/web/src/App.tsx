import { Aviso } from "@celda/ui/Aviso.tsx";
import { Enlace } from "@celda/ui/Boton.tsx";
import { PantallaCentrada } from "@celda/ui/PantallaCentrada.tsx";
import type { JSX } from "@solidjs/web";
import type * as Layer from "effect/Layer";
import { createEffect, createMemo, Show } from "solid-js";

import { ProveedorDeDatos, type ServiciosDeDatos } from "./datos.tsx";
import { esClicDeNavegacion, navegar, ruta, ubicacion } from "./lib/rutas.ts";
import { PantallaMapa } from "./mapa/PantallaMapa.tsx";

interface Ruta {
  readonly patron: string;
  readonly titulo: string;
  readonly vista: () => JSX.Element;
}

/** La tabla de rutas: dirección, título de la pestaña y vista. */
const RUTAS: ReadonlyArray<Ruta> = [
  { patron: ruta.mapa, titulo: "Mapa de España", vista: () => <PantallaMapa /> },
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
        La dirección {ubicacion().pathname} no corresponde a ninguna página de Celda.
      </Aviso>
    </PantallaCentrada>
  );
}

export function App(props: { readonly servicios: Layer.Layer<ServiciosDeDatos> }) {
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
    <ProveedorDeDatos servicios={props.servicios}>
      <Show when={actual()} keyed fallback={<NoEncontrada />}>
        {(encontrada) => encontrada.vista()}
      </Show>
    </ProveedorDeDatos>
  );
}
