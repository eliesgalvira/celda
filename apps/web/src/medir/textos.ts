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
  excelente: "La potencia es excelente, como cerca del emplazamiento.",
  buena: "La potencia es buena y basta para navegar y llamar.",
  regular: "La potencia es regular y con paredes de por medio puede ir lenta.",
  mala: "La potencia es mala. Por debajo de −100 dBm la conexión se corta.",
};

const EXPLICACION_CALIDAD: Readonly<Record<NivelDeCalidad, string>> = {
  excelente: "La calidad es excelente, casi sin interferencias.",
  buena: "La calidad es buena, con algo de interferencia.",
  regular: "La calidad es regular. Hay interferencia y la velocidad baja.",
  mala: "La calidad es mala. La interferencia corta la conexión aunque llegue potencia.",
};

const NOMBRE_RED: Readonly<Record<TipoDeRed, string>> = {
  "2g": "2G",
  "3g": "3G",
  "4g": "4G",
  "5g": "5G",
};

/** Para qué sirve una banda, de «llega más lejos» a «más velocidad». */
export const explicacionBanda = (mhz: Mhz): string => {
  if (mhz <= 900) return "Es una banda baja, de mucho alcance y menos velocidad.";
  if (mhz <= 2100) return "Es una banda media, con alcance y velocidad intermedios.";
  return "Es una banda alta, de más velocidad y menos alcance.";
};

/** Los valores de una lectura, cada uno con lo que quiere decir y su nombre técnico al final. */
export const valoresDeLaLectura = (senal: LecturaDeSenal): ReadonlyArray<ValorDeSenal> => {
  const potencia = potenciaDeLaSenal(senal.rsrpDbm);
  const valores: Array<ValorDeSenal> = [
    {
      nombre: "Compañía",
      valor: NOMBRE_COMPANIA[senal.compania],
    },
    {
      nombre: "Tipo de red",
      valor: NOMBRE_RED[senal.red],
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
        "Distingue el sector que da servicio de los de alrededor. Su nombre técnico es PCI.",
    });
  }
  return valores;
};
