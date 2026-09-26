import { AJUSTES_INICIALES, type Ajustes } from "@celda/dominio/ajustes";
import type { Aportacion } from "@celda/dominio/aportacion";
import * as Cause from "effect/Cause";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { criptoDePrueba } from "../lib/cripto.ts";
import type { Brujula } from "../mejorar/brujula.ts";
import {
  type BrujulaDePrueba,
  brujulaDePrueba,
  type OpcionesDeBrujula,
} from "../mejorar/pruebas.ts";
import { AlmacenLocal, AlmacenNoDisponible } from "./almacen.ts";
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
  /** Los ajustes guardados ahora. */
  readonly ajustes: () => Ajustes;
}

/** Un almacén en memoria con las aportaciones que se le den. Con `roto`, todo falla. */
export const almacenDePrueba = (
  iniciales: ReadonlyArray<Aportacion> = [],
  roto = false,
  ajustesIniciales: Ajustes = AJUSTES_INICIALES,
): AlmacenDePrueba => {
  let guardadas = [...iniciales];
  let ajustes = ajustesIniciales;
  const disponible: Effect.Effect<void, AlmacenNoDisponible> = roto
    ? Effect.fail(new AlmacenNoDisponible({ motivo: "almacén de prueba roto" }))
    : Effect.void;
  return {
    capa: Layer.succeed(
      AlmacenLocal,
      AlmacenLocal.of({
        leer: (tipo) => Effect.map(disponible, () => guardadas.filter((a) => a.tipo === tipo)),
        sustituir: (nueva) =>
          Effect.map(disponible, () => {
            guardadas = [...guardadas.filter((a) => a.tipo !== nueva.tipo), nueva];
          }),
        borrar: (tipo) =>
          Effect.map(disponible, () => {
            guardadas = guardadas.filter((a) => a.tipo !== tipo);
          }),
        leerAjustes: Effect.map(disponible, () => ajustes),
        guardarAjustes: (nuevos) =>
          Effect.map(disponible, () => {
            ajustes = nuevos;
          }),
      }),
    ),
    guardadas: () => guardadas,
    ajustes: () => ajustes,
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

export interface OpcionesDeUbicacion {
  readonly permiso?: Permiso;
  readonly guardadas?: ReadonlyArray<Aportacion>;
  readonly almacenRoto?: boolean;
  readonly ajustes?: Ajustes;
  readonly busquedas?: ReadonlyMap<string, ReadonlyArray<Direccion> | BusquedaFallida>;
  /** La brújula del dispositivo: por defecto, la de un ordenador, que no tiene. */
  readonly brujula?: OpcionesDeBrujula;
}

export interface UbicacionDePrueba {
  readonly capa: Layer.Layer<
    Geolocalizacion | Brujula | AlmacenLocal | BuscadorDeDirecciones | Crypto.Crypto
  >;
  readonly gps: GeolocalizacionDePrueba;
  readonly brujula: BrujulaDePrueba;
  readonly almacen: AlmacenDePrueba;
  readonly buscador: BuscadorDePrueba;
}

/**
 * Los servicios del dispositivo de prueba para montar la app: por defecto, el navegador aún no ha
 * preguntado por el permiso, no hay brújula, no hay nada guardado y el buscador no encuentra nada.
 */
export const ubicacionDePrueba = (opciones: OpcionesDeUbicacion = {}): UbicacionDePrueba => {
  const gps = geolocalizacionDePrueba(opciones.permiso ?? "preguntar");
  const almacen = almacenDePrueba(opciones.guardadas, opciones.almacenRoto, opciones.ajustes);
  const buscador = buscadorDePrueba(opciones.busquedas ?? new Map());
  const brujula = brujulaDePrueba(opciones.brujula);
  return {
    capa: Layer.mergeAll(gps.capa, brujula.capa, almacen.capa, buscador.capa, criptoDePrueba),
    gps,
    brujula,
    almacen,
    buscador,
  };
};
