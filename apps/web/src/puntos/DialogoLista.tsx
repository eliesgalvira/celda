import { centroDelRectangulo, type Rectangulo } from "@celda/dominio/area";
import { type FiltroDeCompanias, mascarasDeFiltro } from "@celda/dominio/filtro";
import type { PuntosLeidos } from "@celda/dominio/puntos";
import { Dialogo } from "@celda/ui/Dialogo.tsx";
import { FilaDeEmplazamiento, ListaDeEmplazamientos } from "@celda/ui/puntos/Puntos.tsx";
import { createMemo, For } from "solid-js";

import { listaDePuntos } from "./puntos.ts";
import {
  deLaRedUsada,
  dondeQueda,
  nombreDeCompanias,
  resumenDeLaLista,
  TITULO_DE_LA_LISTA,
} from "./textos.ts";

/**
 * Los emplazamientos que se ven, en una lista de botones (ADR 0028): el camino para llegar a uno
 * con el teclado o con un lector de pantalla en la vista de puntos, donde los puntos no son
 * botones. Lista lo que se veía al abrirla, del más cercano al centro al más lejano, con el filtro
 * de compañías. Elegir uno lo cierra y abre su ficha.
 */
export function DialogoLista(props: {
  readonly puntos: PuntosLeidos;
  /** Lo que se ve del mapa, o nada si aún no se sabe. */
  readonly caja: Rectangulo | undefined;
  readonly filtro: FiltroDeCompanias;
  readonly alElegir: (indice: number) => void;
  readonly alCerrar: () => void;
}) {
  const lista = createMemo(() => {
    const caja = props.caja;
    if (caja === undefined) return { total: 0, primeros: [] };
    return listaDePuntos(
      props.puntos,
      caja,
      centroDelRectangulo(caja),
      mascarasDeFiltro(props.filtro),
    );
  });
  return (
    <Dialogo titulo={TITULO_DE_LA_LISTA} alCerrar={props.alCerrar}>
      <ListaDeEmplazamientos resumen={resumenDeLaLista(lista())}>
        <For each={lista().primeros} keyed={(punto) => punto.indice}>
          {(punto) => (
            <FilaDeEmplazamiento
              companias={punto().companias}
              nombre={nombreDeCompanias(punto().companias)}
              detalle={dondeQueda(punto())}
              redUsada={deLaRedUsada(punto(), props.filtro)}
              alElegir={() => props.alElegir(punto().indice)}
            />
          )}
        </For>
      </ListaDeEmplazamientos>
    </Dialogo>
  );
}
