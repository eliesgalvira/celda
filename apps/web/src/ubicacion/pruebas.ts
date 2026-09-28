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
import { enOtraTarea } from "../lib/pruebas.ts";
import type { Brujula } from "../mejorar/brujula.ts";
import {
  type BrujulaDePrueba,
  brujulaDePrueba,
  type OpcionesDeBrujula,
} from "../mejorar/pruebas.ts";
import { AlmacenLocal, AlmacenNoDisponible } from "./almacen.ts";
import type { Direccion } from "./buscador.ts";
import { BuscadorDeDirecciones, BusquedaFallida, ordenarPorEncuadre } from "./buscador.ts";
import type { LecturaGps, MotivoFalloGps, Permiso } from "./estado.ts";
import { Geolocalizacion, UbicacionNoDisponible } from "./geolocalizacion.ts";

export interface GeolocalizacionDePrueba {
  readonly capa: Layer.Layer<Geolocalizacion>;
  /** Cuántas veces se ha pedido la ubicación: cada una sería un aviso del navegador. */
  readonly pedidas: () => number;
  /** Cuántas peticiones siguen abiertas, con el GPS encendido. */
  readonly abiertas: () => number;
  /**
   * Entrega una lectura a las peticiones abiertas. El navegador la guarda, y una petición nueva la
   * recibe nada más abrirse.
   */
  readonly responder: (lectura: LecturaGps) => void;
  /**
   * Entrega una lectura a las peticiones ya cerradas, como un navegador que llama tarde a la
   * función de una vigilancia que ya se quitó.
   */
  readonly responderTarde: (lectura: LecturaGps) => void;
  /** Hace fallar las peticiones abiertas, como si el navegador lo dijera. */
  readonly fallar: (motivo: MotivoFalloGps) => void;
  /** El permiso cambia, como si la persona lo cambiara en el navegador. */
  readonly cambiarPermiso: (permiso: Permiso) => void;
  /**
   * Si la app ya ha leído el permiso. Como en el navegador, la respuesta no está al montar: quien
   * pulse «Usar mi ubicación» antes ve el paso previo aunque el permiso ya esté dado.
   */
  readonly permisoLeido: () => boolean;
}

/**
 * Un GPS de prueba con el permiso dado. Como el del navegador:
 *
 * - `permiso` da el estado cuando se empieza a leer y luego cada cambio, y no se acaba hasta que
 *   se deja de escuchar.
 * - Una petición nueva recibe al abrirse la última posición que tenga el navegador (`watchPosition`
 *   con `maximumAge`), sin esperar al GPS. La primera, `enCache`; después, la última entregada.
 * - Lo demás llega cuando la prueba lo pide.
 */
export const geolocalizacionDePrueba = (
  permiso: Permiso,
  enCache?: LecturaGps,
): GeolocalizacionDePrueba => {
  let pedidas = 0;
  let permisoActual = permiso;
  let ultima = enCache;
  const colas: Array<Queue.Queue<LecturaGps, UbicacionNoDisponible | Cause.Done>> = [];
  const cerradas: Array<Queue.Queue<LecturaGps, UbicacionNoDisponible | Cause.Done>> = [];
  const escuchasDePermiso: Array<Queue.Queue<Permiso, Cause.Done>> = [];
  const seguir = Stream.callback<LecturaGps, UbicacionNoDisponible>((cola) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        pedidas += 1;
        colas.push(cola);
        if (ultima !== undefined) Queue.offerUnsafe(cola, ultima);
      }),
      () =>
        Effect.sync(() => {
          colas.splice(colas.indexOf(cola), 1);
          cerradas.push(cola);
        }),
    ),
  );
  let permisoLeido = false;
  // El estado de ahora cuando alguien empieza a leerlo, y luego cada cambio, sin acabarse nunca.
  const permisos = Stream.concat(
    Stream.fromEffect(
      Effect.sync(() => {
        permisoLeido = true;
        return permisoActual;
      }),
    ),
    Stream.callback<Permiso>((cola) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          escuchasDePermiso.push(cola);
        }),
        () => Effect.sync(() => escuchasDePermiso.splice(escuchasDePermiso.indexOf(cola), 1)),
      ),
    ),
  );
  return {
    capa: Layer.succeed(Geolocalizacion, Geolocalizacion.of({ permiso: permisos, seguir })),
    pedidas: () => pedidas,
    abiertas: () => colas.length,
    responder: (lectura) => {
      ultima = lectura;
      for (const cola of colas) Queue.offerUnsafe(cola, lectura);
    },
    responderTarde: (lectura) => {
      for (const cola of cerradas) Queue.offerUnsafe(cola, lectura);
    },
    fallar: (motivo) => {
      for (const cola of colas) {
        Queue.failCauseUnsafe(cola, Cause.fail(new UbicacionNoDisponible({ motivo })));
      }
    },
    permisoLeido: () => permisoLeido,
    cambiarPermiso: (nuevo) => {
      permisoActual = nuevo;
      for (const cola of escuchasDePermiso) Queue.offerUnsafe(cola, nuevo);
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

/**
 * Un almacén en memoria con las aportaciones que se le den. Con `roto`, todo falla. Como
 * IndexedDB, contesta en otra tarea.
 */
export const almacenDePrueba = (
  iniciales: ReadonlyArray<Aportacion> = [],
  roto = false,
  ajustesIniciales: Ajustes = AJUSTES_INICIALES,
): AlmacenDePrueba => {
  let guardadas = [...iniciales];
  let ajustes = ajustesIniciales;
  const disponible: Effect.Effect<void, AlmacenNoDisponible> = Effect.andThen(
    enOtraTarea,
    roto ? Effect.fail(new AlmacenNoDisponible({ motivo: "almacén de prueba roto" })) : Effect.void,
  );
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

/**
 * Un buscador que contesta con lo que diga `respuestas` para cada consulta, o que no hay nada. Como
 * la red, contesta en otra tarea, y como el de verdad, pone primero lo que cae en el encuadre.
 */
export const buscadorDePrueba = (
  respuestas: ReadonlyMap<string, ReadonlyArray<Direccion> | BusquedaFallida>,
): BuscadorDePrueba => {
  const consultas: Array<string> = [];
  return {
    capa: Layer.succeed(
      BuscadorDeDirecciones,
      BuscadorDeDirecciones.of({
        buscar: (consulta, encuadre) =>
          Effect.suspend(() => {
            consultas.push(consulta);
            const respuesta = respuestas.get(consulta) ?? [];
            return Effect.andThen(
              enOtraTarea,
              esFalloDeBusqueda(respuesta)
                ? Effect.fail(respuesta)
                : Effect.succeed(ordenarPorEncuadre(respuesta, encuadre)),
            );
          }),
        atribucion: { texto: "Buscador de prueba", enlace: "https://buscador.prueba" },
      }),
    ),
    consultas: () => consultas,
  };
};

export interface OpcionesDeUbicacion {
  readonly permiso?: Permiso;
  /** La posición que el navegador ya tiene guardada: la recibe la primera petición al abrirse. */
  readonly enCache?: LecturaGps;
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
  const gps = geolocalizacionDePrueba(opciones.permiso ?? "preguntar", opciones.enCache);
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
