import {
  type AportacionCompartible,
  esCompartible,
  TIPOS_COMPARTIBLES,
  type TipoCompartible,
} from "@celda/dominio/aportacion";
import { Boton } from "@celda/ui/Boton.tsx";
import {
  EsqueletoAportaciones,
  FilaAportacion,
  GrupoDeAportaciones,
  GrupoVacio,
} from "@celda/ui/buzon/Compartir.tsx";
import { Dialogo } from "@celda/ui/Dialogo.tsx";
import { Etiqueta } from "@celda/ui/Etiqueta.tsx";
import { Nota } from "@celda/ui/medir/Medir.tsx";
import { recurso } from "@celda/ui/recurso.ts";
import { Termino } from "@celda/ui/termino/Termino.tsx";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { createSignal, For, Match, Show, Switch } from "solid-js";

import { usarDatos } from "../datos.tsx";
import { fechaCorta } from "../ficha/textos.ts";
import type { TipoDeDispositivo } from "../medir/dispositivo.ts";
import { AlmacenLocal } from "../ubicacion/almacen.ts";
import { PasoCompartir } from "./PasoCompartir.tsx";
import { Proponer } from "./Proponer.tsx";
import { detalleDeAportacion, tituloDeAportacion } from "./textos.ts";

/** Lo que hay en el dispositivo: las aportaciones que se pueden compartir y cuándo se compartió cada una. */
interface EnElDispositivo {
  readonly aportaciones: ReadonlyArray<AportacionCompartible>;
  readonly compartidas: ReadonlyMap<string, number>;
}

type Vista =
  | { readonly tipo: "lista" }
  | { readonly tipo: "compartir"; readonly aportacion: AportacionCompartible }
  | { readonly tipo: "proponer" };

const TITULO_GRUPO: Readonly<Record<TipoCompartible, string>> = {
  propia: "Medidas propias",
  "correccion-propuesta": "Correcciones propuestas",
  corroboracion: "Corroboraciones",
};

const leerDelDispositivo = Effect.gen(function* () {
  const almacen = yield* AlmacenLocal;
  const porTipo = yield* Effect.forEach(TIPOS_COMPARTIBLES, (tipo) => almacen.leer(tipo));
  return {
    aportaciones: porTipo.flat().filter(esCompartible),
    compartidas: yield* almacen.leerCompartidas,
  } satisfies EnElDispositivo;
});

export interface DialogoAportacionesProps {
  /** El dispositivo, para decir en un ordenador por qué no tiene medidas propias. */
  readonly dispositivo: TipoDeDispositivo;
  readonly alCerrar: () => void;
  /** Cierra el diálogo para marcar en el mapa el punto de un emplazamiento que falta. */
  readonly alElegirPunto: () => void;
}

/**
 * «Tus aportaciones»: lo que hay en este dispositivo, sin cuenta (ADR 0007), con si se ha
 * compartido. Desde aquí se comparte lo que aún no ha salido, se reintenta lo que el buzón no
 * recibió y se propone un emplazamiento que falta.
 */
export function DialogoAportaciones(props: DialogoAportacionesProps) {
  const datos = usarDatos();
  const [vista, setVista] = createSignal<Vista>({ tipo: "lista" });
  const [leido, setLeido] = createSignal<EnElDispositivo>();
  const [sinAlmacen, setSinAlmacen] = createSignal(false);
  /** Sube al volver a la lista: se vuelve a leer lo que hay, por si se ha compartido algo. */
  const [lectura, setLectura] = createSignal(0);

  recurso(
    "buzon:aportaciones",
    () => (vista().tipo === "lista" ? lectura() + 1 : undefined),
    () => {
      const parar = new AbortController();
      if (datos === undefined) return () => undefined;
      void datos.runPromiseExit(leerDelDispositivo, { signal: parar.signal }).then((salida) => {
        if (Exit.isSuccess(salida)) setLeido(salida.value);
        else if (!parar.signal.aborted) setSinAlmacen(true);
      });
      return () => parar.abort();
    },
  );

  const volver = () => {
    setLectura((n) => n + 1);
    setVista({ tipo: "lista" });
  };

  const titulo = () => {
    switch (vista().tipo) {
      case "lista":
        return "Tus aportaciones";
      case "compartir":
        return "Compartir una aportación";
      case "proponer":
        return "Proponer un emplazamiento que falta";
    }
  };

  const delTipo = (tipo: TipoCompartible) =>
    (leido()?.aportaciones ?? []).filter((a) => a.tipo === tipo);

  return (
    <Dialogo titulo={titulo()} antetitulo="ESTE DISPOSITIVO" alCerrar={props.alCerrar}>
      <Switch>
        <Match
          when={(() => {
            const actual = vista();
            return actual.tipo === "compartir" ? actual.aportacion : undefined;
          })()}
        >
          {(aportacion) => (
            <PasoCompartir aportacion={aportacion()} textoSalir="Volver" alSalir={volver} />
          )}
        </Match>
        <Match when={vista().tipo === "proponer"}>
          <Proponer
            emplazamiento={undefined}
            textoSalir="Volver"
            alSalir={volver}
            alElegirPunto={props.alElegirPunto}
          />
        </Match>
        <Match when={vista().tipo === "lista"}>
          <p>
            Las medidas y correcciones que creas en Celda se guardan en este dispositivo, sin
            necesidad de cuenta. Desde aquí puedes enviarlas a Celda. Antes de enviar cada una verás
            qué datos salen y con qué licencia.
          </p>
          <Show when={sinAlmacen()}>
            <Nota tono="aviso" titulo="No se puede leer lo guardado">
              <p>Este navegador no deja a Celda leer lo que guarda en el dispositivo.</p>
            </Nota>
          </Show>
          <Show
            when={leido()}
            fallback={<Show when={!sinAlmacen()}>{<EsqueletoAportaciones />}</Show>}
          >
            {(enElDispositivo) => (
              <For each={TIPOS_COMPARTIBLES}>
                {(tipo) => (
                  <GrupoDeAportaciones titulo={TITULO_GRUPO[tipo]}>
                    <For
                      each={delTipo(tipo)}
                      fallback={
                        <GrupoVacio>
                          <SinAportaciones tipo={tipo} dispositivo={props.dispositivo} />
                        </GrupoVacio>
                      }
                    >
                      {(aportacion) => {
                        const compartida = () => enElDispositivo().compartidas.get(aportacion.id);
                        return (
                          <FilaAportacion
                            titulo={tituloDeAportacion(aportacion)}
                            detalle={detalleDeAportacion(aportacion)}
                            estado={
                              <Show
                                when={compartida()}
                                fallback={
                                  <Etiqueta tono="local">SOLO EN ESTE DISPOSITIVO</Etiqueta>
                                }
                              >
                                {(el) => (
                                  <Etiqueta tono="compartida">
                                    COMPARTIDA EL {fechaCorta(el()).toUpperCase()}
                                  </Etiqueta>
                                )}
                              </Show>
                            }
                            acciones={
                              <Show when={compartida() === undefined}>
                                <Boton
                                  variante="secundario"
                                  onClick={() => setVista({ tipo: "compartir", aportacion })}
                                >
                                  Compartir
                                </Boton>
                              </Show>
                            }
                          />
                        );
                      }}
                    </For>
                  </GrupoDeAportaciones>
                )}
              </For>
            )}
          </Show>
          <div>
            <Boton variante="secundario" onClick={() => setVista({ tipo: "proponer" })}>
              Proponer un emplazamiento que falta
            </Boton>
          </div>
        </Match>
      </Switch>
    </Dialogo>
  );
}

/** Lo que se dice de un tipo sin ninguna aportación en el dispositivo, y cómo crear una. */
function SinAportaciones(props: {
  readonly tipo: TipoCompartible;
  readonly dispositivo: TipoDeDispositivo;
}) {
  return (
    <Switch>
      <Match when={props.tipo === "propia" && props.dispositivo === "ordenador"}>
        <Nota tono="aviso" titulo="En un ordenador no hay medidas propias">
          <p>
            Las medidas se registran en el móvil con una captura de su{" "}
            <Termino termino="modo-de-informacion">modo de información</Termino> y se guardan en él,
            así que hay que compartirlas desde el móvil. En el ordenador puedes proponer
            correcciones y respaldar las de otras personas.
          </p>
        </Nota>
      </Match>
      <Match when={props.tipo === "propia"}>
        <p>
          <Etiqueta tono="pronto">PRONTO</Etiqueta> Aún no se pueden registrar medidas a partir de
          una captura. Cuando se pueda, aparecerán aquí para compartirlas.
        </p>
      </Match>
      <Match when={props.tipo === "correccion-propuesta"}>
        <p>
          Todavía no has propuesto ninguna. Puedes hacerlo desde la ficha de cualquier
          emplazamiento.
        </p>
      </Match>
      <Match when={props.tipo === "corroboracion"}>
        <p>
          Todavía no has respaldado ninguna. Las correcciones de la comunidad se respaldan desde la
          ficha en la que aparecen.
        </p>
      </Match>
    </Switch>
  );
}
