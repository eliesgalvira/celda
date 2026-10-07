import type { Banda } from "@celda/dominio/banda";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";

import type { ListadoCrudo, Registro } from "./extractor.ts";

/**
 * Los hechos del historial de un registro tal como se escriben (ADR 0027). Cómo se leen y se
 * repiten está en `hechos.ts`.
 */

/** Lo que el hecho guarda de un listado: lo que escribió el registro, o, si no lo da, el registro. */
export type ListadoDelHecho =
  | { readonly crudo: ListadoCrudo }
  | { readonly registro: Omit<Registro, "crudo"> };

/**
 * Lo que el hecho guarda de una ficha: el SHA-256 de su página en el archivo de páginas, que
 * tiene sus bytes, o, de una fuente sin páginas, lo leído.
 */
export type FichaDelHecho =
  | { readonly pagina: string }
  | {
      readonly leida: {
        readonly bandas: ReadonlyArray<Banda>;
        readonly medidasDeExposicion: ReadonlyArray<MedidaDeExposicion>;
      };
    };

/**
 * Un hecho por escribir, sin su fecha ni su clave, que pone quien lo escribe. Un hecho se
 * identifica por su registro (fuente y clave), su tipo y la fecha de la ejecución que lo escribe,
 * con un índice único en la base: una noche repetida o retomada no escribe dos veces el mismo
 * hecho.
 */
export type HechoNuevo =
  | {
      readonly tipo: "alta";
      readonly listado: ListadoDelHecho;
      readonly antes?: number;
      /**
       * Si el registro ya lo tenía antes de que Celda lo reconociera, desde cuándo se sabe: un
       * titular que Celda empieza a reconocer, no una estación base nueva.
       */
      readonly conocidoDesde?: number;
    }
  | {
      readonly tipo: "listado" | "vuelta";
      readonly listado: ListadoDelHecho;
      readonly cambia: boolean;
      readonly antes?: number;
    }
  | {
      readonly tipo: "ficha";
      readonly ficha: FichaDelHecho;
      readonly cambia: boolean;
      readonly antes?: number;
    }
  | { readonly tipo: "sin-ficha"; readonly antes?: number }
  | { readonly tipo: "retirada"; readonly antes?: number };

export type TipoDeHecho = HechoNuevo["tipo"] | "conocido-antes";

/** El hecho con la última vez que Celda vio lo anterior, si se sabe. */
export const conAntes = (hecho: HechoNuevo, antes: number | null | undefined): HechoNuevo =>
  antes === null || antes === undefined ? hecho : { ...hecho, antes };

/** El alta de un registro que ya estaba en el registro, desde `desde`. */
export const conocidoDesde = (hecho: HechoNuevo, desde: number | undefined): HechoNuevo =>
  desde === undefined || hecho.tipo !== "alta" ? hecho : { ...hecho, conocidoDesde: desde };

/**
 * La forma en que se guarda cada hecho. Sube cuando cambia lo que se guarda de un tipo; los
 * hechos viejos se quedan como estaban y se leen con su forma.
 */
export const FORMA_DE_HECHOS = 1;

/** El JSON de un hecho, sin su tipo, que va en su columna. */
export const datosDeHecho = (hecho: HechoNuevo): string => {
  const { tipo: _tipo, ...resto } = hecho;
  return JSON.stringify({ forma: FORMA_DE_HECHOS, ...resto });
};
