import { type Corroboracion, ESQUEMA_CORROBORACION } from "@celda/dominio/aportacion";
import { Dialogo } from "@celda/ui/Dialogo.tsx";
import { EsqueletoAportaciones } from "@celda/ui/buzon/Compartir.tsx";
import { recursoFijo } from "@celda/ui/recurso.ts";
import * as Exit from "effect/Exit";
import { createSignal, Show } from "solid-js";

import { usarDatos } from "../datos.tsx";
import { nuevaAportacion } from "../ubicacion/almacen.ts";
import { PasoCompartir } from "./PasoCompartir.tsx";

export interface DialogoCorroborarProps {
  /** El emplazamiento de la ficha. */
  readonly emplazamiento: string;
  /** La clave de la corrección publicada que se respalda. */
  readonly correccion: string;
  /** Lo que dice la corrección, en una frase. */
  readonly dice: string;
  readonly alCerrar: () => void;
}

/**
 * Respaldar una corrección que la ficha ya enseña («yo también lo veo»). Suma una persona a las
 * que la sostienen si la moderación lo acepta (ADR 0020).
 */
export function DialogoCorroborar(props: DialogoCorroborarProps) {
  const datos = usarDatos();
  const [borrador, setBorrador] = createSignal<Corroboracion>();
  recursoFijo("buzon:corroboracion", () => {
    const parar = new AbortController();
    void datos
      ?.runPromiseExit(
        nuevaAportacion({
          tipo: "corroboracion",
          esquema: ESQUEMA_CORROBORACION,
          origen: "ficha",
          emplazamiento: props.emplazamiento,
          correccion: props.correccion,
        }),
        { signal: parar.signal },
      )
      .then((salida) => {
        if (Exit.isSuccess(salida)) setBorrador(salida.value);
      });
    return () => parar.abort();
  });
  return (
    <Dialogo titulo="Yo también lo veo" antetitulo="COMUNIDAD" alCerrar={props.alCerrar}>
      <p>Respaldas esta corrección de la comunidad: «{props.dice}».</p>
      <Show when={borrador()} fallback={<EsqueletoAportaciones />}>
        {(corroboracion) => (
          <PasoCompartir
            aportacion={corroboracion()}
            textoSalir="Cancelar"
            alSalir={props.alCerrar}
          />
        )}
      </Show>
    </Dialogo>
  );
}
