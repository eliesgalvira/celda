import { type Coordenada, contiene, ESPANA } from "@celda/dominio/area";
import { rectanguloDeCaja } from "@celda/dominio/cobertura";
import {
  type Asignacion,
  type IndiceDeMunicipios,
  municipioDelPunto,
} from "@celda/dominio/municipio";
import type { ProvinciaConCaja, ProvinciasDeZonas } from "@celda/dominio/zonaDelEjercicio";
import { mismasListas, recurso, recursoFijo } from "@celda/ui/recurso.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { createEffect, createMemo, createSignal } from "solid-js";

import { NIVEL_DE_MUNICIPIOS } from "../capa/zonas.ts";
import type { Vista } from "../capa/marcadores.ts";
import { NIVEL_DE_PROVINCIAS } from "../capa/nacional.ts";
import type { ZonasNoCargadas } from "../ejercicio/zona.ts";

/**
 * Dónde cae un punto del mapa, con los contornos de municipios de `ejercicio/zonas`: la cabecera
 * dice así el lugar del centro de la vista, y la vista inicial, la provincia del punto de
 * referencia. Las provincias con su caja (2 KB) y el contorno de cada una (de 18 a 33 KB con
 * gzip) se descargan cuando hace falta el primer punto de esa provincia.
 */

/** Lo que se sabe de algo que se descarga. */
export type Descarga<A> =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "lista"; readonly datos: A }
  | { readonly tipo: "fallo" };

/** Las provincias y los contornos que han llegado o se están pidiendo. */
export interface ZonasDelMapa {
  /** `undefined` si aún no se han pedido. */
  readonly provincias: Descarga<ReadonlyArray<ProvinciaConCaja>> | undefined;
  /** Por código de provincia. Las que no están aún no se han pedido. */
  readonly contornos: ReadonlyMap<string, Descarga<IndiceDeMunicipios>>;
}

export const SIN_ZONAS: ZonasDelMapa = { provincias: undefined, contornos: new Map() };

/** Las provincias cuya caja contiene el punto: solo en sus contornos puede caer. */
export const provinciasCandidatas = (
  punto: Coordenada,
  provincias: ReadonlyArray<ProvinciaConCaja>,
): ReadonlyArray<string> =>
  provincias.flatMap((p) => (contiene(rectanguloDeCaja(p.caja), punto) ? [p.codigo] : []));

/** Los contornos que hacen falta para saber dónde caen los puntos y aún no se han pedido. */
export const contornosQueFaltan = (
  puntos: ReadonlyArray<Coordenada>,
  zonas: ZonasDelMapa,
): ReadonlyArray<string> => {
  const provincias = zonas.provincias;
  if (provincias?.tipo !== "lista") return [];
  const faltan = new Set<string>();
  for (const punto of puntos) {
    for (const codigo of provinciasCandidatas(punto, provincias.datos)) {
      if (!zonas.contornos.has(codigo)) faltan.add(codigo);
    }
  }
  return [...faltan].toSorted();
};

const FUERA: Asignacion = { municipio: undefined, provincia: undefined };

/**
 * El municipio y la provincia en que cae un punto (`municipioDelPunto`), o `undefined` si aún no se
 * sabe: faltan las provincias o el contorno de alguna cuya caja lo contiene. Un contorno que no ha
 * llegado se da por mirado. Fuera de todas las provincias, o si no han llegado, no cae en
 * ninguna.
 */
export const dondeCae = (punto: Coordenada, zonas: ZonasDelMapa): Asignacion | undefined => {
  const provincias = zonas.provincias;
  if (provincias === undefined || provincias.tipo === "cargando") return undefined;
  if (provincias.tipo === "fallo") return FUERA;
  for (const codigo of provinciasCandidatas(punto, provincias.datos)) {
    const contorno = zonas.contornos.get(codigo);
    if (contorno === undefined || contorno.tipo === "cargando") return undefined;
    if (contorno.tipo === "fallo") continue;
    const asignacion = municipioDelPunto(punto, contorno.datos);
    if (asignacion.provincia !== undefined) return asignacion;
  }
  return FUERA;
};

/** El centro de lo que se ve. */
export const centroDe = (vista: Vista): Coordenada => ({
  longitud: (vista.caja.suroeste.longitud + vista.caja.noreste.longitud) / 2,
  latitud: (vista.caja.suroeste.latitud + vista.caja.noreste.latitud) / 2,
});

/**
 * Lo que mide de ancho, en grados de longitud, una vista que ya enseña una provincia y no varias:
 * Barcelona mide 1,4°, Soria 1,8° y Badajoz, la más ancha de la península, 2,7°.
 */
export const ANCHO_DE_UNA_PROVINCIA = 2.7;

/**
 * Si la cabecera nombra un sitio y no España entera: desde el nivel de provincias, o antes si lo
 * que se ve no es más ancho que una provincia, como en un móvil con una provincia encuadrada.
 */
export const nombraUnSitio = (vista: Vista | undefined): vista is Vista =>
  vista !== undefined &&
  (Math.floor(vista.zoom) >= NIVEL_DE_PROVINCIAS ||
    vista.caja.noreste.longitud - vista.caja.suroeste.longitud <= ANCHO_DE_UNA_PROVINCIA);

/**
 * Lo que dice la cabecera de lo que se ve, o `undefined` mientras no se sepa:
 *
 * - de lejos, «España», como el resumen nacional (`nombraUnSitio`);
 * - hasta el nivel de municipios, la provincia del centro;
 * - desde él, el municipio del centro o, en un territorio compartido, su provincia.
 *
 * Con el centro fuera de las provincias (en el mar o al otro lado de la frontera) dice «España».
 */
export const lugarDeLaVista = (
  vista: Vista | undefined,
  zonas: ZonasDelMapa,
): string | undefined => {
  if (!nombraUnSitio(vista)) return ESPANA.nombre;
  const asignacion = dondeCae(centroDe(vista), zonas);
  if (asignacion === undefined) return undefined;
  const { municipio, provincia } = asignacion;
  if (Math.floor(vista.zoom) >= NIVEL_DE_MUNICIPIOS && municipio !== undefined) {
    return municipio.nombre;
  }
  return provincia?.nombre ?? ESPANA.nombre;
};

/** Cómo se descargan las provincias y sus contornos. En las pruebas, con respuestas de prueba. */
export interface CargasDeZonas {
  readonly provincias: Effect.Effect<ProvinciasDeZonas, ZonasNoCargadas>;
  readonly contornos: (codigo: string) => Effect.Effect<IndiceDeMunicipios, ZonasNoCargadas>;
}

export interface LugaresDelMapa {
  /**
   * Lo que dice la cabecera de la vista. Mientras llega un contorno sigue diciendo lo de antes, así
   * que no parpadea ni se queda en blanco; al abrir, «España».
   */
  readonly nombre: () => string;
  /** Dónde cae un punto, o `undefined` si aún no se sabe. */
  readonly dondeCae: (punto: Coordenada) => Asignacion | undefined;
  /** Las provincias con su caja, cuando han llegado. */
  readonly provincias: () => ReadonlyArray<ProvinciaConCaja> | undefined;
}

/**
 * Sigue dónde está el centro de `vista` y dónde caen los `puntos`, y descarga lo que hace falta
 * para saberlo: las provincias al primer punto que las necesita y el contorno de cada provincia la
 * primera vez que un punto cae en su caja. Lo que llega se queda para la visita; lo que falla no
 * se vuelve a pedir. Con el mapa quieto no pide nada.
 */
export const crearLugares = (entrada: {
  readonly vista: () => Vista | undefined;
  /** Otros puntos que hay que situar, como el punto de referencia al abrir. */
  readonly puntos: () => ReadonlyArray<Coordenada>;
  readonly cargas: CargasDeZonas;
}): LugaresDelMapa => {
  const [zonas, setZonas] = createSignal<ZonasDelMapa>(SIN_ZONAS);
  /** Lo pedido, fuera de la señal: se consulta justo después de escribir. */
  const pedidos = new Set<string>();
  const parar = new AbortController();
  recursoFijo("lugares", () => () => parar.abort());

  const puntos = createMemo(() => {
    const vista = entrada.vista();
    return nombraUnSitio(vista) ? [centroDe(vista), ...entrada.puntos()] : entrada.puntos();
  });

  // Se piden una vez, con el primer punto que hay que situar.
  recurso(
    "lugares:provincias",
    () => puntos().length > 0 && zonas().provincias === undefined,
    () => {
      setZonas((antes) => ({ ...antes, provincias: { tipo: "cargando" } }));
      void Effect.runPromiseExit(entrada.cargas.provincias, { signal: parar.signal }).then(
        (salida) => {
          if (parar.signal.aborted) return;
          setZonas((antes) => ({
            ...antes,
            provincias: Exit.isSuccess(salida)
              ? { tipo: "lista", datos: salida.value.provincias }
              : { tipo: "fallo" },
          }));
        },
      );
      return undefined;
    },
  );

  recurso(
    "lugares:contornos",
    () => {
      const faltan = contornosQueFaltan(puntos(), zonas());
      return faltan.length === 0 ? undefined : faltan;
    },
    (codigos) => {
      const nuevos = codigos.filter((codigo) => !pedidos.has(codigo));
      for (const codigo of nuevos) pedidos.add(codigo);
      setZonas((antes) => {
        const contornos = new Map(antes.contornos);
        for (const codigo of nuevos) contornos.set(codigo, { tipo: "cargando" });
        return { ...antes, contornos };
      });
      for (const codigo of nuevos) {
        void Effect.runPromiseExit(entrada.cargas.contornos(codigo), {
          signal: parar.signal,
        }).then((salida) => {
          if (parar.signal.aborted) return;
          setZonas((antes) => ({
            ...antes,
            contornos: new Map(antes.contornos).set(
              codigo,
              Exit.isSuccess(salida) ? { tipo: "lista", datos: salida.value } : { tipo: "fallo" },
            ),
          }));
        });
      }
      return undefined;
    },
    { iguales: mismasListas },
  );

  const [nombre, setNombre] = createSignal(ESPANA.nombre);
  createEffect(
    () => lugarDeLaVista(entrada.vista(), zonas()),
    (sabido) => {
      if (sabido !== undefined) setNombre(sabido);
    },
  );

  return {
    nombre,
    dondeCae: (punto) => dondeCae(punto, zonas()),
    provincias: () => {
      const provincias = zonas().provincias;
      return provincias?.tipo === "lista" ? provincias.datos : undefined;
    },
  };
};
