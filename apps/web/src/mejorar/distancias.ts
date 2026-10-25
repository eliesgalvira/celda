import { llano, marcado, primeraVezEn, termino } from "@celda/dominio/glosario";
import type { GraficaDeTramosProps } from "@celda/ui/mejorar/Referencias.tsx";

/**
 * El plegable «¿A qué distancia de una antena llega bien la señal?» de «Mejorar la señal». No da
 * ninguna distancia buena, porque ninguna fuente la respalda: enseña cada cuánto se ponen los
 * emplazamientos en los modelos de 3GPP y la UIT, y cuánto se pierde al entrar en un sitio. Las
 * cifras y sus fuentes están en la investigación 10 (`docs/investigacion/distancias.md`).
 */

export const TITULO_DISTANCIAS = "¿A qué distancia de una antena llega bien la señal?";

export const TITULO_REPARTO = "¿Cada cuánto hay un emplazamiento?";

export const TITULO_PERDIDAS = "¿Qué reduce la señal en interiores?";

const [respuesta = [], sobreElReparto = [], sobreLasPerdidas = []] = primeraVezEn([
  llano(
    "No hay una distancia fija. Dos sitios a la misma distancia pueden recibir señales muy distintas por los edificios de en medio, las cuestas, hacia dónde mira la antena o cuánta gente use la red. Para saber qué llega a un sitio hay que medirlo allí.",
  ),
  marcado`Es la distancia que suele haber entre dos ${termino("emplazamiento", "emplazamientos")} de la misma compañía en los modelos con que se diseñan las redes. La parte clara de la barra es el margen que dan las fuentes.`,
  marcado`Cada 10 ${termino("decibelio", "dB")} que se pierden, la señal se divide entre diez. Por eso junto a una ventana se recibe mejor.`,
]);

export const TEXTOS_DISTANCIAS = {
  respuesta,
  reparto: sobreElReparto,
  perdidas: sobreLasPerdidas,
} as const;

export const FUENTES_REPARTO =
  "Fuentes: los informes TR 38.913 y TR 38.901 del 3GPP, el grupo que escribe los estándares de la telefonía móvil, y los informes M.2412 y M.2135 de la Unión Internacional de Telecomunicaciones. No son medidas de las redes españolas.";

export const FUENTES_PERDIDAS =
  "Fuentes: el informe TR 38.901 del 3GPP, un estudio de 2012 de Ofcom, el regulador de las telecomunicaciones del Reino Unido, y la recomendación P.2109 de la Unión Internacional de Telecomunicaciones.";

/** La gráfica entera en texto, para un lector de pantalla. */
const nombreDe = (titulo: string, filas: GraficaDeTramosProps["filas"]): string =>
  `${titulo} ${filas.map((fila) => `${fila.etiqueta}, ${fila.cifra}`).join("; ")}.`;

const filasReparto: GraficaDeTramosProps["filas"] = [
  {
    etiqueta: "Centro de ciudad grande",
    desde: 0,
    hasta: 0.2,
    cifra: "200 m",
    explicacion:
      "Centro de ciudad grande: 200 m entre emplazamientos. En ese reparto, nadie queda a más de unos 115 m de un emplazamiento.",
  },
  {
    etiqueta: "Ciudad",
    desde: 0,
    hasta: 0.5,
    margen: { desde: 0.2, hasta: 0.75 },
    cifra: "500 m",
    explicacion:
      "Ciudad: 500 m entre emplazamientos, y las fuentes admiten de 200 a 750 m. En ese reparto, nadie queda a más de unos 290 m de un emplazamiento.",
  },
  {
    etiqueta: "Afueras y pueblos",
    desde: 0,
    hasta: 1.3,
    margen: { desde: 1.2, hasta: 1.8 },
    cifra: "1,3 km",
    explicacion:
      "Afueras y pueblos: 1,3 km entre emplazamientos, y las fuentes admiten de 1,2 a 1,8 km. En ese reparto, nadie queda a más de unos 750 m de un emplazamiento.",
  },
  {
    etiqueta: "Campo",
    desde: 0,
    hasta: 1.7,
    cifra: "1,7 km",
    explicacion:
      "Campo: 1,7 km entre emplazamientos. En ese reparto, nadie queda a más de 1 km de un emplazamiento.",
  },
  {
    etiqueta: "Campo muy despoblado",
    desde: 0,
    hasta: 5.5,
    margen: { desde: 5, hasta: 6 },
    cifra: "5–6 km",
    explicacion:
      "Campo muy despoblado: de 5 a 6 km entre emplazamientos. En ese reparto, nadie queda a más de unos 3 km de un emplazamiento.",
  },
];

/** Cada cuánto hay un emplazamiento, en km, según el entorno (investigación 10, tabla A). */
export const GRAFICA_REPARTO: GraficaDeTramosProps = {
  nombre: nombreDe("Distancia entre emplazamientos según el entorno:", filasReparto),
  maximo: 8,
  marcas: [
    { valor: 0, lineas: ["0"] },
    { valor: 2, lineas: ["2 km"] },
    { valor: 4, lineas: ["4 km"] },
    { valor: 6, lineas: ["6 km"] },
  ],
  filas: filasReparto,
};

const filasPerdidas: GraficaDeTramosProps["filas"] = [
  {
    etiqueta: "Junto a una ventana",
    desde: 8,
    hasta: 16,
    cifra: "8–16 dB",
    explicacion: "Edificio corriente, junto a una ventana o una pared exterior: de 8 a 16 dB.",
  },
  {
    etiqueta: "A 10–15 m de la ventana",
    desde: 14,
    hasta: 22,
    cifra: "14–22 dB",
    explicacion:
      "De 10 a 15 m hacia dentro se pierden 6 dB más que junto a la ventana: de 14 a 22 dB.",
  },
  {
    etiqueta: "Cristales metalizados",
    desde: 18,
    hasta: 32,
    cifra: "18–32 dB",
    explicacion: "Edificio con vidrio metalizado y mucho aislamiento: de 18 a 32 dB.",
  },
  {
    etiqueta: "Dentro de un coche",
    desde: 9,
    hasta: 9,
    cifra: "9 dB",
    explicacion: "Dentro de un coche se pierden de media 9 dB.",
  },
];

/** Cuánto se pierde al entrar en un sitio, en dB (investigación 10, tabla C). */
export const GRAFICA_PERDIDAS: GraficaDeTramosProps = {
  nombre: nombreDe("Pérdida de señal en interiores:", filasPerdidas),
  maximo: 35,
  marcas: [
    { valor: 10, lineas: ["10 dB", "1/10"] },
    { valor: 20, lineas: ["20 dB", "1/100"] },
    { valor: 30, lineas: ["30 dB", "1/1000"] },
  ],
  filas: filasPerdidas,
};
