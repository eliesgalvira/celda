import type { Banda } from "@celda/dominio/banda";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";

import type { FichaCruda, ListadoCrudo, Registro } from "./extractor.ts";

/**
 * Los hechos del historial de un registro tal como se escriben (ADR 0027). Cómo se leen y se
 * repiten está en `hechos.ts`.
 */

/** Lo que el hecho guarda de un listado: lo que escribió el registro, o, si no lo da, el registro. */
export type ListadoDelHecho =
  | { readonly crudo: ListadoCrudo }
  | { readonly registro: Omit<Registro, "crudo"> };

/** Lo que el hecho guarda de una ficha: sus tablas en crudo, o, si no las da, lo leído. */
export type FichaDelHecho =
  | { readonly cruda: FichaCruda }
  | {
      readonly leida: {
        readonly bandas: ReadonlyArray<Banda>;
        readonly medidasDeExposicion: ReadonlyArray<MedidaDeExposicion>;
      };
    };

/** Un hecho por escribir, sin su fecha ni su clave, que pone quien lo escribe. */
export type HechoNuevo =
  | { readonly tipo: "alta"; readonly listado: ListadoDelHecho; readonly antes?: number }
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
      readonly pagina?: string;
      readonly antes?: number;
    }
  | { readonly tipo: "sin-ficha"; readonly antes?: number }
  | { readonly tipo: "retirada"; readonly antes?: number };

export type TipoDeHecho = HechoNuevo["tipo"] | "conocido-antes";

/** El hecho con la última vez que Celda vio lo anterior, si se sabe. */
export const conAntes = (hecho: HechoNuevo, antes: number | null | undefined): HechoNuevo =>
  antes === null || antes === undefined ? hecho : { ...hecho, antes };

/** El hecho de una ficha con el SHA-256 de su página en el archivo, si se tiene. */
export const conPagina = (hecho: HechoNuevo, pagina: string | undefined): HechoNuevo =>
  pagina === undefined || hecho.tipo !== "ficha" ? hecho : { ...hecho, pagina };

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

/**
 * El identificador de un hecho: su tipo, la fecha de la ejecución que lo escribe y el registro.
 * Una noche repetida o retomada no escribe dos veces el mismo hecho.
 */
export const idDeHecho = (tipo: TipoDeHecho, fecha: number, fuente: string, clave: string) =>
  `${tipo}:${fecha}:${fuente}:${clave}`;
