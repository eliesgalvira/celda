import type { Coordenada } from "@celda/dominio/area";
import { type ResultadoSectorServicio, sectorServicio } from "@celda/sim/sectorServicio";
import { Simulador } from "@celda/sim/simulador";
import { FUENTE_SERVICIO, FUENTE_SERVICIO_LINEA } from "@celda/ui/mapa/servicio.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createContext, createEffect, createMemo, createSignal, onSettled } from "solid-js";

import type { Orientacion } from "../ficha/diagrama.ts";
import {
  lineaDe,
  type PedidoServicio,
  pedirServicio,
  rasgosDe,
  type RasgosServicio,
  SIN_RASGOS,
} from "./servicio.ts";

/** Lo que hace el mapa con el sector que da servicio. En las pruebas, un lienzo que apunta. */
export interface LienzoDeServicio {
  /** Pone los sectores, el degradado y los límites en lugar de los que hubiera. */
  readonly dibujar: (rasgos: RasgosServicio) => void;
  /** Pone la línea hasta el punto de referencia. */
  readonly linea: (rasgos: RasgosServicio) => void;
}

/** El lienzo de un mapa de MapLibre: las fuentes del servicio de su estilo. */
export const lienzoDeServicio = (mapa: MapaMapLibre): LienzoDeServicio => ({
  dibujar: (rasgos) => mapa.getSource<GeoJSONSource>(FUENTE_SERVICIO)?.setData(rasgos),
  linea: (rasgos) => mapa.getSource<GeoJSONSource>(FUENTE_SERVICIO_LINEA)?.setData(rasgos),
});

/** De dónde sale el sector que da servicio. Cada campo es una lectura reactiva. */
export interface EntradaServicio {
  readonly lienzo: () => LienzoDeServicio | undefined;
  /** El emplazamiento seleccionado y su posición, si la capa lo tiene. */
  readonly emplazamiento: () =>
    | { readonly clave: string; readonly posicion: Coordenada }
    | undefined;
  /** El punto de referencia, si hay. */
  readonly punto: () => Coordenada | undefined;
  /** La celda del emplazamiento `clave`, si ya se ha calculado. */
  readonly celda: (clave: string) => ReadonlyArray<Coordenada> | undefined;
  readonly orientacion: Orientacion;
}

/** El último resultado, con lo que se pidió para calcularlo. */
export interface ServicioCalculado {
  readonly pedido: PedidoServicio;
  readonly resultado: ResultadoSectorServicio;
}

export interface ServicioDelMapa {
  /** Lo que se calcula ahora: `undefined` si no hay emplazamiento en la capa, o ni punto ni celda. */
  readonly pedido: () => PedidoServicio | undefined;
  /**
   * El último resultado del emplazamiento seleccionado. Mientras se arrastra el punto se queda el
   * anterior hasta que llega el nuevo; con otro emplazamiento, se borra en el acto.
   */
  readonly calculado: () => ServicioCalculado | undefined;
  /** Si el último cálculo ha fallado. */
  readonly fallo: () => boolean;
  readonly orientacion: Orientacion;
}

export const ServicioContexto = createContext<ServicioDelMapa>();

/**
 * El sector que da servicio al punto de referencia desde el emplazamiento seleccionado, y el
 * degradado de su celda en el mapa. Se calcula en el simulador (en el navegador, su Worker) cada
 * vez que cambia el emplazamiento, el punto o la celda.
 *
 * Al arrastrar el punto llegan muchos cambios seguidos. No se interrumpe el cálculo en curso,
 * porque interrumpir termina el Worker y arrancar otro cuesta más que el cálculo: se guarda el
 * último cambio y se calcula al acabar. Otro emplazamiento, quitar la selección o cerrar el mapa
 * sí cancelan el cálculo en curso.
 */
export function crearServicio(
  datos: ManagedRuntime.ManagedRuntime<Simulador, never>,
  entrada: EntradaServicio,
): ServicioDelMapa {
  const [calculado, setCalculado] = createSignal<ServicioCalculado>();
  const [fallo, setFallo] = createSignal(false);

  const pedido = createMemo((): PedidoServicio | undefined => {
    const emplazamiento = entrada.emplazamiento();
    if (emplazamiento === undefined) return undefined;
    const punto = entrada.punto();
    const celda = entrada.celda(emplazamiento.clave);
    // Sin punto ni celda no hay nada que enseñar.
    if (punto === undefined && celda === undefined) return undefined;
    return {
      clave: emplazamiento.clave,
      emplazamiento: emplazamiento.posicion,
      punto,
      celda,
      orientacion: entrada.orientacion,
    };
  });

  let enCurso: { readonly clave: string; readonly parar: AbortController } | undefined;
  let siguiente: PedidoServicio | undefined;

  const calcular = (actual: PedidoServicio) => {
    const parar = new AbortController();
    enCurso = { clave: actual.clave, parar };
    const { params, malla } = pedirServicio(actual);
    void datos
      .runPromiseExit(
        Effect.flatMap(Simulador, (simulador) => simulador.ejecutar(sectorServicio, params, malla)),
        { signal: parar.signal },
      )
      .then((salida) => {
        if (parar.signal.aborted) return;
        enCurso = undefined;
        if (Exit.isSuccess(salida)) {
          setCalculado({ pedido: actual, resultado: salida.value });
          setFallo(false);
        } else {
          setFallo(true);
        }
        const despues = siguiente;
        siguiente = undefined;
        if (despues !== undefined) calcular(despues);
      });
  };

  const cancelar = () => {
    enCurso?.parar.abort();
    enCurso = undefined;
    siguiente = undefined;
  };

  createEffect(pedido, (actual) => {
    if (actual === undefined) {
      cancelar();
      setCalculado(undefined);
      setFallo(false);
      return;
    }
    if (calculado()?.pedido.clave !== actual.clave) setCalculado(undefined);
    if (enCurso?.clave === actual.clave) {
      siguiente = actual;
      return;
    }
    cancelar();
    calcular(actual);
  });

  onSettled(() => cancelar);

  createEffect(
    () => ({ lienzo: entrada.lienzo(), calculado: calculado() }),
    ({ lienzo, calculado: actual }) => {
      lienzo?.dibujar(
        actual === undefined ? SIN_RASGOS : rasgosDe(actual.resultado, actual.pedido.emplazamiento),
      );
    },
  );

  // La línea sigue al punto sin esperar al Worker.
  createEffect(
    () => ({
      lienzo: entrada.lienzo(),
      emplazamiento: entrada.emplazamiento()?.posicion,
      punto: entrada.punto(),
    }),
    ({ lienzo, emplazamiento, punto }) => {
      lienzo?.linea(lineaDe(emplazamiento, punto));
    },
  );

  return { pedido, calculado, fallo, orientacion: entrada.orientacion };
}
