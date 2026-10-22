import type { AportacionCompartible, Cambio, CorreccionPropuesta } from "@celda/dominio/aportacion";
import { type Coordenada, distanciaMetros, rumboGrados } from "@celda/dominio/area";
import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { enumerar } from "@celda/dominio/enumerar";
import type { MedidaPropia } from "@celda/dominio/medida";
import type { DatoQueSale } from "@celda/ui/buzon/Compartir.tsx";

import { fechaCorta } from "../ficha/textos.ts";
import { valoresDeLaLectura } from "../medir/textos.ts";
import { nombreRumbo } from "../ubicacion/textos.ts";
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

/** Hacia dónde queda un punto visto desde otro, con la rosa de ocho rumbos: «al noreste». */
export const haciaDonde = (desde: Coordenada, hasta: Coordenada): string =>
  `al ${nombreRumbo(rumboGrados(desde, hasta))}`;

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
      return "Respaldo a una corrección";
  }
};

/**
 * La línea de detalle de una aportación en la lista del dispositivo: cuándo se creó y, de una
 * medida, su potencia. La clave del emplazamiento no sale: es interna y no dice nada a quien lee.
 */
export const detalleDeAportacion = (aportacion: AportacionCompartible): string => {
  const cuando = `Del ${fechaYHora(aportacion.creada)}`;
  return aportacion.tipo === "propia"
    ? `${cuando} · ${String(aportacion.senal.rsrpDbm).replace("-", "−")} dBm`
    : cuando;
};

const datosDeMedida = (medida: MedidaPropia): ReadonlyArray<DatoQueSale> => [
  ...valoresDeLaLectura(medida.senal).map(({ nombre, valor }) => ({ nombre, valor })),
  { nombre: "Dónde la tomaste", valor: textoCoordenada(medida.punto) },
  { nombre: "Código del emplazamiento que daba servicio", valor: medida.unidaA.emplazamiento },
  { nombre: "Posición del emplazamiento", valor: textoCoordenada(medida.unidaA.posicion) },
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
 * se envía. Con lo que va en el sobre de toda aportación: su identificador y su fecha. Los códigos
 * se enseñan tal cual porque es lo que sale, pero su nombre dice qué son.
 */
export const queSale = (aportacion: AportacionCompartible): ReadonlyArray<DatoQueSale> => {
  const sobre: ReadonlyArray<DatoQueSale> = [
    { nombre: "Creada", valor: fechaYHora(aportacion.creada) },
    { nombre: "Código al azar de esta aportación", valor: aportacion.id },
  ];
  switch (aportacion.tipo) {
    case "propia":
      return [...datosDeMedida(aportacion), ...sobre];
    case "correccion-propuesta":
      return [
        ...(aportacion.emplazamiento === null
          ? []
          : [{ nombre: "Código del emplazamiento", valor: aportacion.emplazamiento }]),
        ...datosDeCambio(aportacion),
        { nombre: "Nota", valor: aportacion.nota ?? "sin nota" },
        ...sobre,
      ];
    case "corroboracion":
      return [
        { nombre: "Código del emplazamiento", valor: aportacion.emplazamiento },
        { nombre: "Código de la corrección que respaldas", valor: aportacion.correccion },
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

const SE_QUEDA = "Sigue guardada en este dispositivo para enviarla más tarde.";

/** Qué ha pasado, por qué si se sabe y qué hacer. `ahora` es la hora local, en milisegundos. */
export const textosDelFallo = (fallo: FalloAlCompartir, ahora: number): TextosDelFallo => {
  switch (fallo._tag) {
    case "LimiteDelBuzon": {
      const espera = cuantoFalta(fallo.reintentarA - ahora);
      switch (fallo.ambito) {
        case "dispositivo":
          return {
            titulo: "Has enviado varias seguidas",
            texto: `Prueba dentro de ${espera}. ${SE_QUEDA}`,
          };
        case "ip":
          return {
            titulo: "Muchas aportaciones desde tu red",
            texto: `Pasa con los datos móviles o en una red compartida. Prueba dentro de ${espera}. ${SE_QUEDA}`,
          };
        case "total":
          return {
            titulo: "El buzón está lleno por hoy",
            texto: `Prueba dentro de ${espera}. ${SE_QUEDA}`,
          };
      }
    }
    case "BuzonCerrado":
      return {
        titulo: "El buzón está cerrado",
        texto: SE_QUEDA,
      };
    case "BuzonSinRespuesta":
      return {
        titulo: "No se ha podido enviar",
        texto: `Puede que falle la conexión. ${SE_QUEDA}`,
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
        texto: `No se ha aceptado porque ${fallo.motivo}.`,
      };
    // El motivo es el error del navegador, en inglés y técnico: no se enseña.
    case "AlmacenNoDisponible":
      return {
        titulo: "No se ha podido guardar en este dispositivo",
        texto:
          "Este navegador no deja guardarla antes de enviarla, como pasa en algunas ventanas privadas.",
      };
  }
};
