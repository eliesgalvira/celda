import { createContext, createUniqueId, For, Show, useContext } from "solid-js";

import { variantesDiana } from "./Boton.tsx";
import { cn } from "./cn.ts";

export interface Credito {
  readonly texto: string;
  readonly enlace: string;
  /** Qué datos son, para quien pasa el puntero o usa un lector de pantalla. */
  readonly detalle?: string;
  /** Lo que se escribe en el móvil, donde los créditos tienen poco sitio, si es más corto. */
  readonly corto?: string;
  /**
   * Si se ve también con los créditos plegados en el móvil, junto al botón «i». Lo pide la licencia
   * del mapa base de reserva del IGN: su crédito, a pie de mapa.
   */
  readonly fijo?: boolean;
}

/**
 * En el móvil los créditos se pliegan tras un botón «i». Se ven al cargar y se pliegan al tocar
 * el mapa o a los cinco segundos, como permiten las pautas de atribución de OpenStreetMap. En
 * escritorio se ven siempre. Lo decide `DisposicionMapa`, que sabe cuándo se toca el mapa; sin
 * ella, los créditos no se pliegan.
 */
export interface PliegueCreditos {
  readonly plegada: () => boolean;
  readonly cambiar: (plegada: boolean) => void;
}

export const PliegueDeCreditos = createContext<PliegueCreditos | undefined>(undefined);

export interface AtribucionProps {
  readonly creditos: ReadonlyArray<Credito>;
}

/** El texto de un crédito: entero y, en el móvil, el corto si lo tiene. */
function TextoDelCredito(props: { readonly credito: Credito }) {
  return (
    <Show when={props.credito.corto} fallback={<>© {props.credito.texto}</>}>
      {(corto) => (
        <>
          <span class="max-md:hidden">© {props.credito.texto}</span>
          <span class="md:hidden">© {corto()}</span>
        </>
      )}
    </Show>
  );
}

const ENLACE =
  "inline-flex min-h-6 items-center underline-offset-2 hover:text-primario-texto hover:underline";
const CINTA =
  "cinta flex flex-wrap items-center gap-x-2 bg-superficie/90 px-3 py-0.5 font-mono text-[10.5px] text-tinta [--pico:6px]";

/**
 * Los créditos de los datos del mapa, siempre a la vista o a un toque del botón «i». Los que son
 * `fijo` se ven también plegados, en una línea junto al botón.
 */
export function Atribucion(props: AtribucionProps) {
  const id = createUniqueId();
  const pliegue = useContext(PliegueDeCreditos);
  const plegable = () => pliegue !== undefined;
  const plegada = () => plegable() && pliegue?.plegada() === true;
  const fijos = () => props.creditos.filter((credito) => credito.fijo === true);
  return (
    <div class="flex items-end gap-1">
      <Show when={plegable()}>
        <button
          type="button"
          aria-expanded={plegada() ? "false" : "true"}
          aria-controls={id}
          title="Créditos del mapa"
          class={variantesDiana({ class: "drop-shadow-marcador md:hidden" })}
          onClick={() => pliegue?.cambiar(!plegada())}
        >
          <span
            aria-hidden="true"
            class="chaflan grid size-8 bg-control-borde p-[2px] [--corte:6px]"
          >
            <span class="chaflan grid place-items-center bg-control font-titulo text-lg leading-none font-semibold text-control-tinta italic [--corte:5px] group-hover:bg-control-hover">
              i
            </span>
          </span>
          <span class="sr-only">Créditos del mapa</span>
        </button>
      </Show>
      <p
        id={id}
        class={cn(
          CINTA,
          // En el móvil, abiertos, pueden quedar sobre la pista o la vista: fondo opaco.
          plegable() && "max-md:bg-superficie",
          plegada() && "max-md:hidden",
        )}
      >
        <For each={props.creditos}>
          {(credito) => (
            <a
              href={credito.enlace}
              title={credito.detalle}
              target="_blank"
              rel="noreferrer"
              class={ENLACE}
            >
              <TextoDelCredito credito={credito} />
            </a>
          )}
        </For>
      </p>
      <Show when={plegada() && fijos().length > 0}>
        <p class={cn(CINTA, "flex-nowrap whitespace-nowrap md:hidden")}>
          <For each={fijos()}>
            {(credito) => (
              <a
                href={credito.enlace}
                title={credito.detalle}
                target="_blank"
                rel="noreferrer"
                class={ENLACE}
              >
                © {credito.corto ?? credito.texto}
              </a>
            )}
          </For>
        </p>
      </Show>
    </div>
  );
}
