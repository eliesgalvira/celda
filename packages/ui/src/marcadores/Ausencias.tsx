import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { For } from "solid-js";

import { LogoCompanias } from "./LogoCompanias.tsx";

/**
 * Cómo se dice que faltan unas compañías: «sin Digi», «sin Vodafone ni Digi», «sin Movistar,
 * Vodafone ni Digi». Sin ninguna, la cadena vacía.
 */
export const textoDeAusencias = (companias: ReadonlyArray<Compania>): string => {
  const nombres = companias.map((c) => NOMBRE_COMPANIA[c]);
  if (nombres.length === 0) return "";
  if (nombres.length === 1) return `sin ${nombres[0] ?? ""}`;
  return `sin ${nombres.slice(0, -1).join(", ")} ni ${nombres.at(-1) ?? ""}`;
};

/**
 * La marca de ausencia: un círculo oscuro con una × blanca, en la esquina inferior derecha de lo
 * que marca y fuera de su dibujo: en un logo de 20 px, el círculo de la marca no toca el del
 * logo. Nunca lo tacha. Quien la usa deja 6 px libres a la derecha y debajo.
 */
export function MarcaDeAusencia() {
  return (
    <span
      aria-hidden="true"
      class="absolute -right-1.5 -bottom-1.5 grid size-[9px] place-items-center rounded-full bg-superficie-invertida text-tinta-invertida ring-[1.5px] ring-superficie"
    >
      <svg viewBox="0 0 10 10" class="block size-[5px]">
        <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="2" />
      </svg>
    </span>
  );
}

/** Lado del logo de una compañía ausente, en píxeles. */
const LADO_LOGO = 20;

/**
 * Las compañías que no tienen ningún emplazamiento en un barrio: «sin» y el logo de cada una,
 * entero y nítido, con la marca de ausencia en su esquina (historia 8). Un lector de pantalla no
 * lee los logos sino el texto, «sin Vodafone ni Digi».
 */
export function Ausencias(props: { readonly companias: ReadonlyArray<Compania> }) {
  return (
    <span class="cinta inline-flex items-center gap-2.5 bg-superficie py-1.5 pr-3.5 pl-2.5 font-mono text-[11.5px] leading-5 text-tinta [--pico:6px]">
      <span class="sr-only">{textoDeAusencias(props.companias)}</span>
      <span aria-hidden="true">sin</span>
      <For each={props.companias}>
        {(compania) => (
          <span aria-hidden="true" class="relative inline-block shrink-0">
            <LogoCompanias companias={[compania]} tamano={LADO_LOGO} />
            <MarcaDeAusencia />
          </span>
        )}
      </For>
    </span>
  );
}
