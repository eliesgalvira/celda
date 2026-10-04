import type { AportacionCompartible } from "@celda/dominio/aportacion";
import { DEDICACION_CC0 } from "@celda/dominio/licencias";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import {
  AccionesDelPaso,
  DedicacionCc0,
  QueSale,
  ResultadoDelEnvio,
} from "@celda/ui/buzon/Compartir.tsx";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { createSignal, Match, Show, Switch } from "solid-js";

import { usarDatos } from "../datos.tsx";
import { fechaYHora, queSale, type TextosDelFallo, textosDelFallo } from "./textos.ts";
import { Sincronizacion } from "./sincronizacion.ts";

type EstadoDelEnvio =
  | { readonly tipo: "listo" }
  | { readonly tipo: "enviando" }
  | { readonly tipo: "enviada"; readonly compartidaEl: number }
  | { readonly tipo: "fallo"; readonly textos: TextosDelFallo };

export interface PasoCompartirProps {
  readonly aportacion: AportacionCompartible;
  /** El botón de salir del paso: «Volver» a la lista o al formulario, o «Cerrar». */
  readonly textoSalir: string;
  readonly alSalir: () => void;
  /** Se llama cuando el buzón la ha recibido. */
  readonly alCompartir?: () => void;
  /**
   * Sale después de enviarla, con el botón «Hecho». Sin él, sale como `alSalir`: volver al
   * formulario de una corrección ya enviada no tiene sentido.
   */
  readonly alTerminar?: () => void;
}

/**
 * El paso de compartir una aportación (ADR 0020 y 0021): qué números salen del dispositivo, qué
 * no sale y la dedicación CC0, todo antes del botón de enviar. Enviar la guarda antes en el
 * dispositivo, así que si el buzón no la recibe se queda ahí. El cliente de Convex se descarga al
 * pulsar «Enviar» la primera vez, no al abrir este paso.
 */
export function PasoCompartir(props: PasoCompartirProps) {
  const datos = usarDatos();
  const [estado, setEstado] = createSignal<EstadoDelEnvio>({ tipo: "listo" });

  const enviar = () => {
    if (datos === undefined || estado().tipo === "enviando") return;
    setEstado({ tipo: "enviando" });
    void datos
      .runPromiseExit(Effect.flatMap(Sincronizacion, (s) => s.compartir(props.aportacion)))
      .then((salida) => {
        if (Exit.isSuccess(salida)) {
          setEstado({ tipo: "enviada", compartidaEl: salida.value.compartidaEl });
          props.alCompartir?.();
          return;
        }
        const fallo = Option.getOrUndefined(Cause.findErrorOption(salida.cause));
        setEstado({
          tipo: "fallo",
          textos:
            fallo === undefined
              ? {
                  titulo: "No se ha podido enviar",
                  texto: "Algo ha fallado en Celda. Se queda guardada en este dispositivo.",
                }
              : // Fuera de Effect, en el manejador: la hora del navegador al llegar el fallo.
                // @effect-diagnostics-next-line globalDate:off
                textosDelFallo(fallo, Date.now()),
        });
      });
  };

  const esMedida = () => props.aportacion.tipo === "propia";

  return (
    <>
      <QueSale titulo="Lo que sale de tu dispositivo" datos={queSale(props.aportacion)}>
        <Show when={esMedida()}>
          <p>Solo se envían estos números. La captura se queda en tu dispositivo.</p>
        </Show>
        <p>
          Se envía con un identificador anónimo que el buzón asigna a este dispositivo. No lleva tu
          nombre y no hace falta cuenta. Celda no guarda tu dirección IP. Para aplicar los límites
          de envío guarda una huella cifrada de ella, que cambia cada día y se borra a las 24 horas.
        </p>
        <p>
          {esMedida()
            ? "La medida no se publica por separado. Celda solo publica resúmenes que reúnen muchas medidas."
            : "Enviarla no cambia el mapa. Primero la revisa la moderación y, si la acepta, aparece junto a lo que dice el registro oficial."}
        </p>
      </QueSale>
      <DedicacionCc0 enlace={DEDICACION_CC0.enlace}>
        <p>
          Al enviarla, la dedicas al dominio público con la {DEDICACION_CC0.nombre}. Eso permite que
          cualquiera la use y la modifique sin pedirte permiso y sin citarte.
        </p>
        <p>Una vez enviada, no se puede retirar del dominio público.</p>
      </DedicacionCc0>
      <AccionesDelPaso>
        <Show
          when={estado().tipo !== "enviada"}
          fallback={
            <Boton
              variante="secundario"
              onClick={() =>
                props.alTerminar === undefined ? props.alSalir() : props.alTerminar()
              }
            >
              Hecho
            </Boton>
          }
        >
          <Boton variante="destacado" cargando={estado().tipo === "enviando"} onClick={enviar}>
            {estado().tipo === "fallo" ? "Intentar otra vez" : "Enviar al dominio público"}
          </Boton>
          <Boton variante="secundario" onClick={() => props.alSalir()}>
            {props.textoSalir}
          </Boton>
        </Show>
      </AccionesDelPaso>
      <ResultadoDelEnvio>
        <Switch>
          <Match when={estado().tipo === "enviando"}>
            <Aviso tono="espera" encaje="panel" titulo="Enviando al buzón de Celda…" />
          </Match>
          <Match
            when={(() => {
              const actual = estado();
              return actual.tipo === "enviada" ? actual : undefined;
            })()}
          >
            {(enviada) => (
              <Aviso tono="hecho" encaje="panel" titulo="Recibida">
                El buzón la recibió el {fechaYHora(enviada().compartidaEl)}. Hasta que la revise la
                moderación, el mapa no cambia.
              </Aviso>
            )}
          </Match>
          <Match
            when={(() => {
              const actual = estado();
              return actual.tipo === "fallo" ? actual.textos : undefined;
            })()}
          >
            {(textos) => (
              <Aviso tono="fallo" encaje="panel" titulo={textos().titulo}>
                {textos().texto}
              </Aviso>
            )}
          </Match>
        </Switch>
      </ResultadoDelEnvio>
    </>
  );
}
