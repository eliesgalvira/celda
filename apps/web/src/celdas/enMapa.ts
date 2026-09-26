import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { celdas, type ResultadoCeldas } from "@celda/sim/celdas";
import type { Coordenada } from "@celda/dominio/area";
import { Simulador } from "@celda/sim/simulador";
import { FUENTE_CELDAS, remarcarCelda } from "@celda/ui/mapa/celdas.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createSignal } from "solid-js";

import {
  type CalculoCeldas,
  type CeldasEnMapa,
  celdasEnMapa,
  pedirCeldas,
  SIN_CELDAS,
} from "./celdas.ts";

/** Lo que hace el mapa con las celdas. En las pruebas, un lienzo que apunta lo que recibe. */
export interface LienzoDeCeldas {
  /** Pone estas celdas en el mapa en lugar de las que hubiera. */
  readonly dibujar: (celdas: CeldasEnMapa) => void;
  /** Remarca la celda del emplazamiento, o ninguna con `null`. */
  readonly remarcar: (clave: string | null) => void;
}

/** El lienzo de un mapa de MapLibre: la fuente y las capas de celdas de su estilo. */
export const lienzoDelMapa = (mapa: MapaMapLibre): LienzoDeCeldas => ({
  dibujar: (datos) => {
    mapa.getSource<GeoJSONSource>(FUENTE_CELDAS)?.setData(datos);
  },
  remarcar: (clave) => remarcarCelda(mapa, clave),
});

/** De dónde salen las celdas. Cada campo es una lectura reactiva. */
export interface EntradaCeldas {
  /** El mapa donde dibujarlas, cuando está listo. */
  readonly lienzo: () => LienzoDeCeldas | undefined;
  /** Los emplazamientos de la capa. Si cambian, las celdas se vuelven a calcular. */
  readonly emplazamientos: () => ReadonlyArray<EmplazamientoDeCapa>;
  /** Si el mapa está al zoom de las celdas o más cerca. */
  readonly cerca: () => boolean;
  /** El emplazamiento seleccionado, cuya celda se remarca. */
  readonly seleccionada: () => string | null;
}

/** Las celdas ya calculadas de una capa, con el origen de su plano. */
export interface CeldasCalculadas {
  readonly emplazamientos: ReadonlyArray<EmplazamientoDeCapa>;
  readonly origen: Coordenada;
  readonly resultado: ResultadoCeldas;
}

export interface CeldasDelMapa {
  readonly calculo: () => CalculoCeldas;
  /** Las celdas de la capa vigente, cuando están listas. */
  readonly calculadas: () => CeldasCalculadas | undefined;
  /** Vuelve a pedir las celdas tras un fallo. */
  readonly reintentar: () => void;
}

/**
 * Las celdas de todos los emplazamientos de la capa en el mapa. Se calculan en el simulador (en
 * el navegador, su Worker) la primera vez que el mapa se acerca al zoom de las celdas, y una sola
 * vez por capa: después, moverse o alejarse no las recalcula. Si llega otra capa o se cierra el
 * mapa a medio cálculo, el cálculo se cancela.
 *
 * Se calculan todas y no solo las de la vista: cuestan unos 20 ms en el Worker, y así MapLibre
 * dibuja lo que se ve en cada momento sin volver a pedir nada al moverse.
 */
export function crearCeldas(
  datos: ManagedRuntime.ManagedRuntime<Simulador, never>,
  entrada: EntradaCeldas,
): CeldasDelMapa {
  const [calculo, setCalculo] = createSignal<CalculoCeldas>("sin-pedir");
  /** La capa cuyas celdas se han pedido: la vigente, en cuanto el mapa se ha acercado. */
  const [pedidas, setPedidas] = createSignal<ReadonlyArray<EmplazamientoDeCapa>>();
  const [intento, setIntento] = createSignal(0);
  const [calculadas, setCalculadas] = createSignal<CeldasCalculadas>();

  createEffect(
    () => ({ cerca: entrada.cerca(), emplazamientos: entrada.emplazamientos() }),
    ({ cerca, emplazamientos }) => {
      if (cerca && emplazamientos.length > 0) setPedidas(() => emplazamientos);
    },
  );

  createEffect(
    () => ({
      lienzo: entrada.lienzo(),
      emplazamientos: entrada.emplazamientos(),
      pedidas: pedidas(),
      intento: intento(),
    }),
    ({ lienzo, emplazamientos, pedidas: pedidasAhora }) => {
      if (lienzo === undefined) return;
      if (pedidasAhora !== emplazamientos) {
        // Otra capa, todavía sin pedir: las celdas de la anterior ya no valen.
        lienzo.dibujar(SIN_CELDAS);
        setCalculadas(undefined);
        setCalculo("sin-pedir");
        return;
      }
      setCalculo("calculando");
      const cancelar = new AbortController();
      const { origen, params } = pedirCeldas(emplazamientos);
      const calcular = Effect.gen(function* () {
        const simulador = yield* Simulador;
        const resultado = yield* simulador.ejecutar(celdas, params, {
          este: new Float64Array(0),
          norte: new Float64Array(0),
        });
        return { resultado, enMapa: celdasEnMapa(resultado, emplazamientos, origen) };
      });
      void datos.runPromiseExit(calcular, { signal: cancelar.signal }).then((salida) => {
        if (cancelar.signal.aborted) return;
        if (Exit.isSuccess(salida)) {
          lienzo.dibujar(salida.value.enMapa);
          setCalculadas({ emplazamientos, origen, resultado: salida.value.resultado });
          setCalculo("listas");
        } else {
          setCalculo("fallo");
        }
      });
      return () => cancelar.abort();
    },
  );

  createEffect(
    () => ({ lienzo: entrada.lienzo(), seleccionada: entrada.seleccionada() }),
    ({ lienzo, seleccionada }) => {
      lienzo?.remarcar(seleccionada);
    },
  );

  return { calculo, calculadas, reintentar: () => setIntento((n) => n + 1) };
}
