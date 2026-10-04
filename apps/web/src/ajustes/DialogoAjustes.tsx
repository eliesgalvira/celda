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
        descripcion="Está pensado para quien estudia redes móviles. Añade a los controles del mapa un ejercicio que calcula, para un municipio o un barrio, las estaciones base de cada compañía, su radio de cobertura y los usuarios por estación. Los resultados se pueden descargar en una tabla."
        encendido={control?.ajustes().modoEstudiante ?? false}
        disabled={control === undefined}
        alCambiar={(encendido) => control?.cambiarModoEstudiante(encendido)}
      />
      <Show when={control?.sinGuardar()}>
        <Nota tono="aviso" titulo="No se ha podido guardar">
          <p>
            Este navegador no deja a Celda guardar datos. El cambio se mantendrá hasta que cierres
            la página.
          </p>
        </Nota>
      </Show>
      <Nota>
        <p>
          El ajuste se guarda solo en este dispositivo y no necesita cuenta. Puedes desactivarlo
          aquí cuando quieras.
        </p>
      </Nota>
    </Dialogo>
  );
}
