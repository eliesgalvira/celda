import type { JSX } from "@solidjs/web";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { createContext, onSettled, untrack, useContext } from "solid-js";

import type { CapaEmplazamientos } from "./capa/servicio.ts";

/** Los servicios de datos de la interfaz. En las pruebas se sustituyen por capas de prueba. */
export type ServiciosDeDatos = CapaEmplazamientos;

const Datos = createContext<ManagedRuntime.ManagedRuntime<ServiciosDeDatos, never>>();

/**
 * Monta una vez el runtime de Effect con los servicios de datos y lo deja al alcance de las
 * pantallas. Lo libera al desmontarse.
 */
export function ProveedorDeDatos(props: {
  readonly servicios: Layer.Layer<ServiciosDeDatos>;
  readonly children: JSX.Element;
}) {
  const runtime = ManagedRuntime.make(untrack(() => props.servicios));
  onSettled(() => () => {
    void runtime.dispose();
  });
  return <Datos value={runtime}>{props.children}</Datos>;
}

/** El runtime de los servicios de datos. */
export const usarDatos = () => useContext(Datos);
