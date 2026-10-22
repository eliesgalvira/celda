/**
 * El estado de la brújula, como función pura: la interfaz le manda eventos y enseña lo que
 * devuelve. Nunca finge una brújula: solo está activa después de una lectura de verdad, y sin
 * ella la flecha sigue a la barra, que dice que es una simulación.
 */

/** Qué ofrece el dispositivo, sin haber preguntado nada. */
export type Disponibilidad =
  /** Un ordenador: no tiene brújula, se simula con la barra (historia 36). */
  | "ordenador"
  /** El navegador no da la orientación del dispositivo, o la página no va por https. */
  | "sin-api"
  /** Hay que pedir permiso con un gesto, como en el iPhone. */
  | "con-permiso"
  /** Se puede escuchar sin pedir nada, como en Android. */
  | "sin-permiso";

/** Una lectura de la brújula. */
export interface LecturaBrujula {
  /** Hacia dónde apunta la parte de arriba del móvil, en grados desde el norte. */
  readonly rumbo: number;
  /**
   * Cuánto se puede equivocar, en grados, si el dispositivo lo dice (el iPhone lo dice; Android,
   * no). Negativo si el propio dispositivo dice que no vale.
   */
  readonly margen: number | undefined;
}

/** Por qué no hay brújula. */
export type MotivoSinSensor = "ordenador" | "sin-api" | "sin-lecturas";

export type EstadoBrujula =
  /** Se puede usar, pero no se ha pedido. */
  | { readonly tipo: "apagada" }
  /** Se explica para qué sirve antes de que el navegador pregunte. */
  | { readonly tipo: "explicando" }
  /** Esperando la respuesta al aviso del navegador. */
  | { readonly tipo: "pidiendo-permiso" }
  | { readonly tipo: "denegada" }
  /** Escuchando, sin ninguna lectura todavía. */
  | { readonly tipo: "esperando" }
  | { readonly tipo: "activa"; readonly lectura: LecturaBrujula }
  /** Llegan lecturas, pero el dispositivo dice que su margen es grande: hay que calibrarla. */
  | { readonly tipo: "dudosa"; readonly lectura: LecturaBrujula }
  | { readonly tipo: "sin-sensor"; readonly motivo: MotivoSinSensor };

export interface SituacionBrujula {
  readonly disponibilidad: Disponibilidad;
  /** Si ya se ha concedido el permiso en esta página: no hace falta explicarlo otra vez. */
  readonly concedido: boolean;
  readonly estado: EstadoBrujula;
}

export type EventoBrujula =
  /** «Usar la brújula del móvil». */
  | { readonly tipo: "usar" }
  /** Acepta la explicación: ahora el navegador pregunta. */
  | { readonly tipo: "continuar" }
  | { readonly tipo: "cancelar" }
  | { readonly tipo: "permiso"; readonly permiso: "concedido" | "denegado" }
  | { readonly tipo: "lectura"; readonly lectura: LecturaBrujula }
  /** No ha llegado ninguna lectura a tiempo. */
  | { readonly tipo: "sin-lecturas" }
  /** «Dejar la brújula». */
  | { readonly tipo: "apagar" };

/** Por encima de este margen, en grados, la brújula está mal calibrada. */
const MARGEN_DUDOSO = 20;

/** Si una lectura es de fiar, según lo que dice el dispositivo de sí mismo. */
const esDudosa = (lectura: LecturaBrujula): boolean =>
  lectura.margen !== undefined && (lectura.margen < 0 || lectura.margen > MARGEN_DUDOSO);

/** Cómo empieza la brújula en un dispositivo. */
export const inicialBrujula = (disponibilidad: Disponibilidad): SituacionBrujula => ({
  disponibilidad,
  concedido: false,
  estado:
    disponibilidad === "ordenador" || disponibilidad === "sin-api"
      ? { tipo: "sin-sensor", motivo: disponibilidad }
      : { tipo: "apagada" },
});

const con = (situacion: SituacionBrujula, estado: EstadoBrujula): SituacionBrujula => ({
  ...situacion,
  estado,
});

/** El estado según la lectura: activa o, si el dispositivo duda, dudosa. */
const segunLectura = (lectura: LecturaBrujula): EstadoBrujula =>
  esDudosa(lectura) ? { tipo: "dudosa", lectura } : { tipo: "activa", lectura };

/** Lo que pasa al pedir la brújula: explicar antes si el navegador va a preguntar. */
const empezar = (situacion: SituacionBrujula): SituacionBrujula =>
  con(
    situacion,
    situacion.disponibilidad === "con-permiso" && !situacion.concedido
      ? { tipo: "explicando" }
      : { tipo: "esperando" },
  );

/** El siguiente estado de la brújula. Un evento que no toca en un estado lo deja como estaba. */
export const transicionBrujula = (
  situacion: SituacionBrujula,
  evento: EventoBrujula,
): SituacionBrujula => {
  const { estado } = situacion;
  switch (estado.tipo) {
    case "sin-sensor":
      // Sin brújula en el dispositivo, no hay nada que pedir. Si solo faltaron lecturas, se
      // puede volver a probar.
      return estado.motivo === "sin-lecturas" && evento.tipo === "usar"
        ? con(situacion, { tipo: "esperando" })
        : situacion;
    case "apagada":
    case "denegada":
      return evento.tipo === "usar" ? empezar(situacion) : situacion;
    case "explicando":
      if (evento.tipo === "continuar") return con(situacion, { tipo: "pidiendo-permiso" });
      if (evento.tipo === "cancelar") return con(situacion, { tipo: "apagada" });
      return situacion;
    case "pidiendo-permiso":
      if (evento.tipo !== "permiso") return situacion;
      return evento.permiso === "concedido"
        ? { ...situacion, concedido: true, estado: { tipo: "esperando" } }
        : con(situacion, { tipo: "denegada" });
    case "esperando":
      if (evento.tipo === "lectura") return con(situacion, segunLectura(evento.lectura));
      if (evento.tipo === "sin-lecturas") {
        return con(situacion, { tipo: "sin-sensor", motivo: "sin-lecturas" });
      }
      if (evento.tipo === "apagar") return con(situacion, { tipo: "apagada" });
      return situacion;
    case "activa":
    case "dudosa":
      if (evento.tipo === "lectura") return con(situacion, segunLectura(evento.lectura));
      if (evento.tipo === "apagar") return con(situacion, { tipo: "apagada" });
      return situacion;
  }
};

/** Si hay que escuchar la brújula del dispositivo. */
export const escuchando = (estado: EstadoBrujula): boolean =>
  estado.tipo === "esperando" || estado.tipo === "activa" || estado.tipo === "dudosa";

/** Hacia dónde apunta el móvil: la brújula si hay lectura, y si no, la barra. */
export const rumboMostrado = (
  estado: EstadoBrujula,
  simulado: number,
): { readonly rumbo: number; readonly fuente: "brujula" | "barra" } =>
  estado.tipo === "activa" || estado.tipo === "dudosa"
    ? { rumbo: estado.lectura.rumbo, fuente: "brujula" }
    : { rumbo: simulado, fuente: "barra" };

/** A menos de estos grados del objetivo, el móvil apunta al emplazamiento. */
const ALINEADO_GRADOS = 10;

/** Cuánto hay que girar y hacia dónde para apuntar al objetivo. */
export interface GuiaDeGiro {
  readonly alineado: boolean;
  /** Grados enteros que faltan, entre 0 y 180. */
  readonly grados: number;
  readonly sentido: "derecha" | "izquierda";
}

/** Cuánto girar desde `rumbo` hasta `objetivo`, por el camino más corto. */
export const guiaDeGiro = (objetivo: number, rumbo: number): GuiaDeGiro => {
  // Entre −180 y 180: positivo es girar a la derecha, en el sentido de las agujas del reloj.
  const diferencia = ((((objetivo - rumbo) % 360) + 540) % 360) - 180;
  const grados = Math.round(Math.abs(diferencia));
  return {
    alineado: grados < ALINEADO_GRADOS,
    grados,
    sentido: diferencia >= 0 ? "derecha" : "izquierda",
  };
};

/** Los datos de un evento de orientación que sirven para la brújula. */
export interface DatosDeOrientacion {
  /** `webkitCompassHeading` de Safari: ya es el rumbo, en grados desde el norte. */
  readonly rumboSafari: number | undefined;
  /** `webkitCompassAccuracy` de Safari, en grados; negativo si no vale. */
  readonly margenSafari: number | undefined;
  /** `alpha`: giro en grados, en sentido contrario a las agujas del reloj. */
  readonly alpha: number | undefined;
  /** Si `alpha` se mide desde el norte (`deviceorientationabsolute` o `absolute`). */
  readonly absoluta: boolean;
}

/**
 * El rumbo de un evento de orientación, o nada si no es una brújula. En Safari sale de
 * `webkitCompassHeading`; en el resto, de `alpha` solo si es absoluto, porque un `alpha` relativo
 * se mide desde donde apuntaba el móvil al empezar y no desde el norte. `anguloPantalla` corrige
 * el giro de la pantalla en horizontal.
 */
export const lecturaDeOrientacion = (
  datos: DatosDeOrientacion,
  anguloPantalla: number,
): LecturaBrujula | undefined => {
  const normal = (grados: number) => (((grados + anguloPantalla) % 360) + 360) % 360;
  if (datos.rumboSafari !== undefined && datos.rumboSafari >= 0) {
    return { rumbo: normal(datos.rumboSafari), margen: datos.margenSafari };
  }
  if (datos.absoluta && datos.alpha !== undefined) {
    return { rumbo: normal(360 - datos.alpha), margen: undefined };
  }
  return undefined;
};
