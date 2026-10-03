import type { AportacionCompartible } from "./aportacion.ts";
import { contiene, type Coordenada, distanciaMetros, ESPANA, rumboGrados } from "./area.ts";
import type { MedidaPropia } from "./medida.ts";

/**
 * Las comprobaciones que hace el buzón (ADR 0020) a una aportación compartida, además de su
 * esquema: que lo que dice sea posible. Son funciones puras para que la web pueda avisar antes
 * de enviar lo mismo que rechazaría el buzón.
 */

/**
 * Lo más lejos del emplazamiento que se acepta una medida, en metros. Un móvil puede llegar a
 * oír una estación base a más distancia en el campo abierto, pero a esta ya no es la que le da
 * servicio en España: los emplazamientos rurales están a menos de 30 km unos de otros.
 */
export const DISTANCIA_MAXIMA_MEDIDA_M = 35_000;

/**
 * Por debajo de esta distancia el rumbo no dice nada y no se comprueba el sector: es el umbral
 * de la fusión (ADR 0012) y el del sector que da servicio.
 */
export const DISTANCIA_SIN_RUMBO_M = 15;

/**
 * Cuánto se puede apartar el rumbo del emplazamiento a la medida del azimut del sector al que
 * dice estar unida: la mitad de un sector de 120° más los ±15° de margen del azimut.
 */
export const MARGEN_SECTOR_GRADOS = 75;

/** Lo más que puede ir adelantado el reloj del dispositivo respecto al del buzón. */
export const ADELANTO_MAXIMO_MS = 10 * 60 * 1000;

/** La diferencia entre dos rumbos, en grados, de 0 a 180. */
export const diferenciaDeRumbo = (a: number, b: number): number => {
  const diferencia = Math.abs((((a - b) % 360) + 360) % 360);
  return diferencia > 180 ? 360 - diferencia : diferencia;
};

const enEspana = (punto: Coordenada): boolean => contiene(ESPANA.limites, punto);

const metros = (valor: number): string => `${Math.round(valor).toLocaleString("es-ES")} m`;

/**
 * Por qué la posición de una medida no es verosímil para el emplazamiento y el sector a los que
 * dice estar unida, o `undefined` si lo es.
 */
export const motivoMedidaNoVerosimil = (medida: MedidaPropia): string | undefined => {
  const { punto, unidaA } = medida;
  if (!enEspana(punto)) return "la medida está fuera de España";
  if (!enEspana(unidaA.posicion)) return "el emplazamiento está fuera de España";
  const distancia = distanciaMetros(unidaA.posicion, punto);
  if (distancia > DISTANCIA_MAXIMA_MEDIDA_M) {
    return `la medida está a ${metros(distancia)} del emplazamiento, más de ${metros(DISTANCIA_MAXIMA_MEDIDA_M)}`;
  }
  if (unidaA.azimut !== null && distancia > DISTANCIA_SIN_RUMBO_M) {
    const rumbo = rumboGrados(unidaA.posicion, punto);
    const desvio = diferenciaDeRumbo(rumbo, unidaA.azimut);
    if (desvio > MARGEN_SECTOR_GRADOS) {
      return `la medida queda a ${Math.round(desvio)}° del sector al que dice estar unida`;
    }
  }
  return undefined;
};

/**
 * Por qué el buzón no aceptaría una aportación que ya cumple su esquema, o `undefined` si la
 * aceptaría. `ahora` es la hora del buzón, en milisegundos.
 */
export const motivoNoAceptable = (
  aportacion: AportacionCompartible,
  ahora: number,
): string | undefined => {
  if (aportacion.creada > ahora + ADELANTO_MAXIMO_MS) return "la fecha de creación es futura";
  switch (aportacion.tipo) {
    case "propia":
      return motivoMedidaNoVerosimil(aportacion);
    case "correccion-propuesta": {
      const { cambio } = aportacion;
      return (cambio.tipo === "posicion" || cambio.tipo === "falta") && !enEspana(cambio.posicion)
        ? "el punto propuesto está fuera de España"
        : undefined;
    }
    case "corroboracion":
      return undefined;
  }
};
