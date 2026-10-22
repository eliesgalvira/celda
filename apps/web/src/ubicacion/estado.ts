import type { PuntoElegido } from "@celda/dominio/aportacion";
import type { Coordenada } from "@celda/dominio/area";

/**
 * El estado de la ubicación como una función pura: qué punto de referencia hay y qué se está
 * haciendo para tenerlo. Nunca se da por conocida una ubicación que no lo es: una lectura del GPS
 * que llega cuando ya nadie la espera se descarta.
 */

/** Lo que dice el navegador del permiso de ubicación de esta web. */
export type Permiso = "concedido" | "preguntar" | "denegado" | "desconocido";

/** Una lectura del GPS del dispositivo. */
export interface LecturaGps {
  readonly posicion: Coordenada;
  /** Radio del círculo de precisión, en metros. */
  readonly precision: number;
  /** Cuándo la tomó el dispositivo, en milisegundos. */
  readonly fecha: number;
}

/**
 * Por qué no ha llegado la ubicación. `sin-senal`: el móvil no ha podido calcularla (interiores,
 * ubicación del sistema apagada). `sin-fuente`: el navegador de un ordenador no tiene de dónde
 * sacarla. `no-disponible`: el navegador no deja pedirla (sin https o sin la API).
 */
export type MotivoFalloGps =
  | "denegado"
  | "sin-senal"
  | "sin-fuente"
  | "tiempo-agotado"
  | "no-disponible";

/** Los estados en que la ubicación se queda hasta que la persona hace algo. */
export type EstadoAsentado =
  | { readonly tipo: "ninguna" }
  | { readonly tipo: "denegada" }
  | { readonly tipo: "gps"; readonly lectura: LecturaGps }
  | { readonly tipo: "elegida"; readonly punto: PuntoElegido }
  | { readonly tipo: "fallo"; readonly motivo: Exclude<MotivoFalloGps, "denegado"> };

/**
 * Los estados de paso guardan el asentado del que vienen: cancelar vuelve a él, y mientras tanto
 * su punto de referencia sigue siendo el que vale.
 */
export type EstadoUbicacion =
  | EstadoAsentado
  /** El paso previo que explica para qué se usa la ubicación, antes del aviso del navegador. */
  | { readonly tipo: "explicando"; readonly anterior: EstadoAsentado }
  /** Esperando al aviso del navegador o a la primera lectura del GPS. */
  | { readonly tipo: "pidiendo"; readonly anterior: EstadoAsentado }
  /** Eligiendo un punto en el mapa o con una dirección. */
  | { readonly tipo: "eligiendo"; readonly anterior: EstadoAsentado };

export interface Ubicacion {
  readonly estado: EstadoUbicacion;
  readonly permiso: Permiso;
  /**
   * Por qué acaba de fallar una petición de la ubicación, para decirlo aunque el estado vuelva a
   * un punto que ya había. Se borra con lo siguiente que haga la persona.
   */
  readonly aviso: MotivoFalloGps | undefined;
}

export type EventoUbicacion =
  /** El navegador ha dicho cómo está el permiso, al empezar o porque ha cambiado. */
  | { readonly tipo: "permiso"; readonly permiso: Permiso }
  /** Se ha leído el punto elegido que estaba guardado en el dispositivo. */
  | { readonly tipo: "restaurado"; readonly punto: PuntoElegido }
  | { readonly tipo: "usar-ubicacion" }
  /** La persona acepta el paso previo: ahora sí se pide el permiso. */
  | { readonly tipo: "continuar" }
  | { readonly tipo: "cancelar" }
  | { readonly tipo: "elegir-en-mapa" }
  | { readonly tipo: "lectura"; readonly lectura: LecturaGps }
  | { readonly tipo: "fallo-gps"; readonly motivo: MotivoFalloGps }
  /** Un punto elegido nuevo, o el mismo arrastrado a otro sitio. */
  | { readonly tipo: "elegido"; readonly punto: PuntoElegido }
  | { readonly tipo: "quitar" }
  | { readonly tipo: "cerrar-aviso" };

export const INICIAL: Ubicacion = {
  estado: { tipo: "ninguna" },
  permiso: "desconocido",
  aviso: undefined,
};

const NINGUNA: EstadoAsentado = { tipo: "ninguna" };
const DENEGADA: EstadoAsentado = { tipo: "denegada" };

/** El asentado que vale ahora: el propio, o del que viene un estado de paso. */
export const asentado = (estado: EstadoUbicacion): EstadoAsentado =>
  estado.tipo === "explicando" || estado.tipo === "pidiendo" || estado.tipo === "eligiendo"
    ? estado.anterior
    : estado;

/** Sin punto de referencia: denegada si el permiso está bloqueado y ninguna si no. */
const sinPunto = (permiso: Permiso): EstadoAsentado =>
  permiso === "denegado" ? DENEGADA : NINGUNA;

/**
 * Lo que sale del GPS del dispositivo: su lectura o por qué no la ha dado. Con el permiso
 * bloqueado deja de valer. `no-disponible` no depende del permiso: sin https o sin la API,
 * desbloquearlo no lo arregla.
 */
const delGps = (estado: EstadoUbicacion): boolean =>
  estado.tipo === "gps" || (estado.tipo === "fallo" && estado.motivo !== "no-disponible");

/**
 * Un asentado al día con el permiso: sin punto, pasa a denegada o a ninguna, y lo que salió del
 * GPS deja de valer si se bloquea. El punto elegido no depende del permiso.
 */
const conPermiso = (estado: EstadoAsentado, permiso: Permiso): EstadoAsentado => {
  if (estado.tipo === "ninguna" || estado.tipo === "denegada") return sinPunto(permiso);
  return delGps(estado) && permiso === "denegado" ? DENEGADA : estado;
};

const alCambiarPermiso = (ubicacion: Ubicacion, permiso: Permiso): Ubicacion => {
  const { estado, aviso } = ubicacion;
  if (permiso === "denegado") {
    // Si lo bloquea mientras se usa o tras un fallo del GPS, la ubicación deja de valer en el acto.
    if (delGps(estado)) return { estado: DENEGADA, permiso, aviso: "denegado" };
    // Mientras se pide, es la respuesta al aviso del navegador.
    if (estado.tipo === "pidiendo") {
      return { estado: conPermiso(estado.anterior, permiso), permiso, aviso: "denegado" };
    }
    // Y el paso previo ya no lleva a ninguna parte: el navegador no preguntaría.
    if (estado.tipo === "explicando") {
      return { estado: conPermiso(estado.anterior, permiso), permiso, aviso };
    }
  }
  if (estado.tipo === "explicando" || estado.tipo === "pidiendo" || estado.tipo === "eligiendo") {
    return {
      estado: { ...estado, anterior: conPermiso(estado.anterior, permiso) },
      permiso,
      aviso,
    };
  }
  return { estado: conPermiso(estado, permiso), permiso, aviso };
};

const alUsarUbicacion = (estado: EstadoUbicacion, permiso: Permiso): EstadoUbicacion => {
  const anterior = asentado(estado);
  // Si ya se usa, se vuelve a ella; con el permiso bloqueado no se puede pedir, y el panel
  // explica cómo reactivarlo.
  if (anterior.tipo === "gps") return anterior;
  if (permiso === "denegado" || estado.tipo === "pidiendo") return estado;
  // Si el permiso ya está dado, el navegador no preguntará nada y no hace falta el paso previo.
  return permiso === "concedido"
    ? { tipo: "pidiendo", anterior }
    : { tipo: "explicando", anterior };
};

/** Cambia el asentado de un estado, sea el propio o el que guarda un estado de paso. */
const conAsentado = (estado: EstadoUbicacion, nuevo: EstadoAsentado): EstadoUbicacion =>
  estado.tipo === "explicando" || estado.tipo === "eligiendo"
    ? { ...estado, anterior: nuevo }
    : nuevo;

const alLeer = (ubicacion: Ubicacion, lectura: LecturaGps): Ubicacion => {
  const { estado } = ubicacion;
  const gps: EstadoAsentado = { tipo: "gps", lectura };
  if (estado.tipo === "pidiendo") return { ...ubicacion, estado: gps, permiso: "concedido" };
  // Mientras la ubicación GPS sea la referencia, cada lectura la pone al día.
  if (asentado(estado).tipo === "gps") return { ...ubicacion, estado: conAsentado(estado, gps) };
  // Una lectura que llega sin que nadie la espere (tras quitar o cancelar) no vale.
  return ubicacion;
};

const alFallar = (ubicacion: Ubicacion, motivo: MotivoFalloGps): Ubicacion => {
  const { estado } = ubicacion;
  const permiso = motivo === "denegado" ? "denegado" : ubicacion.permiso;
  const sinUbicacion: EstadoAsentado = motivo === "denegado" ? DENEGADA : { tipo: "fallo", motivo };
  if (estado.tipo === "pidiendo") {
    // Si ya había un punto elegido, se queda: el aviso dice qué ha pasado.
    const nuevo = estado.anterior.tipo === "elegida" ? estado.anterior : sinUbicacion;
    return { estado: nuevo, permiso, aviso: motivo };
  }
  if (asentado(estado).tipo === "gps") {
    return { estado: conAsentado(estado, sinUbicacion), permiso, aviso: motivo };
  }
  return ubicacion;
};

/** Lo que hace la persona: cambia el estado y borra el aviso anterior. */
const accion = (
  estado: EstadoUbicacion,
  evento: EventoDePersona,
  permiso: Permiso,
): EstadoUbicacion => {
  switch (evento.tipo) {
    case "usar-ubicacion":
      return alUsarUbicacion(estado, permiso);
    case "continuar":
      return estado.tipo === "explicando"
        ? { tipo: "pidiendo", anterior: estado.anterior }
        : estado;
    case "cancelar":
      return estado.tipo === "explicando" ||
        estado.tipo === "pidiendo" ||
        estado.tipo === "eligiendo"
        ? estado.anterior
        : estado;
    case "elegir-en-mapa":
      // Mientras se busca la ubicación también se puede ir al mapa: deja de buscarla.
      return estado.tipo === "eligiendo"
        ? estado
        : { tipo: "eligiendo", anterior: asentado(estado) };
    case "elegido":
      return estado.tipo === "eligiendo" || estado.tipo === "elegida"
        ? { tipo: "elegida", punto: evento.punto }
        : estado;
    case "quitar":
      return sinPunto(permiso);
    case "cerrar-aviso":
      return estado;
  }
};

type EventoDePersona = Exclude<
  EventoUbicacion,
  { readonly tipo: "permiso" | "restaurado" | "lectura" | "fallo-gps" }
>;

/** El estado de la ubicación después de un evento. Lo que no viene a cuento se ignora. */
export const transicion = (ubicacion: Ubicacion, evento: EventoUbicacion): Ubicacion => {
  const { estado, permiso } = ubicacion;
  switch (evento.tipo) {
    case "permiso":
      return alCambiarPermiso(ubicacion, evento.permiso);
    case "restaurado":
      // Solo si la persona no ha hecho nada todavía: lo que acaba de elegir gana a lo guardado.
      return estado.tipo === "ninguna" || estado.tipo === "denegada"
        ? { ...ubicacion, estado: { tipo: "elegida", punto: evento.punto } }
        : ubicacion;
    case "lectura":
      return alLeer(ubicacion, evento.lectura);
    case "fallo-gps":
      return alFallar(ubicacion, evento.motivo);
    default:
      return { estado: accion(estado, evento, permiso), permiso, aviso: undefined };
  }
};

/** El punto de referencia que vale ahora, si hay alguno. */
export type Referencia =
  | { readonly tipo: "gps"; readonly lectura: LecturaGps }
  | { readonly tipo: "elegido"; readonly punto: PuntoElegido };

export const referenciaDe = (estado: EstadoUbicacion): Referencia | undefined => {
  const actual = asentado(estado);
  if (actual.tipo === "gps") return { tipo: "gps", lectura: actual.lectura };
  if (actual.tipo === "elegida") return { tipo: "elegido", punto: actual.punto };
  return undefined;
};

/** La posición de un punto de referencia. */
export const posicionDe = (referencia: Referencia): Coordenada =>
  referencia.tipo === "gps" ? referencia.lectura.posicion : referencia.punto.posicion;

/**
 * Si hay que tener el GPS encendido: mientras se pide y mientras la ubicación GPS sea la
 * referencia. Quitarla o elegir un punto lo apaga.
 */
export const gpsEncendido = (estado: EstadoUbicacion): boolean =>
  estado.tipo === "pidiendo" || asentado(estado).tipo === "gps";
