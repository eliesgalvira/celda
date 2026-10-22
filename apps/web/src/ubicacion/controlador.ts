import { ESQUEMA_PUNTO_ELEGIDO, type OrigenPunto } from "@celda/dominio/aportacion";
import type { Coordenada } from "@celda/dominio/area";
import { recurso, recursoFijo } from "@celda/ui/recurso.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { createContext, createMemo, createSignal } from "solid-js";

import type { ServiciosDeDatos } from "../datos.tsx";
import { AlmacenLocal, nuevaAportacion } from "./almacen.ts";
import {
  type EventoUbicacion,
  gpsEncendido,
  INICIAL,
  type Referencia,
  referenciaDe,
  transicion,
  type Ubicacion,
} from "./estado.ts";
import { Geolocalizacion } from "./geolocalizacion.ts";

/** Qué no ha podido hacer el almacén del dispositivo con el punto elegido. */
type AvisoAlmacen = "sin-guardar" | "sin-borrar";

/** El estado de la ubicación y lo que se puede hacer con él, para toda la pantalla del mapa. */
export interface ControlUbicacion {
  readonly ubicacion: () => Ubicacion;
  readonly referencia: () => Referencia | undefined;
  /** «Usar mi ubicación»: abre el paso previo o, con el permiso ya dado, la pide. */
  readonly usarUbicacion: () => void;
  /** Acepta el paso previo: ahora el navegador pregunta. */
  readonly continuar: () => void;
  readonly cancelar: () => void;
  readonly elegirEnMapa: () => void;
  /** Un punto elegido nuevo: se usa en el acto y se guarda en el dispositivo. */
  readonly elegir: (posicion: Coordenada, origen: OrigenPunto) => void;
  /** Mueve el punto elegido mientras se arrastra, sin guardarlo todavía. */
  readonly mover: (posicion: Coordenada) => void;
  /** Guarda el punto donde se ha soltado. */
  readonly soltar: () => void;
  /** Quita el punto de referencia; si era un punto elegido, lo borra del dispositivo. */
  readonly quitar: () => void;
  readonly cerrarAviso: () => void;
  readonly avisoAlmacen: () => AvisoAlmacen | undefined;
  readonly cerrarAvisoAlmacen: () => void;
  /**
   * Si ya se ha leído el punto elegido que guardaba el dispositivo, lo hubiera o no: hasta
   * entonces no se sabe si al abrir hay punto de referencia.
   */
  readonly puntoGuardadoLeido: () => boolean;
}

export const UbicacionContexto = createContext<ControlUbicacion>();

/**
 * El estado de la ubicación de la pantalla del mapa, sobre la función `transicion`. Pregunta el
 * permiso al empezar, recupera el punto guardado, enciende el GPS solo mientras hace falta y
 * guarda o borra el punto elegido.
 */
export const crearUbicacion = (
  runtime: ManagedRuntime.ManagedRuntime<ServiciosDeDatos, never>,
): ControlUbicacion => {
  const [ubicacion, setUbicacion] = createSignal<Ubicacion>(INICIAL);
  const [avisoAlmacen, setAvisoAlmacen] = createSignal<AvisoAlmacen>();
  const [puntoGuardadoLeido, setPuntoGuardadoLeido] = createSignal(false);
  const enviar = (evento: EventoUbicacion) => setUbicacion((u) => transicion(u, evento));
  const referencia = createMemo(() => referenciaDe(ubicacion().estado));

  recursoFijo("geolocalizacion:permiso", () => {
    const parar = new AbortController();
    void runtime.runPromiseExit(
      Stream.runForEach(Stream.unwrap(Effect.map(Geolocalizacion, (g) => g.permiso)), (permiso) =>
        Effect.sync(() => enviar({ tipo: "permiso", permiso })),
      ),
      { signal: parar.signal },
    );
    return () => parar.abort();
  });

  recursoFijo("almacen:punto-elegido", () => {
    const parar = new AbortController();
    void runtime
      .runPromiseExit(
        Effect.flatMap(AlmacenLocal, (a) => a.leer("punto-elegido")),
        { signal: parar.signal },
      )
      .then((salida) => {
        // Si no se puede leer, se empieza sin punto; al guardar uno, el aviso lo dirá.
        const punto = Exit.isSuccess(salida) ? salida.value.at(-1) : undefined;
        if (punto?.tipo === "punto-elegido") enviar({ tipo: "restaurado", punto });
        setPuntoGuardadoLeido(true);
      });
    return () => parar.abort();
  });

  // El GPS se enciende al pedir la ubicación y se apaga en cuanto deja de ser la referencia. Cada
  // lectura cambia el estado, pero la clave es `true` mientras siga encendido: no lo reabre.
  recurso(
    "gps",
    () => gpsEncendido(ubicacion().estado),
    () => {
      const parar = new AbortController();
      void runtime.runPromiseExit(
        Stream.runForEach(Stream.unwrap(Effect.map(Geolocalizacion, (g) => g.seguir)), (lectura) =>
          Effect.sync(() => enviar({ tipo: "lectura", lectura })),
        ).pipe(
          Effect.catchTag("UbicacionNoDisponible", (error) =>
            Effect.sync(() => enviar({ tipo: "fallo-gps", motivo: error.motivo })),
          ),
        ),
        { signal: parar.signal },
      );
      return () => parar.abort();
    },
  );

  const elegir = (posicion: Coordenada, origen: OrigenPunto) => {
    void runtime
      .runPromiseExit(
        Effect.gen(function* () {
          const punto = yield* nuevaAportacion({
            tipo: "punto-elegido",
            esquema: ESQUEMA_PUNTO_ELEGIDO,
            origen,
            posicion,
          });
          yield* Effect.sync(() => enviar({ tipo: "elegido", punto }));
          const almacen = yield* AlmacenLocal;
          yield* almacen.sustituir(punto);
        }),
      )
      .then((salida) => setAvisoAlmacen(Exit.isSuccess(salida) ? undefined : "sin-guardar"));
  };

  return {
    ubicacion,
    referencia,
    usarUbicacion: () => enviar({ tipo: "usar-ubicacion" }),
    continuar: () => enviar({ tipo: "continuar" }),
    cancelar: () => enviar({ tipo: "cancelar" }),
    elegirEnMapa: () => enviar({ tipo: "elegir-en-mapa" }),
    elegir,
    mover: (posicion) => {
      const actual = ubicacion().estado;
      if (actual.tipo === "elegida") {
        enviar({ tipo: "elegido", punto: { ...actual.punto, posicion } });
      }
    },
    soltar: () => {
      const actual = ubicacion().estado;
      if (actual.tipo === "elegida") elegir(actual.punto.posicion, "mapa");
    },
    quitar: () => {
      enviar({ tipo: "quitar" });
      void runtime
        .runPromiseExit(Effect.flatMap(AlmacenLocal, (a) => a.borrar("punto-elegido")))
        .then((salida) => setAvisoAlmacen(Exit.isSuccess(salida) ? undefined : "sin-borrar"));
    },
    cerrarAviso: () => enviar({ tipo: "cerrar-aviso" }),
    avisoAlmacen,
    cerrarAvisoAlmacen: () => setAvisoAlmacen(undefined),
    puntoGuardadoLeido,
  };
};
