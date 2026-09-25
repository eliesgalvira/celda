/** La marca de Celda: un hexágono dentro de otro. */
export function MarcaCelda() {
  return (
    <svg
      width="26"
      height="28"
      viewBox="0 0 26 28"
      aria-hidden="true"
      class="shrink-0 text-primario"
    >
      <polygon
        points="13,1 25,7.5 25,20.5 13,27 1,20.5 1,7.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <polygon points="13,8 19,11.5 19,16.5 13,20 7,16.5 7,11.5" fill="currentColor" />
    </svg>
  );
}

export interface CabeceraProps {
  /** El sitio que enseña el mapa, como «Barcelona» o el nombre de un barrio. */
  readonly lugar: string;
}

/** La cinta de arriba del mapa con la marca y el lugar. No tapa los gestos del mapa. */
export function Cabecera(props: CabeceraProps) {
  return (
    <header class="cinta pointer-events-none flex items-center gap-3.5 bg-superficie py-1.5 pr-4 pl-2.5 [--pico:14px] md:py-2 md:pr-[22px] md:pl-3">
      <MarcaCelda />
      <h1 class="font-mono text-[13px] font-semibold tracking-[0.3em] text-primario-texto max-md:sr-only">
        CELDA
      </h1>
      <p class="font-titulo text-base tracking-[0.08em] text-tinta md:text-xl">{props.lugar}</p>
    </header>
  );
}
