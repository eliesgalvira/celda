import { Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  conmutarCompania,
  type FiltroDeCompanias,
  hayFiltro,
  SIN_FILTRO,
  SIN_RED_PROPIA,
  type SinRedPropia,
} from "@celda/dominio/filtro";
import {
  AvisoDeFiltro,
  ChipDeCompania,
  MenuDeCompanias,
} from "@celda/ui/filtro/FiltroDeCompanias.tsx";
import { For, Show } from "solid-js";

import { detalleDelAviso, ETIQUETA_TODAS, estadoDelFiltro, textoDelAviso } from "./textos.ts";

/**
 * La pastilla «Compañías» con sus chips (ADR 0026): «Todas» y una por compañía. Desde todas,
 * tocar una deja solo esa; después, cada toque la añade o la quita. Tocar una compañía sin red
 * propia deja solo la de su red.
 */
export function ControlDeCompanias(props: {
  readonly filtro: FiltroDeCompanias;
  readonly disabled: boolean;
  readonly alElegir: (filtro: FiltroDeCompanias, sinRedPropia?: SinRedPropia) => void;
}) {
  return (
    <MenuDeCompanias
      activo={hayFiltro(props.filtro)}
      disabled={props.disabled}
      estado={estadoDelFiltro(props.filtro)}
      todas={
        <ChipDeCompania
          etiqueta={ETIQUETA_TODAS}
          pulsado={!hayFiltro(props.filtro)}
          incluida
          onClick={() => props.alElegir(SIN_FILTRO)}
        />
      }
      sinRedPropia={SIN_RED_PROPIA}
      alElegirSinRedPropia={(eleccion) => props.alElegir([eleccion.red], eleccion)}
    >
      <For each={Compania.literals}>
        {(compania) => (
          <ChipDeCompania
            compania={compania}
            etiqueta={NOMBRE_COMPANIA[compania]}
            pulsado={props.filtro.includes(compania)}
            incluida={!hayFiltro(props.filtro) || props.filtro.includes(compania)}
            onClick={() => props.alElegir(conmutarCompania(props.filtro, compania))}
          />
        )}
      </For>
    </MenuDeCompanias>
  );
}

/**
 * El aviso de filtro puesto, bajo la fecha de los datos: qué compañías se ven y «Ver todas», que
 * lo quita de un toque, y una línea solo si algo sorprendería. Sin filtro no se ve.
 */
export function AvisoDelFiltro(props: {
  readonly filtro: FiltroDeCompanias;
  /** La compañía sin red propia que puso el filtro, si es la última forma en que cambió. */
  readonly sinRedPropia: SinRedPropia | undefined;
  readonly alQuitar: () => void;
}) {
  return (
    <Show when={hayFiltro(props.filtro)}>
      <AvisoDeFiltro
        texto={textoDelAviso(props.filtro)}
        detalle={detalleDelAviso(props.filtro, props.sinRedPropia)}
        alQuitar={() => props.alQuitar()}
      />
    </Show>
  );
}
