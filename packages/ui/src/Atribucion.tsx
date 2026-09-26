import { For } from "solid-js";

export interface Credito {
  readonly texto: string;
  readonly enlace: string;
  /** Qué datos son, para quien pasa el puntero o usa un lector de pantalla. */
  readonly detalle?: string;
}

export interface AtribucionProps {
  readonly creditos: ReadonlyArray<Credito>;
}

/** Los créditos de los datos del mapa, siempre a la vista. */
export function Atribucion(props: AtribucionProps) {
  return (
    <p class="cinta flex flex-wrap items-center gap-x-2 bg-superficie/90 px-3 py-0.5 font-mono text-[10.5px] text-tinta [--pico:6px]">
      <For each={props.creditos}>
        {(credito) => (
          <a
            href={credito.enlace}
            title={credito.detalle}
            target="_blank"
            rel="noreferrer"
            class="inline-flex min-h-6 items-center underline-offset-2 hover:text-primario-texto hover:underline"
          >
            © {credito.texto}
          </a>
        )}
      </For>
    </p>
  );
}
