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
        descripcion="Para quien estudia redes móviles. Añade a los controles del mapa un ejercicio sobre un municipio o un barrio: estaciones base por compañía, radio, habitantes y usuarios por estación, con una tabla para descargar."
        encendido={control?.ajustes().modoEstudiante ?? false}
        disabled={control === undefined}
        alCambiar={(encendido) => control?.cambiarModoEstudiante(encendido)}
      />
      <Show when={control?.sinGuardar()}>
        <Nota tono="aviso" titulo="No se ha podido guardar">
          <p>
            Este navegador no deja guardar datos de Celda. El cambio vale hasta que cierres la
            página.
          </p>
        </Nota>
      </Show>
      <Nota>
        <p>
          Se guarda solo en este dispositivo, sin cuenta. Lo puedes apagar aquí mismo cuando
          quieras.
        </p>
      </Nota>
    </Dialogo>
  );
}
