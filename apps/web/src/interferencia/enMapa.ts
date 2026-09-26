import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { Simulador } from "@celda/sim/simulador";
import { sinr } from "@celda/sim/sinr";
import { FUENTE_INTERFERENCIA, mostrarInterferencia } from "@celda/ui/mapa/interferencia.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal } from "solid-js";

import {
  type EleccionVista,
  type Encuadre,
  mismaTrama,
  pedirSinr,
  SIN_TRAMA,
  type TramaEnMapa,
  tramaEnMapa,
  valorEnPunto,
} from "./interferencia.ts";

/** Lo que hace el mapa con la vista. En las pruebas, un lienzo que apunta lo que recibe. */
export interface LienzoDeInterferencia {
  /** Pone esta trama en lugar de la que hubiera. */
  readonly dibujar: (trama: TramaEnMapa) => void;
  /** Enseña u oculta la trama, y con ella cambia cómo se ven las celdas. */
  readonly mostrar: (activa: boolean) => void;
}

/** El lienzo de un mapa de MapLibre: la fuente y la capa de la vista de su estilo. */
export const lienzoDelMapa = (mapa: MapaMapLibre): LienzoDeInterferencia => ({
  dibujar: (trama) => {
    mapa.getSource<GeoJSONSource>(FUENTE_INTERFERENCIA)?.setData(trama);
  },
  mostrar: (activa) => mostrarInterferencia(mapa, activa),
});

/** Lo que necesita la vista. Cada campo es una lectura reactiva. */
export interface EntradaInterferencia {
  readonly lienzo: () => LienzoDeInterferencia | undefined;
  readonly activa: () => boolean;
  readonly emplazamientos: () => ReadonlyArray<EmplazamientoDeCapa>;
  /** La compañía, la banda y la ocupación elegidas; nada mientras no hay capa. */
  readonly eleccion: () => EleccionVista | undefined;
  /** Lo que se ve, puesto al pararse el mapa. */
  readonly encuadre: () => Encuadre | undefined;
  readonly referencia: () => Coordenada | undefined;
}

/**
 * Cómo va el cálculo. `valor` es la señal frente a interferencia en el punto de referencia del
 * último cálculo terminado: se sigue enseñando mientras se calcula el siguiente, así que mover el
 * deslizador no deja el hueco vacío.
 */
export interface CalculoVista {
  readonly estado: "sin-pedir" | "calculando" | "lista" | "fallo";
  readonly valor: number | undefined;
  /** Si el último cálculo terminado dibujó la trama o solo el punto (mapa demasiado alejado). */
  readonly conTrama: boolean;
}

const SIN_CALCULO: CalculoVista = { estado: "sin-pedir", valor: undefined, conTrama: false };

/**
 * Espera tras el último cambio antes de calcular. Mover el deslizador o arrastrar el punto
 * cambian la elección muchas veces por segundo; cada cálculo cancelado a medias termina el
 * Worker, así que se calcula cuando el valor se queda quieto.
 */
export const ESPERA_MS = 120;

export interface InterferenciaDelMapa {
  readonly calculo: () => CalculoVista;
  /** Vuelve a calcular tras un fallo. */
  readonly reintentar: () => void;
}

/**
 * La vista de interferencia en el mapa. Mientras está activa, cada cambio de la elección, de la
 * capa o del punto de referencia pide `sinr@1` al simulador (en el navegador, su Worker) y dibuja
 * la trama. Lo que se ve solo cuenta si sale de la trama ya calculada o cambia el tamaño de sus
 * hexágonos. Un cambio a medio cálculo lo cancela, y apagar la vista lo cancela y
 * borra la trama.
 */
export function crearInterferencia(
  datos: ManagedRuntime.ManagedRuntime<Simulador, never>,
  entrada: EntradaInterferencia,
): InterferenciaDelMapa {
  const [calculo, setCalculo] = createSignal<CalculoVista>(SIN_CALCULO);
  const [intento, setIntento] = createSignal(0);
  // Un encuadre nuevo que cae dentro de la trama ya calculada no cuenta como cambio.
  const encuadre = createMemo(() => entrada.encuadre(), { equals: mismaTrama });

  createEffect(
    () => ({ lienzo: entrada.lienzo(), activa: entrada.activa() }),
    ({ lienzo, activa }) => {
      if (lienzo === undefined) return;
      lienzo.mostrar(activa);
      if (!activa) {
        lienzo.dibujar(SIN_TRAMA);
        setCalculo(SIN_CALCULO);
      }
    },
  );

  createEffect(
    () => ({
      lienzo: entrada.lienzo(),
      activa: entrada.activa(),
      emplazamientos: entrada.emplazamientos(),
      eleccion: entrada.eleccion(),
      encuadre: encuadre(),
      referencia: entrada.referencia(),
      intento: intento(),
    }),
    ({ lienzo, activa, emplazamientos, eleccion, encuadre, referencia }) => {
      if (lienzo === undefined || !activa || eleccion === undefined) return;
      const pedida = pedirSinr({ emplazamientos, eleccion, encuadre, referencia });
      if (pedida === undefined) {
        lienzo.dibujar(SIN_TRAMA);
        setCalculo(SIN_CALCULO);
        return;
      }
      setCalculo((anterior) => ({ ...anterior, estado: "calculando" }));
      const cancelar = new AbortController();
      const calcular = Effect.gen(function* () {
        const simulador = yield* Simulador;
        const resultado = yield* simulador.ejecutar(sinr, pedida.params, pedida.malla);
        return { trama: tramaEnMapa(pedida, resultado), valor: valorEnPunto(pedida, resultado) };
      });
      void datos
        .runPromiseExit(Effect.andThen(Effect.sleep(ESPERA_MS), calcular), {
          signal: cancelar.signal,
        })
        .then((salida) => {
          if (cancelar.signal.aborted) return;
          if (Exit.isSuccess(salida)) {
            lienzo.dibujar(salida.value.trama);
            setCalculo({
              estado: "lista",
              valor: salida.value.valor,
              conTrama: pedida.hexagonos > 0,
            });
          } else {
            setCalculo((anterior) => ({ ...anterior, estado: "fallo" }));
          }
        });
      return () => cancelar.abort();
    },
  );

  return { calculo, reintentar: () => setIntento((n) => n + 1) };
}
