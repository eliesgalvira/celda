import {
  type Cambio,
  type CorreccionPropuesta,
  ESQUEMA_CORRECCION_PROPUESTA,
  LARGO_MAXIMO_NOTA,
  type TipoDeCambio,
} from "@celda/dominio/aportacion";
import type { Coordenada } from "@celda/dominio/area";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { Boton } from "@celda/ui/Boton.tsx";
import { AccionesDelPaso } from "@celda/ui/buzon/Compartir.tsx";
import { AreaDeTexto, Casillas, Segmentado, Selector } from "@celda/ui/Eleccion.tsx";
import { Nota } from "@celda/ui/medir/Medir.tsx";
import { Termino } from "@celda/ui/termino/Termino.tsx";
import * as Exit from "effect/Exit";
import { createMemo, createSignal, Show, untrack, useContext } from "solid-js";

import { usarDatos } from "../datos.tsx";
import { posicionDe } from "../ubicacion/estado.ts";
import { nuevaAportacion } from "../ubicacion/almacen.ts";
import { UbicacionContexto } from "../ubicacion/controlador.ts";
import { PasoCompartir } from "./PasoCompartir.tsx";
import { textoCambio, textoCoordenada } from "./textos.ts";

/** El emplazamiento que se corrige, tal como lo publica la capa. */
export interface EmplazamientoACorregir {
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly companias: ReadonlyArray<Compania>;
}

const QUE_ESTA_MAL: ReadonlyArray<{
  readonly valor: Exclude<TipoDeCambio, "falta">;
  readonly etiqueta: string;
}> = [
  { valor: "posicion", etiqueta: "Su posición" },
  { valor: "compania", etiqueta: "Una compañía" },
  { valor: "ya-no-existe", etiqueta: "Ya no existe" },
];

const COMPANIAS = (["movistar", "vodafone", "orange", "digi", "yoigo"] as const).map((valor) => ({
  valor,
  etiqueta: NOMBRE_COMPANIA[valor],
}));

const SI_NO = [
  { valor: "si", etiqueta: "Sí, está" },
  { valor: "no", etiqueta: "No está" },
] as const;

export interface ProponerProps {
  /** El emplazamiento que se corrige, o nada para proponer uno que falta. */
  readonly emplazamiento: EmplazamientoACorregir | undefined;
  /** Sale del paso: cierra el diálogo o vuelve a la lista. */
  readonly textoSalir: string;
  readonly alSalir: () => void;
  /** Cierra el diálogo para que la persona marque un punto en el mapa. */
  readonly alElegirPunto: () => void;
}

/**
 * Proponer una corrección (ADR 0020): qué está mal, con el punto o la compañía, y una nota
 * opcional sin imágenes. Después enseña qué sale del dispositivo y la dedicación CC0 antes de
 * enviar. El punto propuesto es el punto de referencia: la ubicación GPS o el punto elegido.
 */
export function Proponer(props: ProponerProps) {
  const datos = usarDatos();
  const ubicacion = useContext(UbicacionContexto);
  const [tipo, setTipo] = createSignal<TipoDeCambio>(
    untrack(() => (props.emplazamiento === undefined ? "falta" : "posicion")),
  );
  const [compania, setCompania] = createSignal<Compania>();
  const [esta, setEsta] = createSignal<"si" | "no">();
  const [companias, setCompanias] = createSignal<ReadonlyArray<Compania>>([]);
  const [nota, setNota] = createSignal("");
  const [borrador, setBorrador] = createSignal<CorreccionPropuesta>();

  const punto = createMemo(() => {
    const referencia = ubicacion.referencia();
    return referencia === undefined ? undefined : posicionDe(referencia);
  });

  /** Lo que propone, o nada mientras falte algo. */
  const cambio = createMemo((): Cambio | undefined => {
    switch (tipo()) {
      case "posicion": {
        const propuesto = punto();
        return propuesto === undefined ? undefined : { tipo: "posicion", posicion: propuesto };
      }
      case "compania": {
        const elegida = compania();
        const respuesta = esta();
        return elegida === undefined || respuesta === undefined
          ? undefined
          : { tipo: "compania", compania: elegida, esta: respuesta === "si" };
      }
      case "ya-no-existe":
        return { tipo: "ya-no-existe" };
      case "falta": {
        const propuesto = punto();
        const elegidas = companias();
        return propuesto === undefined || elegidas.length === 0
          ? undefined
          : { tipo: "falta", posicion: propuesto, companias: elegidas };
      }
    }
  });

  const revisar = () => {
    const propuesto = cambio();
    if (propuesto === undefined) return;
    const escrita = nota().trim();
    void datos
      .runPromiseExit(
        nuevaAportacion({
          tipo: "correccion-propuesta",
          esquema: ESQUEMA_CORRECCION_PROPUESTA,
          origen: props.emplazamiento === undefined ? "mapa" : "ficha",
          emplazamiento: props.emplazamiento?.clave ?? null,
          cambio: propuesto,
          nota: escrita === "" ? null : escrita,
        }),
      )
      .then((salida) => {
        if (Exit.isSuccess(salida)) setBorrador(salida.value);
      });
  };

  const sinPunto = (
    <Nota tono="aviso" titulo="Falta el punto">
      <p>
        Se propone tu <Termino termino="punto-de-referencia">punto de referencia</Termino>. Márcalo
        y vuelve aquí.
      </p>
      <div>
        <Boton variante="secundario" onClick={() => props.alElegirPunto()}>
          Elegir el punto en el mapa
        </Boton>
      </div>
    </Nota>
  );

  const conPunto = (
    <Show when={punto()} fallback={sinPunto}>
      {(propuesto) => (
        <Nota titulo="Punto propuesto">
          <p>
            {props.emplazamiento === undefined
              ? textoCoordenada(propuesto())
              : textoCambio(
                  { tipo: "posicion", posicion: propuesto() },
                  props.emplazamiento.posicion,
                )}
          </p>
          <p>Es tu punto de referencia. Para cambiarlo, muévelo en el mapa.</p>
        </Nota>
      )}
    </Show>
  );

  return (
    <Show
      when={borrador()}
      fallback={
        <>
          <Show when={props.emplazamiento !== undefined}>
            <>
              <Segmentado
                leyenda="Qué está mal"
                opciones={QUE_ESTA_MAL}
                valor={tipo() === "falta" ? undefined : tipo()}
                alCambiar={setTipo}
              />
            </>
          </Show>
          <Show when={tipo() === "posicion" || tipo() === "falta"}>{conPunto}</Show>
          <Show when={tipo() === "compania"}>
            <Selector
              etiqueta="Compañía"
              vacio="Elige la compañía"
              opciones={COMPANIAS}
              valor={compania()}
              alCambiar={setCompania}
            />
            <Segmentado
              leyenda="¿Está en este emplazamiento?"
              opciones={SI_NO}
              valor={esta()}
              alCambiar={setEsta}
            />
          </Show>
          <Show when={tipo() === "falta"}>
            <Casillas
              leyenda="Compañías que emiten desde ahí"
              opciones={COMPANIAS}
              marcadas={companias()}
              alCambiar={setCompanias}
            />
          </Show>
          <AreaDeTexto
            etiqueta="Nota (opcional)"
            valor={nota()}
            maximo={LARGO_MAXIMO_NOTA}
            alCambiar={setNota}
            ayuda="Cuenta qué has visto, sin datos personales."
          />
          <AccionesDelPaso>
            <Boton variante="destacado" disabled={cambio() === undefined} onClick={revisar}>
              Revisar y enviar
            </Boton>
            <Boton variante="secundario" onClick={() => props.alSalir()}>
              {props.textoSalir}
            </Boton>
          </AccionesDelPaso>
        </>
      }
    >
      {(propuesta) => (
        <PasoCompartir
          aportacion={propuesta()}
          textoSalir="Volver"
          alSalir={() => setBorrador(undefined)}
          alTerminar={() => props.alSalir()}
        />
      )}
    </Show>
  );
}
