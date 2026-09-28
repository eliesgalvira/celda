import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";

import { PliegueDeCreditos } from "./Atribucion.tsx";
import { AspectoDeControl } from "./controles/aspecto.ts";
import { MenuDeControles } from "./controles/MenuDeControles.tsx";

export interface DisposicionMapaProps {
  /** Recibe el elemento en el que se dibuja el mapa. */
  readonly lienzo: (elemento: HTMLDivElement) => void;
  /** Nombre accesible de la región del mapa. */
  readonly nombre: string;
  /** El mapa aún no está listo: la región se anuncia como ocupada. */
  readonly ocupado: boolean;
  readonly cabecera: JSX.Element;
  /** Bajo la cabecera: la fecha de los datos del mapa. */
  readonly datos?: JSX.Element;
  /**
   * Bajo la fecha: los avisos de la ubicación y, mientras se elige un punto, `EleccionDePunto`,
   * que en el móvil se coloca sola abajo.
   */
  readonly ubicacion?: JSX.Element;
  /** Se está eligiendo un punto: en el móvil se aparta el panel y se ve el pin central. */
  readonly eligiendo?: boolean;
  /** El pin fijo en el centro para elegir un punto en el móvil (`PinCentral`). */
  readonly pinCentral?: JSX.Element;
  /** Un diálogo modal por encima de todo (`Dialogo`). */
  readonly dialogo?: JSX.Element;
  /** Los marcadores. `CapaDeMarcadores` los lleva dentro del mapa, debajo de los controles. */
  readonly marcadores?: JSX.Element;
  /** Una indicación breve abajo en el centro, como «acércate para ver…». */
  readonly pista?: JSX.Element;
  /**
   * Acercar y Alejar. En escritorio van a la vista, sobre «Ubicación»; en el móvil, dentro de
   * «Funciones», porque el mapa se amplía con dos dedos.
   */
  readonly zoom?: JSX.Element;
  /** Los controles de las funciones del mapa, como la interferencia o medir la señal. */
  readonly controles: JSX.Element;
  /** El botón de ubicación con su menú (`MenuUbicacion`), siempre a la vista. */
  readonly botonUbicacion?: JSX.Element;
  /** Controles que van al final de «Funciones», como los ajustes. */
  readonly controlesSecundarios?: JSX.Element;
  readonly atribucion: JSX.Element;
  /** Lo que se superpone al mapa mientras carga o si falla. */
  readonly aviso?: JSX.Element;
  /** El panel del emplazamiento seleccionado, con su propia posición (`PanelEmplazamiento`). */
  readonly panel?: JSX.Element;
  /**
   * Hay un panel abierto: en escritorio los créditos se apartan a su derecha y en el móvil los
   * controles y los créditos suben por encima del resumen de la hoja.
   */
  readonly panelAbierto?: boolean;
  /**
   * El panel de una vista del mapa, como la de interferencia (`PanelInterferencia`). En escritorio
   * va abajo a la derecha, junto a los controles; en el móvil, sobre los créditos, con los
   * controles encima. En el móvil cede el sitio a la hoja de la ficha y a la de elegir un punto.
   */
  readonly vista?: JSX.Element;
  /** El panel abierto es el ancho, el del ejercicio: en escritorio los créditos se apartan más. */
  readonly panelAncho?: boolean;
}

/** Plegados a los cinco segundos, como mucho, según las pautas de atribución de OpenStreetMap. */
const PLIEGUE_CREDITOS_MS = 5000;

/** Tres rayas: el botón «Funciones». */
const IconoFunciones = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <path d="M2 4h16M2 10h16M2 16h16" />
  </svg>
);

/**
 * La pantalla del mapa a pantalla completa, en móvil y en escritorio. Cada
 * pieza tiene su sitio fijo desde el primer momento, así que nada salta al
 * cargar: el fondo ya tiene el color del mapa y el aviso se superpone.
 */
export function DisposicionMapa(props: DisposicionMapaProps) {
  const [plegada, setPlegada] = createSignal(false);
  // Se pliegan solos una vez; después solo los pliega o despliega el botón «i».
  let plegarSolos = true;
  const plegarAlTocar = () => {
    if (!plegarSolos) return;
    plegarSolos = false;
    setPlegada(true);
  };
  onSettled(() => {
    const espera = window.setTimeout(plegarAlTocar, PLIEGUE_CREDITOS_MS);
    return () => window.clearTimeout(espera);
  });
  const pliegue = {
    plegada,
    cambiar: (nueva: boolean) => {
      plegarSolos = false;
      setPlegada(nueva);
    },
  };

  return (
    <div
      data-panel={props.panelAbierto === true ? "" : undefined}
      data-panel-ancho={props.panelAbierto === true && props.panelAncho === true ? "" : undefined}
      // En el móvil la hoja se aparta mientras se elige un punto: los controles y los créditos
      // vuelven abajo.
      data-hoja={props.panelAbierto === true && props.eligiendo !== true ? "" : undefined}
      data-eligiendo={props.eligiendo === true ? "" : undefined}
      // En el móvil la vista solo se ve sin hoja: entonces los controles suben por encima de ella.
      data-vista={
        props.vista !== undefined && props.panelAbierto !== true && props.eligiendo !== true
          ? ""
          : undefined
      }
      class="group/mapa fixed inset-0 overflow-hidden bg-mapa-fondo font-texto text-tinta"
    >
      <main
        aria-label={props.nombre}
        aria-busy={props.ocupado ? "true" : "false"}
        class="absolute inset-0 md:group-data-eligiendo/mapa:[&_.maplibregl-canvas-container]:cursor-crosshair"
        onPointerDown={plegarAlTocar}
      >
        <div ref={props.lienzo} class="size-full" />
        {props.marcadores}
      </main>

      <div class="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-1.5 px-3 md:top-[18px]">
        {props.cabecera}
        {props.datos}
        <Show when={props.ubicacion}>
          <div class="pointer-events-auto flex flex-col items-center gap-1.5">
            {props.ubicacion}
          </div>
        </Show>
      </div>

      <Show when={props.eligiendo === true ? props.pinCentral : undefined}>
        <div class="pointer-events-none absolute inset-0 z-20 md:hidden">{props.pinCentral}</div>
      </Show>

      {/*
        En el móvil, a la izquierda, sin llegar a las pastillas de los controles, que ocupan unos
        10rem. En escritorio, centrada en lo que deja libre el panel.
      */}
      <Show when={props.pista} keyed>
        <div class="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-10 flex justify-start pr-40 pl-3 max-md:group-data-hoja/mapa:bottom-[calc(11.75rem+4rem)] md:bottom-16 md:justify-center md:px-16 md:group-data-panel/mapa:pl-[calc(27rem+1rem)] md:group-data-panel-ancho/mapa:pl-[calc(min(46rem,100vw-8rem)+1rem)]">
          {props.pista}
        </div>
      </Show>

      {/* Con clave: cada aviso nuevo es un elemento nuevo, no uno que se mueve. */}
      <Show when={props.aviso} keyed>
        <div class="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4">
          <div class="pointer-events-auto">{props.aviso}</div>
        </div>
      </Show>

      {/* 11.75rem es el alto del resumen de la hoja (`ALTO_RESUMEN`, 188 px). */}
      <Show when={props.vista}>
        {/*
          En el móvil, 22.5rem de alto sobre el botón de los créditos, con las pastillas encima. En
          escritorio, a la izquierda de las pastillas, que ocupan unos 10rem.
        */}
        <div class="absolute inset-x-2 bottom-[3.25rem] z-10 h-[22.5rem] max-md:group-data-eligiendo/mapa:hidden max-md:group-data-hoja/mapa:hidden md:inset-x-auto md:right-48 md:bottom-16 md:h-auto md:max-h-[calc(100%-6rem)] md:w-[22rem]">
          {props.vista}
        </div>
      </Show>

      {/*
        Abajo a la derecha, solo dos pastillas claras: «Ubicación», que se usa también con la ficha
        abierta, y «Funciones», que despliega el resto con una línea que explica cada uno.
      */}
      <div class="absolute right-1.5 bottom-[max(0.25rem,env(safe-area-inset-bottom))] z-10 flex flex-col items-end gap-1 max-md:group-data-hoja/mapa:bottom-[calc(11.75rem+0.25rem)] max-md:group-data-vista/mapa:bottom-[calc(22.5rem+3.5rem)] max-md:group-data-eligiendo/mapa:hidden md:right-[18px] md:bottom-14">
        <div class="mr-3 mb-1 flex flex-col gap-1 max-md:hidden">
          <AspectoDeControl value="zoom">{props.zoom}</AspectoDeControl>
        </div>
        <AspectoDeControl value="pastilla">
          {props.botonUbicacion}
          <MenuDeControles
            etiqueta="Funciones"
            titulo="Funciones del mapa"
            icono={<IconoFunciones />}
          >
            <div class="contents md:hidden">{props.zoom}</div>
            {props.controles}
            {props.controlesSecundarios}
          </MenuDeControles>
        </AspectoDeControl>
      </div>

      {/* Mientras se elige en el móvil, los créditos quedan por encima de la hoja, en su pie. */}
      <div class="absolute bottom-[max(0.25rem,env(safe-area-inset-bottom))] left-1 z-10 max-w-[calc(100%-1rem)] max-md:max-w-[calc(100%-10.5rem)] max-md:group-data-hoja/mapa:bottom-[calc(11.75rem+0.5rem)] max-md:group-data-eligiendo/mapa:z-30 md:group-data-panel/mapa:left-[calc(27rem+0.5rem)] md:group-data-panel-ancho/mapa:left-[calc(min(46rem,100vw-8rem)+0.5rem)]">
        <PliegueDeCreditos value={pliegue}>{props.atribucion}</PliegueDeCreditos>
      </div>

      <div class="max-md:group-data-eligiendo/mapa:hidden">{props.panel}</div>

      {props.dialogo}
    </div>
  );
}
