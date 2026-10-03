import type { AportacionCompartible, Cambio, CorreccionPropuesta } from "@celda/dominio/aportacion";
import { type Coordenada, distanciaMetros, rumboGrados } from "@celda/dominio/area";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { MedidaPropia } from "@celda/dominio/medida";
import type { DatoQueSale } from "@celda/ui/buzon/Compartir.tsx";

import { enumerar, fechaCorta } from "../ficha/textos.ts";
import { valoresDeLaLectura } from "../medir/textos.ts";
import type { FalloAlCompartir } from "./sincronizacion.ts";

/** Una coordenada como se lee: latitud y longitud con cinco decimales, unos 1 m. */
export const textoCoordenada = (punto: Coordenada): string =>
  `${punto.latitud.toFixed(5)}, ${punto.longitud.toFixed(5)}`;

const HORA = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

/** Una fecha con su hora: «3 oct 2026, 12:00». */
export const fechaYHora = (fecha: number): string => `${fechaCorta(fecha)}, ${HORA.format(fecha)}`;

const RUMBOS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];

/** Hacia dónde queda un punto visto desde otro, con la rosa de ocho rumbos: «al noreste». */
export const haciaDonde = (desde: Coordenada, hasta: Coordenada): string =>
  `al ${RUMBOS[Math.round(rumboGrados(desde, hasta) / 45) % 8] ?? "norte"}`;

/** Una distancia redondeada para leerla: metros hasta 1 km y kilómetros con una cifra después. */
export const textoDistancia = (metros: number): string =>
  metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1).replace(".", ",")} km`;

/** Lo que dice el cambio de una corrección propuesta, en una frase. */
export const textoCambio = (cambio: Cambio, desde?: Coordenada): string => {
  switch (cambio.tipo) {
    case "posicion":
      return desde === undefined
        ? `Está en ${textoCoordenada(cambio.posicion)}`
        : `Está a ${textoDistancia(distanciaMetros(desde, cambio.posicion))} ${haciaDonde(desde, cambio.posicion)}, en ${textoCoordenada(cambio.posicion)}`;
    case "compania":
      return `${NOMBRE_COMPANIA[cambio.compania]} ${cambio.esta ? "está" : "no está"} en este emplazamiento`;
    case "ya-no-existe":
      return "El emplazamiento ya no existe";
    case "falta":
      return `Falta un emplazamiento de ${enumerar(cambio.companias.map((c) => NOMBRE_COMPANIA[c]))} en ${textoCoordenada(cambio.posicion)}`;
  }
};

/** El título de una aportación en la lista del dispositivo. */
export const tituloDeAportacion = (aportacion: AportacionCompartible): string => {
  switch (aportacion.tipo) {
    case "propia":
      return `Medida de ${NOMBRE_COMPANIA[aportacion.senal.compania]}, ${aportacion.senal.red.toUpperCase()}`;
    case "correccion-propuesta":
      return textoCambio(aportacion.cambio);
    case "corroboracion":
      return "Respaldas una corrección";
  }
};

/** La línea de detalle de una aportación en la lista del dispositivo. */
export const detalleDeAportacion = (aportacion: AportacionCompartible): string => {
  const cuando = `Del ${fechaYHora(aportacion.creada)}`;
  switch (aportacion.tipo) {
    case "propia":
      return `${cuando} · ${String(aportacion.senal.rsrpDbm).replace("-", "−")} dBm junto a ${aportacion.unidaA.emplazamiento}`;
    case "correccion-propuesta":
      return aportacion.emplazamiento === null ? cuando : `${cuando} · ${aportacion.emplazamiento}`;
    case "corroboracion":
      return `${cuando} · ${aportacion.emplazamiento}`;
  }
};

const datosDeMedida = (medida: MedidaPropia): ReadonlyArray<DatoQueSale> => [
  ...valoresDeLaLectura(medida.senal).map(({ nombre, valor }) => ({ nombre, valor })),
  { nombre: "Dónde la tomaste", valor: textoCoordenada(medida.punto) },
  { nombre: "Emplazamiento que daba servicio", valor: medida.unidaA.emplazamiento },
  { nombre: "Posición del emplazamiento", valor: textoCoordenada(medida.unidaA.posicion) },
  {
    nombre: "Orientación del sector",
    valor: medida.unidaA.azimut === null ? "no se sabe" : `${Math.round(medida.unidaA.azimut)}°`,
  },
];

const datosDeCambio = (correccion: CorreccionPropuesta): ReadonlyArray<DatoQueSale> => {
  const { cambio } = correccion;
  const tipo = { nombre: "Qué propones", valor: textoCambio(cambio) };
  switch (cambio.tipo) {
    case "posicion":
      return [tipo, { nombre: "Punto propuesto", valor: textoCoordenada(cambio.posicion) }];
    case "compania":
      return [
        tipo,
        { nombre: "Compañía", valor: NOMBRE_COMPANIA[cambio.compania] },
        { nombre: "Está", valor: cambio.esta ? "Sí" : "No" },
      ];
    case "ya-no-existe":
      return [tipo];
    case "falta":
      return [
        tipo,
        { nombre: "Punto", valor: textoCoordenada(cambio.posicion) },
        {
          nombre: "Compañías",
          valor: enumerar(cambio.companias.map((c) => NOMBRE_COMPANIA[c])),
        },
      ];
  }
};

/**
 * Todo lo que sale del dispositivo al compartir la aportación, dato a dato y con el valor tal como
 * se envía. Con lo que va en el sobre de toda aportación: su identificador y su fecha.
 */
export const queSale = (aportacion: AportacionCompartible): ReadonlyArray<DatoQueSale> => {
  const sobre: ReadonlyArray<DatoQueSale> = [
    { nombre: "Creada", valor: fechaYHora(aportacion.creada) },
    { nombre: "Identificador", valor: aportacion.id },
  ];
  switch (aportacion.tipo) {
    case "propia":
      return [...datosDeMedida(aportacion), ...sobre];
    case "correccion-propuesta":
      return [
        ...(aportacion.emplazamiento === null
          ? []
          : [{ nombre: "Emplazamiento", valor: aportacion.emplazamiento }]),
        ...datosDeCambio(aportacion),
        { nombre: "Nota", valor: aportacion.nota ?? "sin nota" },
        ...sobre,
      ];
    case "corroboracion":
      return [
        { nombre: "Emplazamiento", valor: aportacion.emplazamiento },
        { nombre: "Corrección que respaldas", valor: aportacion.correccion },
        ...sobre,
      ];
  }
};

/** Cuánto falta para una hora, para leerlo: «1 min», «3 h». */
export const cuantoFalta = (ms: number): string => {
  const minutos = Math.max(1, Math.ceil(ms / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.ceil(minutos / 60);
  return horas === 1 ? "1 hora" : `${horas} horas`;
};

/** Lo que dice la interfaz cuando una aportación no se ha podido compartir. */
export interface TextosDelFallo {
  readonly titulo: string;
  readonly texto: string;
}

const SE_QUEDA =
  "Se queda guardada en este dispositivo y puedes enviarla más tarde desde «Tus aportaciones».";

/** Qué ha pasado, por qué si se sabe y qué hacer. `ahora` es la hora local, en milisegundos. */
export const textosDelFallo = (fallo: FalloAlCompartir, ahora: number): TextosDelFallo => {
  switch (fallo._tag) {
    case "LimiteDelBuzon": {
      const espera = cuantoFalta(fallo.reintentarA - ahora);
      switch (fallo.ambito) {
        case "dispositivo":
          return {
            titulo: "Has enviado varias seguidas",
            texto: `El buzón recibe unas pocas de cada dispositivo a la vez. Podrás enviar esta dentro de ${espera}. ${SE_QUEDA}`,
          };
        case "ip":
          return {
            titulo: "Muchas aportaciones desde tu red",
            texto: `Desde tu conexión se han enviado muchas hoy. Pasa con los datos móviles o una red compartida, como la de una universidad. Prueba dentro de ${espera}. ${SE_QUEDA}`,
          };
        case "total":
          return {
            titulo: "El buzón está lleno por hoy",
            texto: `Celda recibe un número limitado de aportaciones al día para no quedarse sin servicio. Prueba dentro de ${espera}. ${SE_QUEDA}`,
          };
      }
    }
    case "BuzonCerrado":
      return {
        titulo: "El buzón está cerrado",
        texto: `Ahora mismo Celda no recibe aportaciones. ${SE_QUEDA}`,
      };
    case "BuzonSinRespuesta":
      return {
        titulo: "No se ha podido enviar",
        texto: `El buzón no ha contestado: puede fallar la conexión o estar parado. El mapa sigue funcionando. ${SE_QUEDA}`,
      };
    case "EnvioVetado":
      return {
        titulo: "Celda no acepta aportaciones de aquí",
        texto:
          fallo.que === "identidad"
            ? "La moderación ha bloqueado las aportaciones de este dispositivo."
            : "La moderación ha bloqueado por hoy las aportaciones desde esta red.",
      };
    case "EnvioNoValido":
      return {
        titulo: "El buzón no acepta esta aportación",
        texto: `No es posible: ${fallo.motivo}.`,
      };
    case "AlmacenNoDisponible":
      return {
        titulo: "No se ha podido guardar en este dispositivo",
        texto: `Sin guardarla no se envía. ${fallo.motivo}.`,
      };
  }
};
