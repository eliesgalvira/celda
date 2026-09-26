import type { Aportacion } from "@celda/dominio/aportacion";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { criptoContador } from "../lib/cripto.ts";
import { AlmacenLocal, AlmacenNoDisponible, nuevaAportacion } from "./almacen.ts";
import type { Direccion } from "./buscador.ts";
import { BuscadorDeDirecciones, BusquedaFallida } from "./buscador.ts";
import type { LecturaGps, MotivoFalloGps, Permiso } from "./estado.ts";
import { Geolocalizacion, UbicacionNoDisponible } from "./geolocalizacion.ts";

export interface GeolocalizacionDePrueba {
  readonly capa: Layer.Layer<Geolocalizacion>;
  /** Cuántas veces se ha pedido la ubicación: cada una sería un aviso del navegador. */
  readonly pedidas: () => number;
  /** Cuántas peticiones siguen abiertas, con el GPS encendido. */
  readonly abiertas: () => number;
  /** Entrega una lectura a las peticiones abiertas. */
  readonly responder: (lectura: LecturaGps) => void;
  /** Hace fallar las peticiones abiertas, como si el navegador lo dijera. */
  readonly fallar: (motivo: MotivoFalloGps) => void;
}

/** Un GPS de prueba con el permiso dado, que no contesta hasta que la prueba se lo pide. */
export const geolocalizacionDePrueba = (permiso: Permiso): GeolocalizacionDePrueba => {
  let pedidas = 0;
  const colas: Array<Queue.Queue<LecturaGps, UbicacionNoDisponible | Cause.Done>> = [];
  const seguir = Stream.callback<LecturaGps, UbicacionNoDisponible>((cola) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        pedidas += 1;
        colas.push(cola);
      }),
      () =>
        Effect.sync(() => {
          colas.splice(colas.indexOf(cola), 1);
        }),
    ),
  );
  return {
    capa: Layer.succeed(
      Geolocalizacion,
      Geolocalizacion.of({ permiso: Stream.make(permiso), seguir }),
    ),
    pedidas: () => pedidas,
    abiertas: () => colas.length,
    responder: (lectura) => {
      for (const cola of colas) Queue.offerUnsafe(cola, lectura);
    },
    fallar: (motivo) => {
      for (const cola of colas) {
        Queue.failCauseUnsafe(cola, Cause.fail(new UbicacionNoDisponible({ motivo })));
      }
    },
  };
};

export interface AlmacenDePrueba {
  readonly capa: Layer.Layer<AlmacenLocal>;
  /** Lo que hay guardado ahora. */
  readonly guardadas: () => ReadonlyArray<Aportacion>;
}

/** Un almacén en memoria con las aportaciones que se le den. Con `roto`, todo falla. */
export const almacenDePrueba = (
  iniciales: ReadonlyArray<Aportacion> = [],
  roto = false,
): AlmacenDePrueba => {
  let guardadas = [...iniciales];
  const disponible: Effect.Effect<void, AlmacenNoDisponible> = roto
    ? Effect.fail(new AlmacenNoDisponible({ motivo: "almacén de prueba roto" }))
    : Effect.void;
  const cripto = criptoContador();
  return {
    capa: Layer.succeed(
      AlmacenLocal,
      AlmacenLocal.of({
        leer: (tipo) => Effect.map(disponible, () => guardadas.filter((a) => a.tipo === tipo)),
        sustituir: (contenido) =>
          disponible.pipe(
            Effect.flatMap(() => nuevaAportacion(contenido)),
            Effect.provideService(Crypto.Crypto, cripto),
            Effect.tap((nueva) =>
              Effect.sync(() => {
                guardadas = [...guardadas.filter((a) => a.tipo !== nueva.tipo), nueva];
              }),
            ),
          ),
        borrar: (tipo) =>
          Effect.map(disponible, () => {
            guardadas = guardadas.filter((a) => a.tipo !== tipo);
          }),
      }),
    ),
    guardadas: () => guardadas,
  };
};

export interface BuscadorDePrueba {
  readonly capa: Layer.Layer<BuscadorDeDirecciones>;
  /** Las consultas que ha recibido, en orden. */
  readonly consultas: () => ReadonlyArray<string>;
}

const esFalloDeBusqueda = Schema.is(BusquedaFallida);

/** Un buscador que contesta con lo que diga `respuestas` para cada consulta, o que no hay nada. */
export const buscadorDePrueba = (
  respuestas: ReadonlyMap<string, ReadonlyArray<Direccion> | BusquedaFallida>,
): BuscadorDePrueba => {
  const consultas: Array<string> = [];
  return {
    capa: Layer.succeed(
      BuscadorDeDirecciones,
      BuscadorDeDirecciones.of({
        buscar: (consulta) =>
          Effect.suspend(() => {
            consultas.push(consulta);
            const respuesta = respuestas.get(consulta) ?? [];
            return esFalloDeBusqueda(respuesta)
              ? Effect.fail(respuesta)
              : Effect.succeed(respuesta);
          }),
        atribucion: { texto: "Buscador de prueba", enlace: "https://buscador.prueba" },
      }),
    ),
    consultas: () => consultas,
  };
};
