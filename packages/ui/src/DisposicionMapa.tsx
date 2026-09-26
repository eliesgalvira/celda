import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

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
  readonly controles: JSX.Element;
  /**
   * Controles que van al final de la columna, como los ajustes. En el móvil se esconden mientras
   * se ve el panel de una vista: la columna entera no cabría encima de él.
   */
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

/**
 * La pantalla del mapa a pantalla completa, en móvil y en escritorio. Cada
 * pieza tiene su sitio fijo desde el primer momento, así que nada salta al
 * cargar: el fondo ya tiene el color del mapa y el aviso se superpone.
 */
export function DisposicionMapa(props: DisposicionMapaProps) {
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
        En el móvil, a la izquierda, a la altura de los controles y sin llegar a su columna, que
        ocupa unos 7rem con sus etiquetas. En escritorio, centrada en lo que deja libre el panel.
      */}
      <Show when={props.pista} keyed>
        <div class="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-10 flex justify-start pr-28 pl-3 max-md:group-data-hoja/mapa:bottom-[calc(11.75rem+4rem)] md:bottom-16 md:justify-center md:px-16 md:group-data-panel/mapa:pl-[calc(27rem+1rem)] md:group-data-panel-ancho/mapa:pl-[calc(min(46rem,100vw-8rem)+1rem)]">
          {props.pista}
        </div>
      </Show>

      {/* Con clave: cada aviso nuevo es un elemento nuevo, no uno que se mueve. */}
      <Show when={props.aviso} keyed>
        <div class="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4">
          <div class="pointer-events-auto">{props.aviso}</div>
        </div>
      </Show>

      {/*
        11.75rem es el alto del resumen de la hoja (`ALTO_RESUMEN`, 188 px). En el móvil los
        créditos ocupan dos líneas y los controles quedan por encima de ellas.
      */}
      <Show when={props.vista}>
        {/*
          En el móvil, 22.5rem de alto sobre los créditos (dos líneas, unos 3rem). En escritorio, a
          la izquierda de la columna de controles, que con sus etiquetas ocupa unos 7rem.
        */}
        <div class="absolute inset-x-2 bottom-[3.25rem] z-10 h-[22.5rem] max-md:group-data-eligiendo/mapa:hidden max-md:group-data-hoja/mapa:hidden md:inset-x-auto md:right-32 md:bottom-16 md:h-auto md:max-h-[calc(100%-6rem)] md:w-[22rem]">
          {props.vista}
        </div>
      </Show>

      <div class="absolute right-2 bottom-[4.5rem] z-10 flex flex-col items-center gap-2 max-md:group-data-hoja/mapa:bottom-[calc(11.75rem+4rem)] max-md:group-data-vista/mapa:bottom-[calc(22.5rem+3.75rem)] max-md:group-data-vista/mapa:gap-0 max-md:group-data-eligiendo/mapa:hidden md:right-[18px] md:bottom-16">
        {props.controles}
        <div class="contents max-md:group-data-vista/mapa:hidden">{props.controlesSecundarios}</div>
      </div>

      {/* Mientras se elige en el móvil, los créditos quedan por encima de la hoja, en su pie. */}
      <div class="absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 z-10 max-w-[calc(100%-1rem)] max-md:group-data-hoja/mapa:bottom-[calc(11.75rem+0.5rem)] max-md:group-data-eligiendo/mapa:z-30 md:group-data-panel/mapa:left-[calc(27rem+0.5rem)] md:group-data-panel-ancho/mapa:left-[calc(min(46rem,100vw-8rem)+0.5rem)]">
        {props.atribucion}
      </div>

      <div class="max-md:group-data-eligiendo/mapa:hidden">{props.panel}</div>

      {props.dialogo}
    </div>
  );
}
