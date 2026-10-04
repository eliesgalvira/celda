import { cva } from "class-variance-authority";

/**
 * El tamaño de los hexágonos de las agrupaciones y las zonas según lo lejos que está el mapa (ADR
 * 0024, D1 «Datos discretos»). De lejos son más pequeños y algo translúcidos, para que los rótulos
 * de lugar se lean; de cerca, de su tamaño. Los logos de los emplazamientos no cambian. Qué tamaño
 * toca a cada zoom lo decide la web.
 *
 * - `lejos`: a 0,62, por debajo del zoom 9.
 * - `medio`: a 0,8, en el 9 y el 10.
 * - `cerca`: a 0,88, en el 11 y el 12.
 * - `normal`: entero, desde el 13.
 */
export type TamanoDeMarcador = "lejos" | "medio" | "cerca" | "normal";

/** La escala del hexágono de cada tamaño. */
export const ESCALA_DE_TAMANO: Readonly<Record<TamanoDeMarcador, number>> = {
  lejos: 0.62,
  medio: 0.8,
  cerca: 0.88,
  normal: 1,
};

/**
 * La escala de la cinta con el nombre de una zona, sea cual sea la del hexágono: a 0,85 se lee de
 * lejos y no tapa tanto de cerca.
 */
export const ESCALA_DE_CINTA = 0.85;

/**
 * Lo que encoge el hexágono, sin tocar su sitio ni el botón, que sigue midiendo 44 px como mínimo.
 * Va en un envoltorio propio: el `scale` del hexágono es el de pasar el ratón por encima.
 */
export const variantesTamano = cva("block origin-center", {
  variants: {
    tamano: {
      lejos: "scale-[0.62]",
      medio: "scale-[0.8]",
      cerca: "scale-[0.88]",
      normal: "",
    },
  },
});

/**
 * El dibujo del hexágono, algo translúcido mientras va encogido: deja ver el mapa base debajo. El
 * número sigue opaco.
 */
export const variantesDibujo = cva("absolute inset-0 size-full", {
  variants: {
    tamano: {
      lejos: "opacity-82",
      medio: "opacity-82",
      cerca: "opacity-82",
      normal: "",
    },
  },
});

/**
 * Dónde empieza la cinta del nombre, desde el centro del hexágono: justo bajo el hexágono ya
 * encogido (28 px por la escala) y 2 px más abajo. La cinta va a `ESCALA_DE_CINTA` desde arriba.
 */
export const variantesCinta = cva(
  "absolute left-1/2 mt-0.5 flex w-max max-w-38 origin-top -translate-x-1/2 scale-85 flex-col items-center drop-shadow-marcador",
  {
    variants: {
      tamano: {
        lejos: "top-[calc(50%+17.36px)]",
        medio: "top-[calc(50%+22.4px)]",
        cerca: "top-[calc(50%+24.64px)]",
        normal: "top-full",
      },
    },
  },
);
