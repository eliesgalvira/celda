import type { Mhz } from "@celda/dominio/banda";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  calidadDeLaSenal,
  type LecturaDeSenal,
  type NivelDeCalidad,
  type NivelDePotencia,
  potenciaDeLaSenal,
  type TipoDeRed,
} from "@celda/dominio/medida";
import type { ValorDeSenal } from "@celda/ui/medir/Medir.tsx";

/** Un número negativo con el signo menos tipográfico y la coma decimal. */
const numero = (valor: number): string =>
  `${valor < 0 ? "−" : ""}${String(Math.abs(valor)).replace(".", ",")}`;

const RAYAS: Readonly<Record<NivelDePotencia, number>> = {
  excelente: 4,
  buena: 3,
  regular: 2,
  mala: 1,
};

const EXPLICACION_POTENCIA: Readonly<Record<NivelDePotencia, string>> = {
  excelente: "Excelente. Llega mucha señal, como cerca del emplazamiento o con vistas a él.",
  buena: "Buena. Llega de sobra para navegar y llamar.",
  regular: "Regular. Funciona, pero con paredes de por medio puede ir lenta.",
  mala: "Mala. Por debajo de −100 dBm la conexión empieza a cortarse.",
};

const EXPLICACION_CALIDAD: Readonly<Record<NivelDeCalidad, string>> = {
  excelente: "Excelente. La señal llega limpia, casi sin ruido de otras estaciones base.",
  buena: "Buena. Otras estaciones base o mucha gente conectada la ensucian un poco.",
  regular: "Regular. Hay bastante interferencia y la velocidad baja.",
  mala: "Mala. Hay tanta interferencia que la conexión falla aunque haya potencia.",
};

const NOMBRE_RED: Readonly<Record<TipoDeRed, string>> = {
  "2g": "2G",
  "3g": "3G",
  "4g": "4G",
  "5g": "5G",
};

/** Para qué sirve una banda, de «llega más lejos» a «más velocidad». */
export const explicacionBanda = (mhz: Mhz): string => {
  if (mhz <= 900)
    return "Banda baja. Llega lejos y entra bien en los edificios, con menos velocidad.";
  if (mhz <= 2100) return "Banda media. Equilibra alcance y velocidad.";
  return "Banda alta. Da más velocidad, pero llega menos lejos.";
};

/** Los valores de una lectura, cada uno con lo que quiere decir y su nombre técnico al final. */
export const valoresDeLaLectura = (senal: LecturaDeSenal): ReadonlyArray<ValorDeSenal> => {
  const potencia = potenciaDeLaSenal(senal.rsrpDbm);
  const valores: Array<ValorDeSenal> = [
    {
      nombre: "Compañía",
      valor: NOMBRE_COMPANIA[senal.compania],
      explicacion: "La de la tarjeta SIM del móvil.",
    },
    {
      nombre: "Tipo de red",
      valor: NOMBRE_RED[senal.red],
      explicacion: "La generación de la red a la que estaba conectado.",
    },
  ];
  if (senal.mhz !== null) {
    valores.push({
      nombre: "Banda",
      valor: `${senal.mhz} MHz`,
      explicacion: explicacionBanda(senal.mhz),
    });
  }
  valores.push({
    nombre: "Potencia de la señal",
    valor: `${numero(senal.rsrpDbm)} dBm`,
    rayas: RAYAS[potencia],
    explicacion: `${EXPLICACION_POTENCIA[potencia]} Su nombre técnico es RSRP.`,
  });
  if (senal.rsrqDb !== null) {
    valores.push({
      nombre: "Calidad de la señal",
      valor: `${numero(senal.rsrqDb)} dB`,
      explicacion: `${EXPLICACION_CALIDAD[calidadDeLaSenal(senal.rsrqDb)]} Su nombre técnico es RSRQ.`,
    });
  }
  if (senal.pci !== null) {
    valores.push({
      nombre: "Identificador del sector",
      valor: String(senal.pci),
      explicacion:
        "El número con el que el móvil distingue el sector que le da servicio de los que oye alrededor. Su nombre técnico es PCI.",
    });
  }
  return valores;
};
