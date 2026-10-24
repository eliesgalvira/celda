import type { Baremo } from "@celda/dominio/baremo";
import type { Ficha } from "@celda/dominio/ficha";
import { Desplegable } from "@celda/ui/Desplegable.tsx";
import { NotaFicha } from "@celda/ui/panel/Correccion.tsx";
import {
  FrenteAOtras,
  MedidaMasAlta,
  MedidasDeExposicion,
  NotaExposicion,
  PiezasExposicion,
} from "@celda/ui/panel/Exposicion.tsx";
import { TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { createMemo, For, Match, Show, Switch } from "solid-js";

import { leerEnSolid, usarDatos } from "../datos.tsx";
import { estacionesConMedidas, type FrenteAOtrasMedidas, textosExposicion } from "./exposicion.ts";
import { FichasPublicadas } from "./servicio.ts";

const comparada = (frente: FrenteAOtrasMedidas | undefined) =>
  frente?.tipo === "comparada" ? frente : undefined;

/**
 * La sección con el baremo si lo hay: la medida más alta y dónde queda, y plegadas, las medidas de
 * cada compañía y qué son. Sin ninguna medida, solo por qué no las hay.
 */
function Medidas(props: { readonly ficha: Ficha; readonly baremo: Baremo | undefined }) {
  const textos = createMemo(() => textosExposicion(props.ficha, props.baremo));
  return (
    <PiezasExposicion>
      <Show
        when={textos().maxima}
        fallback={<MedidasDeExposicion estaciones={textos().estaciones} />}
      >
        {(maxima) => (
          <>
            <MedidaMasAlta
              valor={maxima().valor}
              companias={maxima().companias}
              quien={maxima().quien}
              barra={maxima().barra}
            >
              <TextoConTerminos texto={maxima().nota} />
            </MedidaMasAlta>
            <Switch>
              <Match when={comparada(maxima().frente)}>
                {(frente) => (
                  <FrenteAOtras masAltaQue={frente().masAltaQue}>{frente().nota}</FrenteAOtras>
                )}
              </Match>
              <Match when={maxima().frente?.tipo === "sin-zona"}>
                <NotaExposicion>{maxima().frente?.nota}</NotaExposicion>
              </Match>
            </Switch>
            <Desplegable variante="seccion" titulo="Las medidas de cada compañía">
              <MedidasDeExposicion estaciones={textos().estaciones} />
            </Desplegable>
            <Desplegable variante="seccion" titulo="¿Qué son estas medidas?">
              <For each={textos().explicacion}>
                {(texto) => (
                  <NotaFicha>
                    <TextoConTerminos texto={texto} />
                  </NotaFicha>
                )}
              </For>
            </Desplegable>
          </>
        )}
      </Show>
    </PiezasExposicion>
  );
}

/**
 * Las medidas comparadas con el baremo de `provincia`. Se monta una vez por provincia: mientras el
 * baremo no ha llegado, o si no llega, las medidas se ven sin comparar (`loadingValue`), sin
 * esperar a nada ni tapar la ficha.
 */
function Comparadas(props: { readonly ficha: Ficha; readonly provincia: string }) {
  const datos = usarDatos();
  const baremo = createMemo<Option.Option<Baremo>>(
    () =>
      leerEnSolid(
        datos,
        Stream.fromEffect(
          Effect.flatMap(FichasPublicadas, (fichas) => fichas.baremo(props.provincia)),
        ),
      ),
    { loadingValue: Option.none() },
  );
  return <Medidas ficha={props.ficha} baremo={Option.getOrUndefined(baremo())} />;
}

/**
 * Las medidas de exposición del ministerio de la ficha, por compañía (ADR 0030). El baremo de su
 * provincia solo se pide si tiene alguna medida.
 */
export function ExposicionEnFicha(props: { readonly ficha: Ficha }) {
  const provincia = createMemo(() =>
    estacionesConMedidas(props.ficha).length > 0 ? props.ficha.lugar?.provincia?.codigo : undefined,
  );
  return (
    <Show when={provincia()} keyed fallback={<Medidas ficha={props.ficha} baremo={undefined} />}>
      {(codigo) => <Comparadas ficha={props.ficha} provincia={codigo} />}
    </Show>
  );
}
