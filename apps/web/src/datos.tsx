import type { Simulador } from "@celda/sim/simulador";
import type { JSX } from "@solidjs/web";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { createContext, onSettled, untrack, useContext } from "solid-js";

import type { CapaEmplazamientos } from "./capa/servicio.ts";
import type { FichasPublicadas } from "./ficha/servicio.ts";
import type { Brujula } from "./mejorar/brujula.ts";
import type { AlmacenLocal } from "./ubicacion/almacen.ts";
import type { BuscadorDeDirecciones } from "./ubicacion/buscador.ts";
import type { Geolocalizacion } from "./ubicacion/geolocalizacion.ts";

/**
 * Los servicios de la interfaz: los datos del mapa, el simulador, el GPS, la brújula, lo guardado
 * en el dispositivo y el buscador. En las pruebas se sustituyen por capas de prueba, y el simulador, por
 * el que calcula en el mismo hilo.
 */
export type ServiciosDeDatos =
  | CapaEmplazamientos
  | FichasPublicadas
  | Simulador
  | Geolocalizacion
  | Brujula
  | AlmacenLocal
  | BuscadorDeDirecciones
  | Crypto.Crypto;

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

/**
 * Un flujo de Effect como lo consume Solid (ADR 0003): devuelto desde `createMemo`, cada valor
 * del flujo es el nuevo valor del memo y sus fallos llegan a `<Errored>`. Cuando el memo se
 * recalcula o se desmonta, Solid cierra el iterable y el flujo se interrumpe, así que su lectura
 * se cancela y una respuesta tardía ya no llega a nadie.
 */
export const leerEnSolid = <A, E>(
  runtime: ManagedRuntime.ManagedRuntime<ServiciosDeDatos, never>,
  lectura: Stream.Stream<A, E, ServiciosDeDatos>,
): AsyncIterable<A> =>
  Stream.toAsyncIterable(
    Stream.unwrap(
      Effect.map(runtime.contextEffect, (contexto) => Stream.provideContext(lectura, contexto)),
    ),
  );
