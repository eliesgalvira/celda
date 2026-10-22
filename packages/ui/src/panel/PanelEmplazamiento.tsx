import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

import { BotonCerrar } from "../Boton.tsx";
import { recursoFijo } from "../recurso.ts";
import {
  type AlturaHoja,
  alturaConTecla,
  alturaTrasArrastre,
  alturaTrasToque,
  altoDuranteArrastre,
  pixelesDeAltura,
} from "./hoja.ts";

/** Desplazamiento a partir del cual tocar el tirador pasa a ser arrastrarlo, en px. */
const UMBRAL_DE_ARRASTRE = 6;

interface Gesto {
  readonly puntero: number;
  readonly inicioY: number;
  readonly inicioAlto: number;
  alto: number;
  ultimoY: number;
  ultimoT: number;
  /** px/ms, positiva hacia arriba. */
  velocidad: number;
  movido: boolean;
}

export interface PanelEmplazamientoProps {
  /** Nombre accesible del panel. */
  readonly nombre: string;
  /** Altura de la hoja en el móvil. En escritorio el panel ocupa todo el alto. */
  readonly altura: AlturaHoja;
  readonly alCambiarAltura: (altura: AlturaHoja) => void;
  readonly alCerrar: () => void;
  /**
   * En escritorio, la columna de la ficha (27rem) o la del ejercicio, más ancha para que quepa su
   * tabla. Si es `ancho`, `DisposicionMapa` también lleva `panelAncho`.
   */
  readonly ancho?: "normal" | "ancho";
  readonly children: JSX.Element;
}

/**
 * El panel del emplazamiento: una columna a la izquierda en escritorio y una hoja inferior con
 * tres alturas en el móvil (historia 21). La hoja se cambia arrastrando el tirador, tocándolo o
 * con las flechas del teclado; Escape cierra el panel. Al abrirse se lleva el foco y al cerrarse
 * lo devuelve a donde estaba, normalmente el marcador.
 *
 * Arriba va una franja que no se desplaza, con la ✕ a la derecha y, en el móvil, el tirador debajo
 * de ella. Así la ✕ nunca tapa la ficha al desplazarla.
 */
export function PanelEmplazamiento(props: PanelEmplazamientoProps) {
  const [altoVentana, setAltoVentana] = createSignal(window.innerHeight);
  /** Alto mientras el dedo arrastra; sin arrastre, el de la altura elegida. */
  const [arrastre, setArrastre] = createSignal<number>();
  let panel: HTMLElement | undefined;
  let gesto: Gesto | undefined;
  // El `click` que sigue a soltar un arrastre no es un toque.
  let acabaDeArrastrar = false;

  recursoFijo("panel:ventana", () => {
    const medir = () => setAltoVentana(window.innerHeight);
    window.addEventListener("resize", medir);
    const previo = document.activeElement;
    panel?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("resize", medir);
      const perdido =
        document.activeElement === document.body || panel?.contains(document.activeElement);
      if (perdido === true && previo instanceof HTMLElement && previo.isConnected) {
        previo.focus({ preventScroll: true });
      }
    };
  });

  const empezar = (evento: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (evento.button !== 0) return;
    acabaDeArrastrar = false;
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
    const alto = panel?.getBoundingClientRect().height ?? 0;
    gesto = {
      puntero: evento.pointerId,
      inicioY: evento.clientY,
      inicioAlto: alto,
      alto,
      ultimoY: evento.clientY,
      ultimoT: evento.timeStamp,
      velocidad: 0,
      movido: false,
    };
  };

  const mover = (evento: PointerEvent) => {
    if (gesto?.puntero !== evento.pointerId) return;
    const desplazamiento = gesto.inicioY - evento.clientY;
    if (Math.abs(desplazamiento) >= UMBRAL_DE_ARRASTRE) gesto.movido = true;
    if (!gesto.movido) return;
    const intervalo = evento.timeStamp - gesto.ultimoT;
    if (intervalo > 0) gesto.velocidad = (gesto.ultimoY - evento.clientY) / intervalo;
    gesto.ultimoY = evento.clientY;
    gesto.ultimoT = evento.timeStamp;
    gesto.alto = altoDuranteArrastre(gesto.inicioAlto, desplazamiento, altoVentana());
    setArrastre(gesto.alto);
  };

  const soltar = (evento: PointerEvent) => {
    if (gesto?.puntero !== evento.pointerId) return;
    const acabado = gesto;
    gesto = undefined;
    if (!acabado.movido) return;
    acabaDeArrastrar = true;
    setArrastre(undefined);
    props.alCambiarAltura(
      alturaTrasArrastre({
        pixeles: acabado.alto,
        velocidad: acabado.velocidad,
        altoVentana: altoVentana(),
      }),
    );
  };

  /** Escape cierra el panel desde cualquier control de dentro. */
  const cerrarConEscape = (evento: KeyboardEvent) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      props.alCerrar();
    }
  };

  return (
    <aside
      ref={(elemento) => {
        panel = elemento;
        // Con un escuchador y no con `onKeyDown`: el panel no es un control, solo recoge el
        // Escape de los controles que tiene dentro.
        elemento.addEventListener("keydown", cerrarConEscape);
      }}
      tabindex="-1"
      aria-label={props.nombre}
      data-altura={props.altura}
      data-ancho={props.ancho ?? "normal"}
      data-arrastrando={arrastre() === undefined ? undefined : ""}
      style={{ "--alto-hoja": `${arrastre() ?? pixelesDeAltura(props.altura, altoVentana())}px` }}
      class={
        "group/panel fixed z-30 flex flex-col bg-superficie font-texto text-tinta outline-none drop-shadow-panel " +
        "max-md:inset-x-0 max-md:bottom-0 max-md:h-(--alto-hoja) max-md:transition-[height] max-md:duration-300 " +
        "max-md:ease-out max-md:data-arrastrando:transition-none motion-reduce:transition-none " +
        "md:inset-y-0 md:left-0 md:w-[27rem] md:data-[ancho=ancho]:w-[min(46rem,calc(100vw-8rem))]"
      }
    >
      <div class="relative flex min-h-11 shrink-0 justify-end bg-superficie-alta pr-1 md:pr-2">
        <button
          type="button"
          title="Arrastra o toca para cambiar la altura de la ficha"
          class={
            "absolute inset-0 flex cursor-grab touch-none flex-col items-center justify-center gap-1 select-none " +
            "active:cursor-grabbing md:hidden"
          }
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onClick={() => {
            if (acabaDeArrastrar) {
              acabaDeArrastrar = false;
              return;
            }
            props.alCambiarAltura(alturaTrasToque(props.altura));
          }}
          onKeyDown={(evento) => {
            const nueva = alturaConTecla(props.altura, evento.key);
            if (nueva !== undefined) {
              evento.preventDefault();
              props.alCambiarAltura(nueva);
            }
          }}
        >
          <span aria-hidden="true" class="h-1.5 w-11 rounded-full bg-linea-fuerte" />
          <span class="font-mono text-[11px] leading-none text-tinta-suave">
            {props.altura === "completa" ? "Ver menos" : "Ver más"}
          </span>
        </button>
        <div class="relative">
          <BotonCerrar alCerrar={() => props.alCerrar()} />
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:group-data-[altura=resumen]/panel:overflow-hidden">
        {props.children}
      </div>
    </aside>
  );
}
