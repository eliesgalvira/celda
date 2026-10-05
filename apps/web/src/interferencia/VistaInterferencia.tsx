import type { Mhz } from "@celda/dominio/banda";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { Boton } from "@celda/ui/Boton.tsx";
import { Deslizador, Selector } from "@celda/ui/Eleccion.tsx";
import {
  EscalaSinr,
  EstadoVista,
  PanelInterferencia,
  ParDeControles,
  TextoVista,
  tramoDe,
  ValorEnPunto,
} from "@celda/ui/interferencia/PanelInterferencia.tsx";
import { TextoConTerminos } from "@celda/ui/termino/Termino.tsx";
import { createMemo } from "solid-js";

import { enumerar } from "../capa/vecinas.ts";
import type { CalculoVista } from "./enMapa.ts";
import {
  BANDAS_DE_LA_VISTA,
  companiasDeLaCapa,
  type EleccionVista,
  OCUPACION,
  palabraDeSinr,
  recuentoDe,
  textoDb,
} from "./interferencia.ts";
import {
  desdeDe,
  FRASE_CLAVE,
  QUE_SE_VE,
  SIN_PUNTO,
  SUPUESTOS,
  textoDeEstaciones,
} from "./textos.ts";

export interface VistaInterferenciaProps {
  readonly emplazamientos: ReadonlyArray<EmplazamientoDeCapa>;
  readonly eleccion: EleccionVista;
  readonly alCambiar: (eleccion: EleccionVista) => void;
  readonly calculo: CalculoVista;
  /** Vuelve a calcular tras un fallo o a pedir las provincias vecinas que no han llegado. */
  readonly reintentar: () => void;
  /** El punto de referencia que hay, o ninguno. */
  readonly referencia: "gps" | "elegido" | undefined;
  /** Si el mapa está al zoom de la trama. */
  readonly cerca: boolean;
  readonly alCerrar: () => void;
}

/** Lo que dice la línea de estado del cálculo. */
const textoDeEstado = (calculo: CalculoVista, cerca: boolean): string | undefined => {
  const faltan = enumerar((calculo.faltan ?? []).map((p) => p.nombre));
  if (calculo.estado === "esperando") {
    return `Cargando los emplazamientos de ${faltan}, que hacen falta para calcular la interferencia junto al borde…`;
  }
  if (calculo.estado === "sin-vecinas") {
    return `No han llegado los emplazamientos de ${faltan}, y sin ellos no se puede calcular bien la interferencia en esta zona.`;
  }
  if (calculo.estado === "calculando") return "Calculando la interferencia…";
  if (calculo.estado === "fallo") return "No se ha podido calcular la interferencia.";
  return cerca ? undefined : "Acerca el mapa para ver la trama.";
};

/**
 * El panel de la vista de interferencia (historias 38 a 43): la frase clave, la compañía, la
 * banda y la ocupación, la escala, el valor en el punto de referencia y lo que se supone.
 */
export function VistaInterferencia(props: VistaInterferenciaProps) {
  const companias = createMemo(() =>
    companiasDeLaCapa(props.emplazamientos).map((compania) => ({
      valor: compania,
      etiqueta: NOMBRE_COMPANIA[compania],
    })),
  );
  const recuento = createMemo(() =>
    recuentoDe(props.emplazamientos, props.eleccion.compania, props.eleccion.mhz),
  );
  const valor = () => props.calculo.valor;
  const porcentaje = () => Math.round(props.eleccion.ocupacion * 100);

  return (
    <PanelInterferencia titulo="Interferencia entre antenas" alCerrar={props.alCerrar}>
      <TextoVista tono="clave">
        <TextoConTerminos texto={FRASE_CLAVE} />
      </TextoVista>
      <ParDeControles>
        <Selector<Compania>
          etiqueta="Compañía"
          opciones={companias()}
          valor={props.eleccion.compania}
          vacio="Elige una"
          alCambiar={(compania) => props.alCambiar({ ...props.eleccion, compania })}
        />
        <Selector<`${Mhz}`>
          etiqueta="Frecuencia"
          opciones={BANDAS_DE_LA_VISTA.map((mhz) => ({
            valor: `${mhz}`,
            etiqueta: `${mhz} MHz`,
          }))}
          valor={`${props.eleccion.mhz}`}
          vacio="Elige una"
          alCambiar={(texto) =>
            props.alCambiar({
              ...props.eleccion,
              mhz: BANDAS_DE_LA_VISTA.find((mhz) => `${mhz}` === texto) ?? props.eleccion.mhz,
            })
          }
        />
      </ParDeControles>
      <Deslizador
        etiqueta="Ocupación de la red"
        valor={porcentaje()}
        minimo={OCUPACION.minima * 100}
        maximo={OCUPACION.maxima * 100}
        paso={OCUPACION.paso * 100}
        texto={`${porcentaje()} %`}
        alCambiar={(valor) => props.alCambiar({ ...props.eleccion, ocupacion: valor / 100 })}
      />
      <EscalaSinr peor="domina la interferencia" mejor="señal limpia" />
      <ValorEnPunto
        desde={
          <TextoConTerminos texto={desdeDe(props.referencia === "elegido" ? "elegido" : "gps")} />
        }
        valor={valor() === undefined ? undefined : textoDb(valor() ?? 0)}
        palabra={valor() === undefined ? undefined : palabraDeSinr(valor() ?? 0)}
        tramo={valor() === undefined ? undefined : tramoDe(valor() ?? 0)}
        vacio={
          props.referencia === undefined ? (
            <TextoConTerminos texto={SIN_PUNTO} />
          ) : props.calculo.estado === "lista" ? (
            "No hay estaciones base de esta compañía en esta banda cerca del punto."
          ) : props.calculo.estado === "sin-vecinas" ? (
            "Faltan emplazamientos cerca del punto."
          ) : (
            "Calculando…"
          )
        }
      />
      <EstadoVista
        texto={textoDeEstado(props.calculo, props.cerca)}
        accion={
          props.calculo.estado === "fallo" || props.calculo.estado === "sin-vecinas" ? (
            <Boton variante="secundario" onClick={() => props.reintentar()}>
              Reintentar
            </Boton>
          ) : undefined
        }
      />
      <TextoVista>
        <TextoConTerminos texto={QUE_SE_VE} />
      </TextoVista>
      <TextoVista tono="nota">
        {textoDeEstaciones(recuento(), props.eleccion.compania, props.eleccion.mhz)}
      </TextoVista>
      <TextoVista tono="nota">
        <TextoConTerminos texto={SUPUESTOS} />
      </TextoVista>
    </PanelInterferencia>
  );
}
