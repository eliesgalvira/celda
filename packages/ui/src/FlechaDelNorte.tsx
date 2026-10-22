import { cva } from "class-variance-authority";

/** La tinta y el halo de los rótulos de ciudad, y sobre la foto aérea, los de la foto. */
const variantesFlecha = cva("block", {
  variants: {
    foto: {
      no: "text-rotulo-ciudad [--halo:var(--mapa-halo)]",
      si: "text-rotulo-foto [--halo:var(--mapa-foto-halo)]",
    },
  },
});

const PUNTA = "M12 16 L20 44 L12 38 L4 44 Z";

/**
 * La flecha del norte de los mapas impresos: una «N» sobre una punta con la mitad izquierda llena.
 * El mapa nunca gira (`mapa/mapaBase.ts`), así que siempre apunta arriba. Lleva el halo de los
 * rótulos para leerse sobre cualquier calle.
 */
export function FlechaDelNorte(props: { readonly conFoto: boolean }) {
  return (
    <svg
      // Un dibujo SVG se anuncia como imagen con role="img"; un <img> no podría usar los tokens.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="img"
      aria-label="El norte queda arriba"
      width="24"
      height="46"
      viewBox="0 0 24 46"
      class={variantesFlecha({ foto: props.conFoto ? "si" : "no" })}
    >
      <g
        fill="var(--halo)"
        stroke="var(--halo)"
        stroke-width="4"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <text x="12" y="11" text-anchor="middle" class="font-rotulo text-[12.5px] font-bold">
          N
        </text>
        <path d={PUNTA} />
      </g>
      <text
        x="12"
        y="11"
        text-anchor="middle"
        fill="currentColor"
        class="font-rotulo text-[12.5px] font-bold"
        aria-hidden="true"
      >
        N
      </text>
      <path d="M12 16 L4 44 L12 38 Z" fill="currentColor" />
      <path
        d={PUNTA}
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}
