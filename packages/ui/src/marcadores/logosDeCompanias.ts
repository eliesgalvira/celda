import type { Compania } from "@celda/dominio/compania";

/**
 * Cómo se dibuja cada compañía en el círculo de 40 × 40 de un marcador. Los trazos están copiados
 * tal cual de los ficheros oficiales de `logos/`, y `logos/FUENTES.md` dice de dónde sale cada
 * uno; la prueba lo comprueba. Yoigo va con su nombre y no con su logo: sus condiciones de uso no
 * dejan enseñarlo fuera de su web (ver `logos/FUENTES.md`).
 */
export type DibujoDeCompania = LogoOficial | NombreDeCompania;

/** El color de un trazo o del círculo: el de la compañía o el blanco de `--compania-tinta`. */
export type Pintura = "compania" | "blanco";

export interface TrazoDeLogo {
  /** El trazo, tal cual en su fichero de `logos/`. */
  readonly d: string;
  readonly pintura: Pintura;
}

export interface LogoOficial {
  readonly tipo: "logo";
  /** El color del círculo o de la porción que lleva el logo. */
  readonly fondo: Pintura;
  readonly trazos: ReadonlyArray<TrazoDeLogo>;
  /** La parte del lienzo del fichero que se ve, como un `viewBox`: x, y, ancho y alto. */
  readonly caja: readonly [number, number, number, number];
  /** Lo que mide de ancho esa parte en el círculo de 40 × 40, centrada en él. */
  readonly ancho: number;
}

export interface NombreDeCompania {
  readonly tipo: "nombre";
  /** El nombre, en blanco sobre el color de la compañía. */
  readonly texto: string;
}

export const DIBUJOS_DE_COMPANIAS: Readonly<Record<Compania, DibujoDeCompania>> = {
  // El isotipo de Movistar, la «M», en blanco sobre su azul, como la variante de marca de Mística.
  // Su lienzo de 72 × 72 ya lleva el margen.
  movistar: {
    tipo: "logo",
    fondo: "compania",
    trazos: [
      {
        d: "M63.95 19.77c-1.6-3.69-4.16-6.05-7.44-6.25-3.64-.24-7.8 2.18-10 6.85-2.02 4.32-3.63 8.74-4.6 11-1 2.3-2.46 3.7-4.7 3.94-2.75.3-5.11-1.7-6.84-4.54-1.51-2.47-4.5-7.18-6.1-8.77-1.5-1.48-3.23-3.34-6.8-3.29-2.83.05-8.05 1.44-10.43 11.17a33 33 0 0 0-.55 13.91 53 53 0 0 0 3.25 11.35c.34.8.86 1.62 1.26 2.13a3.4 3.4 0 0 0 3.9.98c.9-.44 1.91-1.5 1.54-3.9-.17-1.15-.69-2.85-.98-3.8-.88-2.9-2.06-6.38-2.17-8.87-.13-3.33 1.18-3.77 2.05-3.96 1.47-.32 2.7 1.29 3.87 3.3 1.39 2.41 3.78 6.68 5.73 9.94 1.76 2.94 5 6.09 10.22 5.87 5.31-.22 9.23-2.24 11.25-8.63 1.51-4.77 2.54-8.34 4.2-12 1.9-4.2 4.44-6.44 6.58-5.76 1.99.64 2.49 2.58 2.51 5.43a64 64 0 0 1-.5 7.36c-.08.74-.23 2.23-.17 3.06.12 1.63.83 3.25 2.66 3.51 1.96.28 3.52-1.28 4.15-3.17.25-.74.46-1.88.57-2.69.58-4.08.73-6.82.47-11a39 39 0 0 0-2.93-13.17",
        pintura: "blanco",
      },
    ],
    caja: [0, 0, 72, 72],
    ancho: 31,
  },
  // El icono de Vodafone: su círculo rojo es el del marcador y la comilla guarda su tamaño.
  vodafone: {
    tipo: "logo",
    fondo: "compania",
    trazos: [
      {
        d: "M157 234.94c-38.94.13-79.46-33.11-79.63-86.48-.09-35.29 18.95-69.26 43.29-89.46 23.74-19.66 56.26-32.27 85.76-32.37 3.8 0 7.77.3 10.2 1.13-25.79 5.35-46.32 29.35-46.23 56.58a15 15 0 0 0 .17 2.31c43.16 10.51 62.75 36.55 62.87 72.58s-28.32 75.55-76.43 75.71",
        pintura: "blanco",
      },
    ],
    caja: [0, 0, 311.81, 311.81],
    ancho: 41.8,
  },
  // El «Small logo» de Orange, el de menos de 50 px: cuadrado, sobre blanco y con margen alrededor.
  orange: {
    tipo: "logo",
    fondo: "blanco",
    trazos: [
      { d: "M657.508 395.996h71.484v-71.484h-71.484Zm0 0", pintura: "compania" },
      { d: "M667.723 375.574h51.058v10.215h-51.058Zm0 0", pintura: "blanco" },
    ],
    caja: [657.508, 324.512, 71.484, 71.484],
    ancho: 20,
  },
  // La «D» del logotipo de DIGI en blanco sobre su azul, como su icono.
  digi: {
    tipo: "logo",
    fondo: "compania",
    trazos: [
      {
        d: "M23.89 21.12a10.2 10.2 0 0 1-5.71 5.64c-1.97.8-4.39.8-9.3.8H7.57V7.44h1.33c4.9 0 7.38 0 9.29.8 2.6 1.04 4.67 3.11 5.7 5.65.87 2.18.93 4.94 0 7.24m6.98 2.48a17 17 0 0 0 0-12.2 17.3 17.3 0 0 0-9.64-9.55C17.95.53 13.85.53 5.54.53H0v33.94h5.54c8.25 0 12.4 0 15.7-1.32a17.4 17.4 0 0 0 9.63-9.55",
        pintura: "blanco",
      },
    ],
    caja: [0, 0.53, 32, 33.94],
    ancho: 16,
  },
  yoigo: { tipo: "nombre", texto: "yoigo" },
};
