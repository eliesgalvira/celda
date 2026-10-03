import { Dialogo } from "@celda/ui/Dialogo.tsx";

import { type EmplazamientoACorregir, Proponer } from "./Proponer.tsx";

export interface DialogoProponerProps {
  readonly emplazamiento: EmplazamientoACorregir;
  readonly alCerrar: () => void;
  /** Cierra el diálogo para marcar en el mapa el punto propuesto. */
  readonly alElegirPunto: () => void;
}

/** Proponer una corrección de un emplazamiento, desde su ficha. */
export function DialogoProponer(props: DialogoProponerProps) {
  return (
    <Dialogo titulo="Proponer una corrección" antetitulo="COMUNIDAD" alCerrar={props.alCerrar}>
      <Proponer
        emplazamiento={props.emplazamiento}
        textoSalir="Cancelar"
        alSalir={props.alCerrar}
        alElegirPunto={props.alElegirPunto}
      />
    </Dialogo>
  );
}
