import {
  claveDeFiltro,
  type FiltroDeCompanias,
  hayFiltro,
  mismoFiltro,
  SIN_FILTRO,
} from "@celda/dominio/filtro";
import { mismosCampos, recurso } from "@celda/ui/recurso.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { createSignal } from "solid-js";

import type { AgrupacionConFiltro, ProvinciaCargada } from "../capa/nacional.ts";
import { CapaEmplazamientos } from "../capa/servicio.ts";

/**
 * Lo que se espera desde el último toque de un chip antes de redibujar el mapa con el filtro.
 * Tocar varios chips seguidos (en menos de esto entre uno y otro) hace un solo cálculo, y el
 * Worker no recibe los filtros de paso. El chip cambia en el acto.
 */
export const ESPERA_DEL_FILTRO_MS = 150;

/** El filtro de compañías en el mapa: el elegido, el que se dibuja y la agrupación de cada provincia. */
export interface FiltroDelMapa {
  /** El que dicen los chips: cambia en el acto al tocarlos. */
  readonly elegido: () => FiltroDeCompanias;
  /** El que dibuja el mapa: el elegido, cuando deja de cambiar (`ESPERA_DEL_FILTRO_MS`). */
  readonly aplicado: () => FiltroDeCompanias;
  /**
   * Con un filtro, la agrupación de cada provincia lista que se dibuja: la del filtro aplicado en
   * cuanto está y, mientras tanto, la que ya se veía.
   */
  readonly agrupaciones: () => ReadonlyMap<string, AgrupacionConFiltro>;
  /** Cambia el filtro desde los chips o el aviso: el mapa lo sigue tras la espera. */
  readonly elegir: (filtro: FiltroDeCompanias) => void;
}

/** De dónde sale el filtro. Cada campo es una lectura reactiva o una orden. */
export interface EntradaFiltro {
  /** El filtro guardado en los ajustes del dispositivo. */
  readonly guardado: () => FiltroDeCompanias;
  /** Lo guarda en los ajustes. */
  readonly guardar: (filtro: FiltroDeCompanias) => void;
  /** Las provincias que han llegado. */
  readonly cargadas: () => ReadonlyArray<ProvinciaCargada>;
}

/**
 * El filtro de compañías del mapa (ADR 0026). El guardado vale al momento, al abrir; uno tocado,
 * tras `ESPERA_DEL_FILTRO_MS`. Con un filtro aplicado, pide al servicio de capa la agrupación de
 * cada provincia que ha llegado y aún no la tiene: una vez por provincia y filtro, sin descargar
 * nada. Volver a un filtro reciente no pide nada al Worker.
 */
export const crearFiltro = (
  datos: ManagedRuntime.ManagedRuntime<CapaEmplazamientos, never>,
  entrada: EntradaFiltro,
): FiltroDelMapa => {
  const [aplicado, setAplicado] = createSignal<FiltroDeCompanias>(SIN_FILTRO, {
    equals: mismoFiltro,
  });
  /** Si la persona ya ha tocado el filtro: desde entonces se espera a que deje de cambiar. */
  let tocado = false;

  recurso(
    "filtro:aplicar",
    entrada.guardado,
    (filtro) => {
      if (!tocado) {
        setAplicado(filtro);
        return undefined;
      }
      const espera = window.setTimeout(() => setAplicado(filtro), ESPERA_DEL_FILTRO_MS);
      return () => window.clearTimeout(espera);
    },
    { iguales: mismoFiltro },
  );

  const [agrupaciones, setAgrupaciones] = createSignal<ReadonlyMap<string, AgrupacionConFiltro>>(
    new Map(),
  );

  // La clave es el filtro y las provincias que han llegado, en texto: llegar otra provincia la
  // cambia, y las que ya tenían su agrupación no se vuelven a pedir.
  recurso(
    "capa:filtro",
    () => {
      const filtro = aplicado();
      return hayFiltro(filtro)
        ? {
            filtro: claveDeFiltro(filtro),
            provincias: entrada
              .cargadas()
              .map((p) => p.codigo)
              .join(" "),
          }
        : undefined;
    },
    ({ filtro: clave, provincias }) => {
      const filtro = aplicado();
      const ya = agrupaciones();
      const faltan = provincias
        .split(" ")
        .filter((codigo) => codigo !== "" && ya.get(codigo)?.filtro !== clave);
      if (faltan.length === 0) return undefined;
      const parar = new AbortController();
      for (const codigo of faltan) {
        void datos
          .runPromiseExit(
            Effect.flatMap(CapaEmplazamientos, (capa) => capa.agrupacion(codigo, filtro)),
            { signal: parar.signal },
          )
          .then((salida) => {
            if (parar.signal.aborted || !Exit.isSuccess(salida)) return;
            setAgrupaciones((antes) => new Map(antes).set(codigo, salida.value));
          });
      }
      return () => parar.abort();
    },
    { iguales: mismosCampos },
  );

  return {
    elegido: entrada.guardado,
    aplicado,
    agrupaciones,
    elegir: (filtro) => {
      tocado = true;
      entrada.guardar(filtro);
    },
  };
};
