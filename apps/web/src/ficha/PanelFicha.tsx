import type { Ficha } from "@celda/dominio/ficha";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { primeraVezEn } from "@celda/dominio/glosario";
import { BANDAS_NOMINALES } from "@celda/dominio/tecnologia";
import { Aviso } from "@celda/ui/Aviso.tsx";
import { Boton } from "@celda/ui/Boton.tsx";
import { Desplegable } from "@celda/ui/Desplegable.tsx";
import { Etiqueta } from "@celda/ui/Etiqueta.tsx";
import { ConflictosFicha, ContrasteFicha, NotaFicha } from "@celda/ui/panel/Correccion.tsx";
import {
  AvisoFicha,
  CabeceraFicha,
  EsqueletoFicha,
  EstacionFicha,
  MarcaDeAguaFicha,
  OrigenFicha,
  ResumenFicha,
  SeccionFicha,
} from "@celda/ui/panel/Ficha.tsx";
import { DatosTecnicos } from "@celda/ui/panel/DatosTecnicos.tsx";
import { EjeFrecuencias } from "@celda/ui/panel/EjeFrecuencias.tsx";
import type { AlturaHoja } from "@celda/ui/panel/hoja.ts";
import { PanelEmplazamiento } from "@celda/ui/panel/PanelEmplazamiento.tsx";
import { Termino, TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  Show,
  useContext,
} from "solid-js";

import { DialogoCorroborar } from "../buzon/DialogoCorroborar.tsx";
import { DialogoProponer } from "../buzon/DialogoProponer.tsx";
import { leerEnSolid, usarDatos } from "../datos.tsx";
import { MejorarSenal } from "../mejorar/MejorarSenal.tsx";
import { TITULO_MEJORAR } from "../mejorar/textos.ts";
import { UbicacionContexto } from "../ubicacion/controlador.ts";
import { ReferenciaEnFicha } from "../ubicacion/Ubicacion.tsx";
import { ComoEmite } from "./ComoEmite.tsx";
import { TITULO_COMO_EMITE } from "./diagrama.ts";
import { textosCorrecciones, TITULO_CORRECCIONES } from "./correcciones.ts";
import { compararConCapa } from "./marcaDeAgua.ts";
import {
  datosTecnicosDe,
  filasDelEje,
  fraseDeResumen,
  NOMBRE_EJE,
  NOTA_TECNICA,
  TITULO_EJE,
} from "./resumen.ts";
import { FichasPublicadas } from "./servicio.ts";
import {
  antetituloDe,
  creditoDelLugar,
  lugarDe,
  NOMBRE_ESTADO,
  textoCodigos,
  textosDeOrigenes,
  textosMarca,
  tituloDe,
} from "./textos.ts";

export interface PanelFichaProps {
  /** Clave del emplazamiento seleccionado. */
  readonly clave: string;
  /**
   * La provincia en cuya capa va (ADR 0016), o `null` si el enlace no la dice: entonces se busca
   * en el índice de claves.
   */
  readonly provincia: string | null;
  /** Fecha de la capa de su provincia en el mapa, si ya ha llegado: su marca de agua. */
  readonly fechaCapa: number | undefined;
  readonly alCerrar: () => void;
}

/**
 * El panel del emplazamiento seleccionado, con su ficha publicada. Cambiar de emplazamiento es un
 * límite duro (historia 20): la ficha anterior desaparece en el acto y su lectura se cancela, y
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
    const pedida = { clave: props.clave, provincia: props.provincia };
    return leerEnSolid(
      datos,
      Stream.fromEffect(Effect.flatMap(FichasPublicadas, (fichas) => fichas.leer(pedida))),
    );
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
            {(leida) => (
              <ContenidoFicha ficha={leida()} clave={props.clave} fechaCapa={props.fechaCapa} />
            )}
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
        No hay ningún <Termino termino="emplazamiento">emplazamiento</Termino> con la clave{" "}
        {props.clave}. Puede que se haya retirado después de publicarse el mapa, o que la dirección
        esté mal copiada.
      </Aviso>
    </AvisoFicha>
  );
}

/**
 * La ficha ya leída: cabecera, frase de resumen, marca de agua, cómo emite, cómo mejorar la
 * señal, eje de frecuencias, de dónde sale cada dato y, plegados, los datos técnicos.
 */
function ContenidoFicha(props: {
  readonly ficha: Ficha;
  /**
   * El emplazamiento seleccionado ahora. Mientras llega su ficha, la anterior sigue montada
   * aunque no se vea; con la clave nueva deja de calcular lo que ya no hace falta.
   */
  readonly clave: string;
  readonly fechaCapa: number | undefined;
}) {
  const marca = createMemo(() =>
    textosMarca(props.ficha, compararConCapa(props.fechaCapa, props.ficha.version)),
  );
  const posterior = createMemo(
    () => compararConCapa(props.fechaCapa, props.ficha.version).tipo === "posterior",
  );
  const origenes = createMemo(() => textosDeOrigenes(props.ficha.estaciones));
  const ubicacion = useContext(UbicacionContexto);
  /** El diálogo de la comunidad abierto desde la ficha: proponer o respaldar una corrección. */
  const [comunidad, setComunidad] = createSignal<
    | { readonly tipo: "proponer" }
    | { readonly tipo: "corroborar"; readonly clave: string; readonly dice: string }
  >();
  return (
    <article aria-label={tituloDe(props.ficha)}>
      <CabeceraFicha
        antetitulo={<TextoConTerminos texto={antetituloDe(props.ficha)} />}
        titulo={tituloDe(props.ficha)}
        lugar={lugarDe(props.ficha)}
        companias={props.ficha.estaciones.map((e) => e.compania)}
        etiquetas={
          <Etiqueta tono={props.ficha.estado}>{NOMBRE_ESTADO[props.ficha.estado]}</Etiqueta>
        }
      />
      <ResumenFicha>
        <TextoConTerminos texto={fraseDeResumen(props.ficha.estaciones)} />
      </ResumenFicha>
      <MarcaDeAguaFicha
        tono={posterior() ? "posterior" : "al-dia"}
        titulo={<TextoConTerminos texto={marca().titulo} />}
      >
        {marca().detalle}
      </MarcaDeAguaFicha>
      <Show when={textosCorrecciones(props.ficha)}>
        {(correcciones) => (
          <SeccionFicha titulo={<TextoConTerminos texto={TITULO_CORRECCIONES} />}>
            <NotaFicha>
              {/* El título ya subraya «registro oficial»: la frase subraya lo demás. */}
              <TextoConTerminos
                texto={primeraVezEn([TITULO_CORRECCIONES, correcciones().resumen])[1] ?? []}
              />
            </NotaFicha>
            <For each={correcciones().contrastes}>
              {(contraste) => (
                <ContrasteFicha
                  tono={contraste.tono}
                  compania={contraste.compania}
                  nombre={contraste.nombre}
                  oficial={contraste.oficial}
                  comunidad={contraste.comunidad}
                  acciones={
                    <Show when={contraste.correccion}>
                      {(correccion) => (
                        <Boton
                          variante="secundario"
                          aria-haspopup="dialog"
                          onClick={() => setComunidad({ tipo: "corroborar", ...correccion() })}
                        >
                          Yo también lo veo
                        </Boton>
                      )}
                    </Show>
                  }
                />
              )}
            </For>
            <Show when={correcciones().conflictos.length > 0}>
              <ConflictosFicha conflictos={correcciones().conflictos} />
            </Show>
          </SeccionFicha>
        )}
      </Show>
      <ReferenciaEnFicha clave={props.clave} emplazamiento={props.ficha.posicion} />
      <SeccionFicha titulo={TITULO_COMO_EMITE}>
        <ComoEmite clave={props.clave} />
      </SeccionFicha>
      <SeccionFicha titulo={TITULO_MEJORAR}>
        <MejorarSenal clave={props.clave} emplazamiento={props.ficha.posicion} />
      </SeccionFicha>
      <SeccionFicha titulo={<TextoConTerminos texto={TITULO_EJE} />}>
        <EjeFrecuencias
          titulo={NOMBRE_EJE}
          bandas={BANDAS_NOMINALES}
          filas={filasDelEje(props.ficha.estaciones)}
        />
      </SeccionFicha>
      <SeccionFicha titulo="De dónde salen los datos">
        <For each={props.ficha.estaciones}>
          {(estacion, i) => (
            <EstacionFicha
              compania={estacion.compania}
              nombre={NOMBRE_COMPANIA[estacion.compania]}
              codigos={textoCodigos(estacion.codigos)}
            >
              <For each={origenes()[i()] ?? []}>
                {(textos) => (
                  <OrigenFicha
                    tono={textos.tono}
                    fuente={<TextoConTerminos texto={textos.fuente} />}
                    detalle={<TextoConTerminos texto={textos.detalle} />}
                    enlace={textos.enlace}
                    textoEnlace={textos.textoEnlace}
                  />
                )}
              </For>
            </EstacionFicha>
          )}
        </For>
        <Show when={creditoDelLugar(props.ficha)}>
          {(credito) => <NotaFicha tono="credito">{credito()}</NotaFicha>}
        </Show>
        <NotaFicha>
          ¿Algo no cuadra con lo que ves? Propón una corrección: la revisa la moderación y, si la
          acepta, sale aquí al lado de lo que dice el registro.
        </NotaFicha>
        <div>
          <Boton
            variante="secundario"
            aria-haspopup="dialog"
            onClick={() => setComunidad({ tipo: "proponer" })}
          >
            Proponer una corrección
          </Boton>
        </div>
      </SeccionFicha>
      <Desplegable titulo="Datos técnicos">
        <DatosTecnicos
          estaciones={datosTecnicosDe(props.ficha.estaciones)}
          nota={<TextoConTerminos texto={NOTA_TECNICA} />}
        />
      </Desplegable>
      <Show when={comunidad()?.tipo === "proponer"}>
        <DialogoProponer
          emplazamiento={{
            clave: props.ficha.clave,
            posicion: props.ficha.posicion,
            companias: props.ficha.estaciones.map((e) => e.compania),
          }}
          alCerrar={() => setComunidad(undefined)}
          alElegirPunto={() => {
            setComunidad(undefined);
            ubicacion?.elegirEnMapa();
          }}
        />
      </Show>
      <Show
        when={(() => {
          const actual = comunidad();
          return actual?.tipo === "corroborar" ? actual : undefined;
        })()}
      >
        {(corroborar) => (
          <DialogoCorroborar
            emplazamiento={props.ficha.clave}
            correccion={corroborar().clave}
            dice={corroborar().dice}
            alCerrar={() => setComunidad(undefined)}
          />
        )}
      </Show>
    </article>
  );
}
