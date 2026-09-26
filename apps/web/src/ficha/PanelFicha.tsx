import type { Ficha } from "@celda/dominio/ficha";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { Etiqueta } from "@celda/ui/Etiqueta.tsx";
import {
  AvisoFicha,
  CabeceraFicha,
  EsqueletoFicha,
  EstacionFicha,
  MarcaDeAguaFicha,
  OrigenFicha,
  SeccionFicha,
} from "@celda/ui/panel/Ficha.tsx";
import type { AlturaHoja } from "@celda/ui/panel/hoja.ts";
import { PanelEmplazamiento } from "@celda/ui/panel/PanelEmplazamiento.tsx";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";

import { enVivo, usarDatos } from "../datos.tsx";
import { compararConCapa } from "./marcaDeAgua.ts";
import { FichasEnVivo } from "./servicio.ts";
import {
  antetituloDe,
  lugarDe,
  NOMBRE_ESTADO,
  SIN_BANDAS,
  textoCodigos,
  textosBandas,
  textosMarca,
  textosOrigen,
  tituloDe,
} from "./textos.ts";

export interface PanelFichaProps {
  /** Clave del emplazamiento seleccionado. */
  readonly clave: string;
  /** Fecha de la capa que dibuja el mapa, si ya ha llegado: su marca de agua. */
  readonly fechaCapa: number | undefined;
  readonly alCerrar: () => void;
}

/**
 * El panel del emplazamiento seleccionado, con su ficha en vivo. Cambiar de emplazamiento es un
 * límite duro (historia 20): la ficha anterior desaparece en el acto y su lectura se libera, y
 * una respuesta suya que llegue tarde ya no se enseña.
 */
export function PanelFicha(props: PanelFichaProps) {
  const datos = usarDatos();
  const [altura, setAltura] = createSignal<AlturaHoja>("resumen");
  // Cada emplazamiento nuevo se abre en el resumen.
  createEffect(
    () => props.clave,
    () => {
      setAltura("resumen");
    },
    { defer: true },
  );

  const ficha = createMemo(() => {
    const clave = props.clave;
    return enVivo(datos, Stream.unwrap(Effect.map(FichasEnVivo, (fichas) => fichas.seguir(clave))));
  });

  return (
    <PanelEmplazamiento
      nombre="Ficha del emplazamiento"
      altura={altura()}
      alCambiarAltura={setAltura}
      alCerrar={() => props.alCerrar()}
    >
      <Errored
        fallback={(_error, reintentar) => (
          <AvisoFicha>
            <Aviso
              tono="fallo"
              encaje="panel"
              titulo="No se ha podido leer la ficha"
              acciones={
                <Boton variante="secundario" onClick={() => reintentar()}>
                  Reintentar
                </Boton>
              }
            >
              El servidor de Celda no ha respondido. Puede fallar la conexión o estar bloqueado el
              servidor. El mapa sigue funcionando.
            </Aviso>
          </AvisoFicha>
        )}
      >
        <Loading on={props.clave} fallback={<EsqueletoFicha />}>
          <Show
            when={Option.getOrUndefined(ficha())}
            fallback={<FichaInexistente clave={props.clave} alCerrar={() => props.alCerrar()} />}
          >
            {(leida) => <ContenidoFicha ficha={leida()} fechaCapa={props.fechaCapa} />}
          </Show>
        </Loading>
      </Errored>
    </PanelEmplazamiento>
  );
}

function FichaInexistente(props: { readonly clave: string; readonly alCerrar: () => void }) {
  return (
    <AvisoFicha>
      <Aviso
        tono="fallo"
        encaje="panel"
        titulo="Este emplazamiento no existe"
        acciones={
          <Boton variante="secundario" onClick={() => props.alCerrar()}>
            Volver al mapa
          </Boton>
        }
      >
        No hay ningún emplazamiento con la clave {props.clave}. Puede que se haya retirado después
        de publicarse el mapa, o que la dirección esté mal copiada.
      </Aviso>
    </AvisoFicha>
  );
}

/** La ficha ya leída: cabecera, marca de agua y cada compañía con sus bandas y sus fuentes. */
function ContenidoFicha(props: { readonly ficha: Ficha; readonly fechaCapa: number | undefined }) {
  const marca = createMemo(() =>
    textosMarca(props.ficha, compararConCapa(props.fechaCapa, props.ficha.version)),
  );
  const posterior = createMemo(
    () => compararConCapa(props.fechaCapa, props.ficha.version).tipo === "posterior",
  );
  return (
    <article aria-label={tituloDe(props.ficha)}>
      <CabeceraFicha
        antetitulo={antetituloDe(props.ficha)}
        titulo={tituloDe(props.ficha)}
        lugar={lugarDe(props.ficha)}
        companias={props.ficha.estaciones.map((e) => e.compania)}
        etiquetas={
          <Etiqueta tono={props.ficha.estado}>{NOMBRE_ESTADO[props.ficha.estado]}</Etiqueta>
        }
      />
      <MarcaDeAguaFicha tono={posterior() ? "posterior" : "al-dia"} titulo={marca().titulo}>
        {marca().detalle}
      </MarcaDeAguaFicha>
      <SeccionFicha titulo="Compañías y bandas">
        <For each={props.ficha.estaciones}>
          {(estacion) => (
            <EstacionFicha
              compania={estacion.compania}
              nombre={NOMBRE_COMPANIA[estacion.compania]}
              codigos={textoCodigos(estacion.codigos)}
              bandas={textosBandas(estacion.bandas)}
              sinBandas={SIN_BANDAS}
            >
              <For each={estacion.origenes}>
                {(origen) => {
                  const textos = createMemo(() => textosOrigen(origen));
                  return (
                    <OrigenFicha
                      tono={textos().tono}
                      fuente={textos().fuente}
                      detalle={textos().detalle}
                      enlace={origen.url}
                      textoEnlace={textos().textoEnlace}
                    />
                  );
                }}
              </For>
            </EstacionFicha>
          )}
        </For>
      </SeccionFicha>
    </article>
  );
}
