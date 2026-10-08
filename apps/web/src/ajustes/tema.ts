import { mismosCampos, recurso } from "@celda/ui/recurso.ts";
import {
  type AlmacenDelTema,
  aplicarEleccionDeTema,
  type EleccionDeTema,
  guardarEleccionDeTema,
  leerEleccionDeTema,
} from "@celda/ui/temaElegido.ts";
import { createSignal } from "solid-js";

/** El tema elegido en Ajustes y cómo cambiarlo. */
export interface ControlTema {
  readonly eleccion: () => EleccionDeTema;
  /** Pone el tema en el momento y lo guarda en el dispositivo. */
  readonly elegir: (eleccion: EleccionDeTema) => void;
  /** La última elección no se ha podido guardar: vale hasta cerrar la página. */
  readonly sinGuardar: () => boolean;
}

/** El `localStorage`, o nada si el navegador no deja usarlo. */
export const almacenDelNavegador = (): AlmacenDelTema | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * La elección de tema (`@celda/ui/temaElegido.ts`). Empieza con la guardada, que el guion del
 * `<head>` ya ha puesto en el documento antes de pintar.
 */
export const crearTema = (
  documento: Document,
  almacen: AlmacenDelTema | undefined,
): ControlTema => {
  const [eleccion, setEleccion] = createSignal(leerEleccionDeTema(almacen));
  const [sinGuardar, setSinGuardar] = createSignal(false);
  return {
    eleccion,
    elegir: (nueva) => {
      aplicarEleccionDeTema(documento, nueva);
      setEleccion(nueva);
      setSinGuardar(!guardarEleccionDeTema(almacen, nueva));
    },
    sinGuardar,
  };
};

/** Lo que hace falta de `matchMedia(CONSULTA_DEL_OSCURO)`: su aviso de que ha cambiado. */
export interface TemaDelSistema {
  addEventListener(tipo: "change", escuchador: () => void): void;
  removeEventListener(tipo: "change", escuchador: () => void): void;
}

/**
 * Repinta el mapa cuando cambia el tema. Se abre con el mapa ya pintado y se vuelve a abrir con
 * cada elección, y al abrirse repinta: así el mapa toma los colores de la elección nueva, y los
 * del tema que hubiera si cambió mientras se creaba. Con Sistema escucha además los cambios del
 * sistema; con Claro u Oscuro no, porque el CSS ya no los sigue.
 */
export const repintarConElTema = (
  lienzo: () => object | undefined,
  eleccion: () => EleccionDeTema,
  repintar: () => void,
  sistema: () => TemaDelSistema,
): void =>
  recurso(
    "mapa:tema",
    () => {
      const actual = lienzo();
      return actual !== undefined && { lienzo: actual, eleccion: eleccion() };
    },
    (clave) => {
      repintar();
      if (clave.eleccion !== "sistema") return undefined;
      const consulta = sistema();
      consulta.addEventListener("change", repintar);
      return () => consulta.removeEventListener("change", repintar);
    },
    { iguales: mismosCampos },
  );
