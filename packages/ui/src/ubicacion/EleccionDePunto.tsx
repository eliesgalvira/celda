import type { JSX } from "@solidjs/web";
import { createUniqueId, For, Match, Show, Switch } from "solid-js";

import type { Credito } from "../Atribucion.tsx";
import { Boton } from "../Boton.tsx";

export interface EleccionDePuntoProps {
  /** El buscador de direcciones (`BuscadorDeDirecciones`). */
  readonly buscador: JSX.Element;
  readonly alCancelar: () => void;
  /** En el móvil, usar el punto que marca el pin central. */
  readonly alUsarCentro: () => void;
}

/**
 * Cómo se elige un punto. En escritorio es una barra bajo la cabecera: clic en el mapa o buscar
 * una dirección (historia 26). En el móvil es una hoja abajo que acompaña al pin central: mover
 * el mapa y «Usar este punto», o buscar (historia 27).
 */
export function EleccionDePunto(props: EleccionDePuntoProps) {
  const titulo = createUniqueId();
  return (
    <section
      aria-labelledby={titulo}
      class={
        "pointer-events-auto flex flex-col gap-2 bg-superficie text-tinta drop-shadow-panel " +
        "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:px-4 max-md:pt-4 max-md:pb-9 " +
        "md:chaflan md:mt-1 md:w-[30rem] md:px-5 md:py-3 md:[--corte:12px]"
      }
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col">
          <h2 id={titulo} class="font-titulo text-lg leading-6">
            Elige un punto
          </h2>
          <p class="text-sm text-tinta-suave max-md:hidden">Haz clic en el mapa.</p>
          <p class="text-sm text-tinta-suave md:hidden">
            Mueve el mapa hasta dejar el pin en su sitio.
          </p>
        </div>
        <div class="max-md:hidden">
          <Boton variante="secundario" onClick={() => props.alCancelar()}>
            Cancelar
          </Boton>
        </div>
      </div>
      {props.buscador}
      <div class="flex gap-2 md:hidden">
        <Boton variante="secundario" tamano="grande" onClick={() => props.alCancelar()}>
          Cancelar
        </Boton>
        <Boton
          variante="destacado"
          tamano="grande"
          ancho="completo"
          onClick={() => props.alUsarCentro()}
        >
          Usar este punto
        </Boton>
      </div>
    </section>
  );
}

/** Lo que enseña el buscador bajo el campo. */
export type EstadoBusqueda =
  | { readonly tipo: "inicial" }
  | { readonly tipo: "buscando" }
  | {
      readonly tipo: "resultados";
      readonly direcciones: ReadonlyArray<{
        readonly nombre: string;
        /** Dónde queda dentro del municipio. */
        readonly detalle: string;
        /** El municipio y su provincia: distingue los sitios que se llaman igual. */
        readonly lugar: string;
      }>;
    }
  /** Un aviso en lugar de resultados: que no hay ninguno, que la consulta es corta o un fallo. */
  | { readonly tipo: "aviso"; readonly texto: string };

export interface BuscadorDeDireccionesProps {
  readonly consulta: string;
  readonly alCambiarConsulta: (consulta: string) => void;
  /** Busca al enviar el formulario, nunca mientras se escribe. */
  readonly alBuscar: () => void;
  readonly estado: EstadoBusqueda;
  readonly alElegir: (indice: number) => void;
  /** El servicio que busca, citado bajo los resultados. */
  readonly atribucion: Credito;
}

/**
 * Un campo para buscar una dirección y la lista de lo encontrado. Busca con Intro o con el
 * botón: nada se envía mientras se escribe.
 */
export function BuscadorDeDirecciones(props: BuscadorDeDireccionesProps) {
  return (
    <div class="flex flex-col gap-1.5">
      <search>
        <form
          class="flex items-center gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            props.alBuscar();
          }}
        >
          <label class="flex min-w-0 flex-1">
            <span class="sr-only">Dirección</span>
            <input
              type="search"
              autocomplete="off"
              enterkeyhint="search"
              placeholder="Calle y número, o un lugar"
              value={props.consulta}
              onInput={(evento) => props.alCambiarConsulta(evento.currentTarget.value)}
              class="min-h-11 min-w-0 flex-1 border border-linea-fuerte bg-superficie-alta px-3 text-base placeholder:text-tinta-suave md:text-sm"
            />
          </label>
          <Boton type="submit" variante="primario" cargando={props.estado.tipo === "buscando"}>
            Buscar
          </Boton>
        </form>
      </search>
      <div aria-live="polite" class="min-h-5 text-sm">
        <Switch>
          <Match when={props.estado.tipo === "aviso" ? props.estado.texto : undefined}>
            {(texto) => <p class="text-tinta-suave">{texto()}</p>}
          </Match>
          <Match when={props.estado.tipo === "resultados" ? props.estado.direcciones : undefined}>
            {(direcciones) => (
              <ul
                aria-label="Direcciones encontradas"
                class="flex max-h-56 flex-col overflow-y-auto"
              >
                <For each={direcciones()}>
                  {(direccion, indice) => (
                    <li class="border-b border-linea last:border-b-0">
                      <button
                        type="button"
                        class="flex min-h-11 w-full flex-col justify-center px-2 py-1.5 text-left hover:bg-superficie-alta"
                        onClick={() => props.alElegir(indice())}
                      >
                        <span>{direccion.nombre}</span>
                        <Show when={direccion.detalle !== ""}>
                          <span class="font-mono text-[11px] text-tinta-suave">
                            {direccion.detalle}
                          </span>
                        </Show>
                        <Show when={direccion.lugar !== ""}>
                          <span class="text-xs text-tinta">{direccion.lugar}</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
        </Switch>
      </div>
      <p class="font-mono text-[10.5px] text-tinta-suave">
        Búsqueda:{" "}
        <a
          href={props.atribucion.enlace}
          target="_blank"
          rel="noreferrer"
          class="underline underline-offset-2 hover:text-primario-texto"
        >
          {props.atribucion.texto}
        </a>
      </p>
    </div>
  );
}
