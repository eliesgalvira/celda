import { Dialogo } from "@celda/ui/Dialogo.tsx";
import { Interruptor } from "@celda/ui/Eleccion.tsx";
import { Nota } from "@celda/ui/medir/Medir.tsx";
import { Show, useContext } from "solid-js";

import { AjustesContexto } from "./ajustes.ts";

/**
 * Los ajustes del dispositivo. Por ahora, solo el modo estudiante (historia 54): discreto,
 * apagado por defecto y guardado en el dispositivo. Apagarlo es igual de fácil que encenderlo.
 */
export function DialogoAjustes(props: { readonly alCerrar: () => void }) {
  const control = useContext(AjustesContexto);
  return (
    <Dialogo titulo="Ajustes" antetitulo="ESTE DISPOSITIVO" alCerrar={props.alCerrar}>
      <Interruptor
        etiqueta="Modo estudiante"
        descripcion="Añade un ejercicio que calcula, para un municipio o un barrio, las estaciones base de cada compañía, su radio de cobertura y los usuarios por estación."
        encendido={control?.ajustes().modoEstudiante ?? false}
        disabled={control === undefined}
        alCambiar={(encendido) => control?.cambiarModoEstudiante(encendido)}
      />
      <Show when={control?.sinGuardar()}>
        <Nota tono="aviso" titulo="No se ha podido guardar">
          <p>Este navegador no deja guardar datos. El cambio durará hasta que cierres la página.</p>
        </Nota>
      </Show>
    </Dialogo>
  );
}
