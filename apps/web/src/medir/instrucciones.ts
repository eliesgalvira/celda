import {
  CODIGO_ANDROID_GENERAL,
  CODIGO_IPHONE,
  CODIGOS_POR_MARCA,
  type CodigoModoInformacion,
  type MarcaAndroid,
} from "@celda/dominio/modoInformacion";

import type { Dispositivo, TipoDeDispositivo } from "./dispositivo.ts";

/** La marca que se elige a mano: una de la tabla, u «otra» para probar el código general. */
export type MarcaElegida = MarcaAndroid | "otra";

/** Lo que el paso de medir enseña, según el dispositivo y la marca. */
export type Instrucciones =
  | { readonly tipo: "ordenador" }
  | { readonly tipo: "desconocido" }
  | { readonly tipo: "iphone"; readonly codigo: CodigoModoInformacion }
  | {
      readonly tipo: "android";
      /** La marca vigente, o nada si ni se ha reconocido ni se ha elegido. */
      readonly marca: MarcaElegida | undefined;
      /** Si la marca sale del navegador y no de la persona. */
      readonly deducida: boolean;
      /** Sin marca no hay código: no se adivina. */
      readonly codigo: CodigoModoInformacion | undefined;
    };

/** Lo que la persona ha corregido a mano de lo que se dedujo del navegador. */
export interface Eleccion {
  readonly tipo?: TipoDeDispositivo | undefined;
  readonly marca?: MarcaElegida | undefined;
}

/** El código de una marca elegida; con «otra», el general de Android. */
export const codigoDe = (marca: MarcaElegida): CodigoModoInformacion =>
  marca === "otra" ? CODIGO_ANDROID_GENERAL : CODIGOS_POR_MARCA[marca];

/**
 * Las instrucciones para un dispositivo. Lo elegido a mano gana a lo deducido. Si el Android no
 * tiene marca, no hay código hasta que se elija.
 */
export const instruccionesPara = (detectado: Dispositivo, eleccion: Eleccion): Instrucciones => {
  const tipo = eleccion.tipo ?? detectado.tipo;
  switch (tipo) {
    case "ordenador":
      return { tipo: "ordenador" };
    case "desconocido":
      return { tipo: "desconocido" };
    case "iphone":
      return { tipo: "iphone", codigo: CODIGO_IPHONE };
    case "android": {
      const deducida = detectado.tipo === "android" ? detectado.marca : undefined;
      const marca = eleccion.marca ?? deducida;
      return {
        tipo: "android",
        marca,
        deducida: eleccion.marca === undefined && deducida !== undefined,
        codigo: marca === undefined ? undefined : codigoDe(marca),
      };
    }
  }
};
