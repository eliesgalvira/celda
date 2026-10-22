import type { Baremo } from "@celda/dominio/baremo";
import type { Ficha } from "@celda/dominio/ficha";
import { NotaFicha } from "@celda/ui/panel/Correccion.tsx";
import { MedidasDeExposicion } from "@celda/ui/panel/Exposicion.tsx";
import { TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { createMemo, For, Show } from "solid-js";

import { leerEnSolid, usarDatos } from "../datos.tsx";
import { estacionesConMedidas, textosExposicion } from "./exposicion.ts";
import { FichasPublicadas } from "./servicio.ts";

/** Las frases y las tablas de la sección, con el baremo si lo hay. */
function Medidas(props: { readonly ficha: Ficha; readonly baremo: Baremo | undefined }) {
  const textos = createMemo(() => textosExposicion(props.ficha, props.baremo));
  return (
    <>
      <For each={textos().frases}>
        {(frase) => (
          <NotaFicha>
            <TextoConTerminos texto={frase} />
          </NotaFicha>
        )}
      </For>
      <MedidasDeExposicion estaciones={textos().estaciones} />
    </>
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
