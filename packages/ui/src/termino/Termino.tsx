import {
  GLOSARIO,
  primeraVez,
  type Termino as CualTermino,
  type TextoMarcado,
} from "@celda/dominio/glosario";
import { type JSX, Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js";

import { BotonCerrar, variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { recursoFijo } from "../recurso.ts";
import { colocarExplicacion } from "./posicion.ts";

export interface TerminoProps {
  /** Qué entrada del glosario explica. */
  readonly termino: CualTermino;
  /** Las palabras que se subrayan, tal como van en la frase. */
  readonly children: JSX.Element;
}

/**
 * Un término técnico dentro de un texto (historia 53): sale subrayado y, al tocarlo o pulsarlo
 * con el teclado, abre su explicación llana con el término técnico al final. La explicación se
 * cierra con Escape, con la ✕ o tocando fuera, y devuelve el foco al término si lo tenía.
 */
export function Termino(props: TerminoProps) {
  const [abierto, setAbierto] = createSignal(false);
  const id = createUniqueId();
  let boton: HTMLButtonElement | undefined;

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={(elemento) => {
          boton = elemento;
        }}
        type="button"
        data-termino={props.termino}
        aria-haspopup="dialog"
        aria-expanded={abierto() ? "true" : "false"}
        aria-controls={abierto() ? id : undefined}
        onClick={() => setAbierto((antes) => !antes)}
        class={
          // Se puede tocar aunque vaya en una pieza que deja pasar los gestos al mapa.
          // La hoja del navegador quita a los botones las mayúsculas del título en el que van.
          "pointer-events-auto relative inline cursor-pointer rounded-sm text-left [text-transform:inherit] underline decoration-primario " +
          "decoration-dotted decoration-2 underline-offset-[0.22em] hover:decoration-solid " +
          "aria-expanded:bg-primario/15 aria-expanded:decoration-solid " +
          // El objetivo táctil crece por fuera de la palabra sin mover el texto, pero poco: en
          // letra pequeña, más se metería en la línea de al lado y taparía otro término.
          "after:absolute after:-inset-x-1 after:-inset-y-1 after:content-['']"
        }
      >
        {props.children}
      </button>
      <Show when={abierto()}>
        {/*
          Dentro de un diálogo modal, en el propio diálogo: lo de fuera queda inerte y la
          explicación no se podría tocar.
        */}
        <Portal mount={boton?.closest("dialog") ?? document.body}>
          <Explicacion id={id} termino={props.termino} ancla={boton} alCerrar={cerrar} />
        </Portal>
      </Show>
    </>
  );
}

interface ExplicacionProps {
  readonly id: string;
  readonly termino: CualTermino;
  readonly ancla: HTMLElement | undefined;
  readonly alCerrar: (devolverFoco: boolean) => void;
}

const DIANA_TEXTO =
  "font-mono text-xs font-semibold tracking-wide text-tinta-invertida underline " +
  "decoration-dotted underline-offset-4 hover:decoration-solid";

/**
 * La explicación abierta: flota junto al término sin taparlo, al final del documento (o del
 * diálogo modal que tenga el término) para que el panel no la recorte. Sus términos relacionados se abren en el mismo
 * sitio.
 */
function Explicacion(props: ExplicacionProps) {
  const [mostrado, setMostrado] = createSignal<CualTermino>(() => props.termino);
  const entrada = createMemo(() => GLOSARIO[mostrado()]);
  let caja: HTMLDialogElement | undefined;
  let cuerpo: HTMLDivElement | undefined;
  /** Recibe el foco al abrir: el lector de pantalla lee el nombre de la explicación. */
  let titulo: HTMLHeadingElement | undefined;

  /** Mide la explicación y la coloca junto al término. */
  const colocar = () => {
    if (caja === undefined || cuerpo === undefined || props.ancla === undefined) return;
    const ancla = props.ancla.getBoundingClientRect();
    const ventana = { ancho: window.innerWidth, alto: window.innerHeight };
    const provisional = colocarExplicacion(
      { izquierda: ancla.left, arriba: ancla.top, ancho: ancla.width, alto: ancla.height },
      0,
      ventana,
    );
    caja.style.width = `${provisional.ancho}px`;
    cuerpo.style.maxHeight = "";
    const colocacion = colocarExplicacion(
      { izquierda: ancla.left, arriba: ancla.top, ancho: ancla.width, alto: ancla.height },
      caja.offsetHeight,
      ventana,
    );
    caja.style.left = `${colocacion.izquierda}px`;
    caja.style.top = `${colocacion.arriba}px`;
    caja.style.setProperty("--pico", `${colocacion.pico}px`);
    cuerpo.style.maxHeight = `${colocacion.altoMaximo}px`;
    caja.dataset["lado"] = colocacion.lado;
    caja.dataset["colocada"] = "";
  };

  recursoFijo("termino:explicacion", () => {
    colocar();
    titulo?.focus({ preventScroll: true });

    const alPulsar = (evento: PointerEvent) => {
      const objetivo = evento.target;
      if (!(objetivo instanceof Node)) return;
      if (caja?.contains(objetivo) === true || props.ancla?.contains(objetivo) === true) return;
      props.alCerrar(false);
    };
    // En captura: el Escape cierra la explicación y no llega al panel, que se cerraría con él.
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Tab") {
        tabular(evento);
        return;
      }
      if (evento.key !== "Escape") return;
      evento.preventDefault();
      evento.stopPropagation();
      props.alCerrar(true);
    };
    let fotograma = 0;
    const recolocar = () => {
      cancelAnimationFrame(fotograma);
      fotograma = requestAnimationFrame(colocar);
    };
    document.addEventListener("pointerdown", alPulsar, true);
    document.addEventListener("keydown", alTeclear, true);
    window.addEventListener("resize", recolocar);
    window.addEventListener("scroll", recolocar, true);
    return () => {
      cancelAnimationFrame(fotograma);
      document.removeEventListener("pointerdown", alPulsar, true);
      document.removeEventListener("keydown", alTeclear, true);
      window.removeEventListener("resize", recolocar);
      window.removeEventListener("scroll", recolocar, true);
    };
  });

  // Al abrir un término relacionado cambia el alto: se vuelve a colocar y a enfocar.
  createEffect(
    () => mostrado(),
    () => {
      colocar();
      titulo?.focus({ preventScroll: true });
    },
    { defer: true },
  );

  /**
   * La explicación está al final del documento, así que Tab no sigue hacia fuera de ella: al
   * salir por un extremo, se cierra y el foco vuelve al término.
   */
  const tabular = (evento: KeyboardEvent) => {
    const activo = document.activeElement;
    if (caja === undefined || activo === null || !caja.contains(activo)) return;
    const controles = Array.from(caja.querySelectorAll("button"));
    const saleHaciaAtras = evento.shiftKey && (activo === titulo || activo === controles[0]);
    const saleHaciaDelante = !evento.shiftKey && activo === controles.at(-1);
    if (saleHaciaAtras || saleHaciaDelante) {
      // Tampoco llega al diálogo que la contenga, que daría la vuelta por su cuenta.
      evento.preventDefault();
      evento.stopPropagation();
      props.alCerrar(true);
    }
  };

  return (
    <dialog
      ref={(elemento) => {
        caja = elemento;
      }}
      open
      id={props.id}
      aria-labelledby={`${props.id}-titulo`}
      class={
        "group/explicacion invisible fixed top-0 left-0 z-50 m-0 border-0 bg-transparent p-0 font-texto " +
        "text-inherit outline-none drop-shadow-panel data-colocada:visible"
      }
    >
      <span
        aria-hidden="true"
        class={
          "absolute left-(--pico) size-3.5 -translate-x-1/2 rotate-45 bg-superficie-invertida " +
          "group-data-[lado=abajo]/explicacion:-top-1.5 group-data-[lado=arriba]/explicacion:-bottom-1.5"
        }
      />
      <div
        ref={(elemento) => {
          cuerpo = elemento;
        }}
        class={
          "chaflan flex flex-col gap-2 overflow-y-auto overscroll-contain bg-superficie-invertida " +
          "py-3 pr-2 pl-5 text-tinta-invertida [--corte:12px]"
        }
      >
        <div class="flex items-center gap-2.5">
          <span aria-hidden="true" class="hexagono size-2.5 shrink-0 bg-primario" />
          <h2
            ref={(elemento) => {
              titulo = elemento;
            }}
            id={`${props.id}-titulo`}
            tabindex="-1"
            class="font-titulo text-lg leading-6 tracking-wide outline-none"
          >
            {entrada().nombre}
          </h2>
          <div class="-my-2 ml-auto">
            <BotonCerrar alCerrar={() => props.alCerrar(true)} />
          </div>
        </div>
        <p class="pr-3 text-[0.9375rem] leading-relaxed">{entrada().explicacion}</p>
        <p class="pr-3 font-mono text-xs leading-5 text-tinta-invertida-suave">
          Término técnico:{" "}
          <span class="font-semibold text-tinta-invertida">{entrada().tecnico}</span>
        </p>
        <Show when={entrada().relacionados.length > 0}>
          <div class="-mb-2 flex flex-wrap items-center gap-x-3 border-t border-tinta-invertida-suave/30 pr-3">
            <span class="w-full pt-2 font-mono text-xs text-tinta-invertida-suave">
              Ver también
            </span>
            <For each={entrada().relacionados}>
              {(relacionado) => (
                <button
                  type="button"
                  onClick={() => setMostrado(relacionado)}
                  class={cn(variantesDiana(), "justify-start", DIANA_TEXTO)}
                >
                  {GLOSARIO[relacionado].nombre}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </dialog>
  );
}

/**
 * Un texto con sus términos marcados: subraya la primera aparición de cada término y deja el
 * resto llano. Va por posición: el mismo texto vuelto a escribir, como con cada lectura del GPS,
 * no rehace sus términos, y una explicación abierta sigue abierta.
 */
export function TextoConTerminos(props: { readonly texto: TextoMarcado }) {
  return (
    <For each={primeraVez(props.texto)} keyed={false}>
      {(fragmento) => (
        <Show when={fragmento().termino} fallback={fragmento().texto}>
          {(termino) => <Termino termino={termino()}>{fragmento().texto}</Termino>}
        </Show>
      )}
    </For>
  );
}
