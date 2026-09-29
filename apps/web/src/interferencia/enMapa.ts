import { type Coordenada, mismaCoordenada } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { Simulador } from "@celda/sim/simulador";
import { sinr } from "@celda/sim/sinr";
import { FUENTE_INTERFERENCIA, mostrarInterferencia } from "@celda/ui/mapa/interferencia.ts";
import { mismosCampos, recurso, SIGUE_UN_GESTO } from "@celda/ui/recurso.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal } from "solid-js";

import type { ProvinciaNombrada } from "../capa/estado.ts";
import { type EstadoDeLasVecinas, mismasVecinas, VECINAS_LISTAS } from "../capa/vecinas.ts";
import {
  type EleccionVista,
  type Encuadre,
  mismaTrama,
  pedidasDeSinr,
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
  /**
   * Cómo van las provincias con estaciones cerca de lo que se ve o del punto
   * (`provinciasParaSinr`). Mientras falta alguna no se calcula nada: la trama saldría sin sus
   * estaciones. Sin esta entrada, se calcula siempre.
   */
  readonly vecinas?: () => EstadoDeLasVecinas;
}

/**
 * Cómo va el cálculo. `valor` es la señal frente a interferencia en el punto de referencia del
 * último cálculo terminado: se sigue enseñando mientras se calcula el siguiente, así que mover el
 * deslizador no deja el hueco vacío.
 */
export interface CalculoVista {
  /**
   * `esperando`: falta alguna provincia vecina y no se calcula hasta que llegue; `sin-vecinas`:
   * alguna no ha llegado y no se volverá a pedir sola.
   */
  readonly estado: "sin-pedir" | "esperando" | "sin-vecinas" | "calculando" | "lista" | "fallo";
  readonly valor: number | undefined;
  /** Si el último cálculo terminado dibujó la trama o solo el punto (mapa demasiado alejado). */
  readonly conTrama: boolean;
  /** Con `esperando` o `sin-vecinas`, las provincias que faltan. */
  readonly faltan?: ReadonlyArray<ProvinciaNombrada>;
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

  // Un cálculo por cada cosa distinta que ver. La clave se compara campo a campo; la referencia,
  // por sus coordenadas: una lectura nueva del GPS en el mismo sitio no cancela nada. Sigue al
  // deslizador y al punto que se arrastra, así que abre muchas veces por segundo; la espera va
  // dentro.
  const referencia = createMemo(() => entrada.referencia(), { equals: mismaCoordenada });
  const vecinas = createMemo(() => entrada.vecinas?.() ?? VECINAS_LISTAS, {
    equals: mismasVecinas,
  });
  recurso(
    "simulador:interferencia",
    () => {
      const lienzo = entrada.lienzo();
      const eleccion = entrada.eleccion();
      if (lienzo === undefined || !entrada.activa() || eleccion === undefined) return undefined;
      return {
        lienzo,
        emplazamientos: entrada.emplazamientos(),
        eleccion,
        encuadre: encuadre(),
        referencia: referencia(),
        vecinas: vecinas(),
        intento: intento(),
      };
    },
    ({ lienzo, emplazamientos, eleccion, encuadre, referencia, vecinas: comoVan }) => {
      if (comoVan.tipo !== "listas") {
        // Sin las estaciones del otro lado del borde la trama no sería cierta: no se dibuja.
        lienzo.dibujar(SIN_TRAMA);
        setCalculo({
          estado: comoVan.tipo === "fallo" ? "sin-vecinas" : "esperando",
          valor: undefined,
          conTrama: false,
          faltan: comoVan.provincias,
        });
        return undefined;
      }
      const pedidas = pedidasDeSinr({ emplazamientos, eleccion, encuadre, referencia });
      if (pedidas.length === 0) {
        lienzo.dibujar(SIN_TRAMA);
        setCalculo(SIN_CALCULO);
        return undefined;
      }
      setCalculo((anterior) => ({
        estado: "calculando",
        valor: anterior.valor,
        conTrama: anterior.conTrama,
      }));
      const cancelar = new AbortController();
      // Casi siempre una simulación; dos si el punto queda lejos de lo que se ve, cada una en su
      // plano (`pedidasDeSinr`).
      const calcular = Effect.gen(function* () {
        const simulador = yield* Simulador;
        const hechas = yield* Effect.forEach(pedidas, (pedida) =>
          Effect.map(simulador.ejecutar(sinr, pedida.params, pedida.malla), (resultado) => ({
            pedida,
            resultado,
          })),
        );
        const conTrama = hechas.find((h) => h.pedida.hexagonos > 0);
        const conPunto = hechas.find((h) => h.pedida.conPunto);
        return {
          trama:
            conTrama === undefined ? SIN_TRAMA : tramaEnMapa(conTrama.pedida, conTrama.resultado),
          valor:
            conPunto === undefined ? undefined : valorEnPunto(conPunto.pedida, conPunto.resultado),
        };
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
              conTrama: pedidas.some((pedida) => pedida.hexagonos > 0),
            });
          } else {
            setCalculo((anterior) => ({ ...anterior, estado: "fallo" }));
          }
        });
      return () => cancelar.abort();
    },
    { iguales: mismosCampos, maximoPorSegundo: SIGUE_UN_GESTO },
  );

  return { calculo, reintentar: () => setIntento((n) => n + 1) };
}
