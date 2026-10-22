import { Dialogo } from "@celda/ui/Dialogo.tsx";
import {
  Corredera,
  IconoTemaClaro,
  IconoTemaOscuro,
  IconoTemaSistema,
  Interruptor,
  type OpcionDeCorredera,
} from "@celda/ui/Eleccion.tsx";
import { Nota } from "@celda/ui/medir/Medir.tsx";
import type { EleccionDeTema } from "@celda/ui/temaElegido.ts";
import { Show, useContext } from "solid-js";

import { AjustesContexto } from "./ajustes.ts";
import type { ControlTema } from "./tema.ts";

/**
 * Los ajustes del dispositivo: el tema, que sigue al sistema si no se elige otro (#76), y el modo
 * estudiante (historia 54), discreto, apagado por defecto y guardado en el dispositivo. Apagarlo
 * es igual de fácil que encenderlo.
 */
export function DialogoAjustes(props: {
  readonly tema: ControlTema;
  readonly alCerrar: () => void;
}) {
  const control = useContext(AjustesContexto);
  const temas: ReadonlyArray<OpcionDeCorredera<EleccionDeTema>> = [
    { valor: "sistema", etiqueta: "Sistema", icono: <IconoTemaSistema /> },
    { valor: "claro", etiqueta: "Claro", icono: <IconoTemaClaro /> },
    { valor: "oscuro", etiqueta: "Oscuro", icono: <IconoTemaOscuro /> },
  ];
  return (
    <Dialogo titulo="Ajustes" antetitulo="ESTE DISPOSITIVO" alCerrar={props.alCerrar}>
      <Corredera
        leyenda="Tema"
        opciones={temas}
        valor={props.tema.eleccion()}
        alCambiar={(eleccion) => props.tema.elegir(eleccion)}
      />
      <Interruptor
        etiqueta="Modo estudiante"
        descripcion="Añade un ejercicio que calcula, para un municipio o un barrio, las estaciones base de cada compañía, su radio de cobertura y los usuarios por estación."
        encendido={control.ajustes().modoEstudiante}
        alCambiar={(encendido) => control.cambiarModoEstudiante(encendido)}
      />
      <Show when={control.sinGuardar() || props.tema.sinGuardar()}>
        <Nota tono="aviso" titulo="No se ha podido guardar">
          <p>Este navegador no deja guardar datos. El cambio durará hasta que cierres la página.</p>
        </Nota>
      </Show>
    </Dialogo>
  );
}
