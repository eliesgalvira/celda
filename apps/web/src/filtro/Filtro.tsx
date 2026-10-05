import { Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  conmutarCompania,
  type FiltroDeCompanias,
  hayFiltro,
  SIN_FILTRO,
} from "@celda/dominio/filtro";
import {
  AvisoDeFiltro,
  ChipDeCompania,
  MenuDeCompanias,
  PanelDeCompanias,
} from "@celda/ui/filtro/FiltroDeCompanias.tsx";
import { For, Show } from "solid-js";

import { detalleDelAviso, ETIQUETA_TODAS, estadoDelFiltro, textoDelAviso } from "./textos.ts";

/**
 * La pastilla «Compañías» con sus chips (ADR 0026): «Todas» y una por compañía. Desde todas,
 * tocar una deja solo esa; después, cada toque la añade o la quita.
 */
export function ControlDeCompanias(props: {
  readonly filtro: FiltroDeCompanias;
  readonly disabled: boolean;
  readonly alElegir: (filtro: FiltroDeCompanias) => void;
}) {
  return (
    <MenuDeCompanias activo={hayFiltro(props.filtro)} disabled={props.disabled}>
      <PanelDeCompanias
        estado={estadoDelFiltro(props.filtro)}
        todas={
          <ChipDeCompania
            etiqueta={ETIQUETA_TODAS}
            pulsado={!hayFiltro(props.filtro)}
            incluida
            onClick={() => props.alElegir(SIN_FILTRO)}
          />
        }
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
      </PanelDeCompanias>
    </MenuDeCompanias>
  );
}

/**
 * El aviso de filtro puesto, bajo la fecha de los datos: qué compañías se ven y «Ver todas», que
 * lo quita de un toque, y una línea solo si algo sorprendería. Sin filtro no se ve.
 */
export function AvisoDelFiltro(props: {
  readonly filtro: FiltroDeCompanias;
  /** De lejos, con unos datos de antes, los números aún son de todas las compañías. */
  readonly deLejosSinFiltrar: boolean;
  readonly alQuitar: () => void;
}) {
  return (
    <Show when={hayFiltro(props.filtro)}>
      <AvisoDeFiltro
        texto={textoDelAviso(props.filtro)}
        detalle={detalleDelAviso(props.filtro, props.deLejosSinFiltrar)}
        alQuitar={() => props.alQuitar()}
      />
    </Show>
  );
}
