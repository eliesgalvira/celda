import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/** Una medida de exposición del ministerio, ya escrita. */
export interface FilaDeExposicion {
  /** «55 m». */
  readonly distancia: string;
  /** Hacia dónde queda el punto de medida visto desde la antena: «suroeste». */
  readonly direccion: string;
  /** En µW/cm², sin la unidad, que va en la cabecera: «2,15». */
  readonly valor: string;
  /** Cómo queda frente a las de su zona, si se compara. */
  readonly comparacion:
    | {
        /** De cada 100 medidas de su zona, cuántas quedan por debajo: de 0 a 99. */
        readonly masAltaQue: number;
      }
    | undefined;
}

/** Las medidas de exposición de una compañía del emplazamiento, o por qué no las hay. */
export interface EstacionExpuesta {
  readonly compania: Compania;
  readonly nombre: string;
  readonly filas: ReadonlyArray<FilaDeExposicion>;
  /** Qué decir si no tiene ninguna. */
  readonly sinMedidas: string;
}

/** Las piezas de la sección de las medidas de exposición, una debajo de otra. */
export function PiezasExposicion(props: { readonly children: JSX.Element }) {
  return <div class="flex flex-col gap-4">{props.children}</div>;
}

const ETIQUETA = "font-mono text-[11px] leading-4 text-tinta-suave";
const EXTREMOS = `mt-1 flex justify-between ${ETIQUETA}`;
const NOTA = "text-[13px] leading-relaxed text-tinta-suave";

export interface MedidaMasAltaProps {
  /** En µW/cm², sin la unidad: «2,15». */
  readonly valor: string;
  /** Las compañías que la publican. */
  readonly companias: ReadonlyArray<Compania>;
  /** «Orange, a 55 m de la antena». */
  readonly quien: string;
  /**
   * La barra que va de 0 a la medida más alta de España, si se conoce. Lo que dice lo dice también
   * la nota, así que el lector de pantalla no la lee.
   */
  readonly barra:
    | {
        /** Qué parte de la barra llena, de 0 a 1. */
        readonly parte: number;
        /** El número del final, sin la unidad: «49,9». */
        readonly final: string;
      }
    | undefined;
  /** Cuánto es frente al nivel de referencia y hasta dónde llega la barra. */
  readonly children: JSX.Element;
}

/** La medida más alta del emplazamiento, en grande, con quién la publica y la barra. */
export function MedidaMasAlta(props: MedidaMasAltaProps) {
  return (
    <div class="flex flex-col gap-2">
      <div>
        <p class={ETIQUETA}>La medida más alta</p>
        <p class="text-[28px] leading-tight font-semibold tracking-[-0.01em] tabular-nums">
          {props.valor}
          <span class="ml-0.5 text-[15px] font-medium tracking-normal text-tinta-suave">
            µW/cm²
          </span>
        </p>
        <p class="mt-0.5 flex items-center gap-1.5 text-[13px] text-tinta-suave">
          <LogoCompanias companias={props.companias} tamano={20} />
          {props.quien}
        </p>
      </div>
      <Show when={props.barra}>
        {(barra) => (
          <div aria-hidden="true">
            <div class="h-2 overflow-hidden rounded-full bg-primario/20">
              <div
                class="h-full min-w-0.5 rounded-r-full bg-primario"
                style={{ width: `${barra().parte * 100}%` }}
              />
            </div>
            <div class={EXTREMOS}>
              <span>0</span>
              <span>{barra().final}</span>
            </div>
          </div>
        )}
      </Show>
      <p class={NOTA}>{props.children}</p>
    </div>
  );
}

const DIAMETRO = { grande: "0.75rem", fila: "0.5rem" } as const;

const variantesPuesto = cva("relative", {
  variants: { tamano: { grande: "h-3.5", fila: "h-2.5 w-15" } },
});

const variantesLineaPuesto = cva("absolute top-1/2 h-[1.5px] -translate-y-1/2 bg-linea-fuerte", {
  variants: { tamano: { grande: "inset-x-1.5", fila: "inset-x-1" } },
});

const variantesPunto = cva(
  "absolute top-1/2 -translate-y-1/2 rounded-full bg-primario shadow-[0_0_0_2px_var(--superficie)]",
  { variants: { tamano: { grande: "size-3", fila: "size-2" } } },
);

/**
 * Dónde queda una medida entre las de su zona: un punto sobre una línea que va de la más baja a la
 * más alta. Sin marcas en medio, porque la del centro siempre sería la típica y no dice nada. El
 * número va escrito al lado, así que el lector de pantalla no lo lee.
 */
function PuestoEnLinea(props: {
  /** De cada 100, cuántas quedan por debajo: de 0 a 99. */
  readonly puesto: number;
  readonly tamano: "grande" | "fila";
}) {
  return (
    <div aria-hidden="true" class={variantesPuesto({ tamano: props.tamano })}>
      <div class={variantesLineaPuesto({ tamano: props.tamano })} />
      <div
        class={variantesPunto({ tamano: props.tamano })}
        style={{ left: `calc((100% - ${DIAMETRO[props.tamano]}) * ${props.puesto / 100})` }}
      />
    </div>
  );
}

/** Una nota de la sección, como por qué una medida no se compara con su zona. */
export function NotaExposicion(props: { readonly children: JSX.Element }) {
  return <p class={NOTA}>{props.children}</p>;
}

export interface FrenteAOtrasProps {
  /** De cada 100 medidas de su zona, cuántas quedan por debajo de la más alta: de 0 a 99. */
  readonly masAltaQue: number;
  /** Con qué medidas se compara y la típica allí. */
  readonly children: JSX.Element;
}

/** Dónde queda la medida más alta entre las de su zona, teniendo en cuenta la distancia. */
export function FrenteAOtras(props: FrenteAOtrasProps) {
  return (
    <div>
      <div class="mb-1.5 flex items-baseline justify-between gap-2">
        <p class={ETIQUETA}>Frente a otras medidas</p>
        <p class="text-sm">
          más alta que <span class="font-semibold">{props.masAltaQue}</span> de 100
        </p>
      </div>
      <PuestoEnLinea puesto={props.masAltaQue} tamano="grande" />
      <div aria-hidden="true" class={EXTREMOS}>
        <span>la más baja</span>
        <span>la más alta</span>
      </div>
      <p class={`mt-1.5 ${NOTA}`}>{props.children}</p>
    </div>
  );
}

export interface MedidasDeExposicionProps {
  readonly estaciones: ReadonlyArray<EstacionExpuesta>;
}

const comparada = (estacion: EstacionExpuesta): boolean =>
  estacion.filas.some((fila) => fila.comparacion !== undefined);

const CELDA = "py-1 pr-3 align-middle";
const NUMERO = `${CELDA} text-right whitespace-nowrap`;
const CABECERA = "py-1 pr-3 align-bottom font-normal";

/**
 * Las medidas de exposición del ministerio de un emplazamiento, por compañía: una tabla con la
 * distancia, la dirección y el valor de cada medida y, si se comparan con su zona, dónde queda
 * cada una y cuántas de cada 100 quedan por debajo.
 */
export function MedidasDeExposicion(props: MedidasDeExposicionProps) {
  return (
    <div class="flex flex-col gap-3">
      <For each={props.estaciones}>
        {(estacion) => (
          <section class="flex flex-col gap-1.5 border-t border-linea pt-3 first:border-t-0 first:pt-0">
            <div class="flex items-center gap-2">
              <LogoCompanias companias={[estacion.compania]} tamano={20} />
              <p class="text-sm font-semibold">{estacion.nombre}</p>
            </div>
            <Show
              when={estacion.filas.length > 0}
              fallback={
                <p class="text-sm leading-relaxed text-tinta-suave">{estacion.sinMedidas}</p>
              }
            >
              <table class="w-full border-collapse text-sm leading-5 tabular-nums">
                <caption class="sr-only">{`Medidas de exposición de ${estacion.nombre}`}</caption>
                <thead class="text-left font-mono text-[11px] leading-4 text-tinta-suave">
                  <tr>
                    <th scope="col" class={CABECERA}>
                      Distancia
                    </th>
                    <th scope="col" class={CABECERA}>
                      Dirección
                    </th>
                    <th scope="col" class={`${CABECERA} text-right`}>
                      µW/cm²
                    </th>
                    <Show when={comparada(estacion)}>
                      <th scope="col" colspan={2} class="py-1 align-bottom font-normal">
                        Más alta que
                      </th>
                    </Show>
                  </tr>
                </thead>
                <tbody>
                  <For each={estacion.filas}>
                    {(fila) => (
                      <tr class="border-t border-linea">
                        <td class={`${CELDA} whitespace-nowrap`}>{fila.distancia}</td>
                        <td class={CELDA}>{fila.direccion}</td>
                        <td class={`${NUMERO} font-semibold`}>{fila.valor}</td>
                        <Show when={comparada(estacion)}>
                          <Show when={fila.comparacion}>
                            {(comparacion) => (
                              <>
                                <td class="py-1 pr-2.5 align-middle">
                                  <PuestoEnLinea puesto={comparacion().masAltaQue} tamano="fila" />
                                </td>
                                <td class="py-1 text-right align-middle whitespace-nowrap">
                                  {`${comparacion().masAltaQue} de 100`}
                                </td>
                              </>
                            )}
                          </Show>
                        </Show>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}
