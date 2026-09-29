import { type Coordenada, contiene, type Rectangulo } from "@celda/dominio/area";
import { COMPANIAS_DE_CAPA, type EmplazamientoLeido } from "@celda/dominio/capa";
import { seCortan } from "@celda/dominio/cobertura";
import type { CapaDeProvincia, ProvinciaDelResumen, ResumenLeido } from "@celda/dominio/provincias";
import { ausentesDeProvincia, companiasDelResumen, resumirMunicipios } from "@celda/dominio/zona";

import {
  type Agrupador,
  alBorde,
  type CargaDeProvincia,
  claveDeEmplazamiento,
  crearAgrupador,
  type Elemento,
  type ElementoAbrible,
  type ElementoProvincia,
  type Escena,
  interseccion,
  type OpcionesAgrupador,
  SIN_TRANSICION,
  type Transicion,
} from "./agrupacion.ts";
import type { Indice, IndicesDeCapa } from "./indice.ts";
import { cajaConMargen, cajaVisible, type Vista } from "./marcadores.ts";

/**
 * El mapa de toda España (ADR 0016). Por debajo del nivel de provincias solo se dibuja el resumen
 * nacional: un hexágono por provincia con su número. Desde ese nivel se piden las provincias que
 * corta la vista; cada una se agrupa con su propio índice, y mientras no llega se ve su hexágono.
 *
 * Las transiciones son las de cada provincia donde hay detalle a los dos lados. Entre el resumen y
 * una provincia, cada elemento de la provincia sale de su hexágono o va a él. En el borde entre
 * dos provincias pueden quedar dos hexágonos cerca, uno de cada una: cada uno cuenta bien los
 * suyos, y ningún emplazamiento está en dos.
 */

/** Primer nivel en que se piden y se dibujan las provincias con detalle. */
export const NIVEL_DE_PROVINCIAS = 8;

/** Una provincia leída, indexada y lista para agrupar. */
export interface ProvinciaCargada {
  readonly codigo: string;
  /**
   * La versión y la fecha del resumen que la listó: su marca de agua. Casi siempre son las del
   * resumen del mapa; si su capa ya no estaba en el origen, las de la vigente.
   */
  readonly version: string;
  readonly fecha: number;
  readonly capa: CapaDeProvincia;
  readonly agrupador: Agrupador;
}

/** Por qué no ha llegado una provincia. */
export type MotivoFalloProvincia = "sin-descarga" | "danada" | "interno";

/** Cómo va la capa de una provincia pedida. */
export type EstadoProvincia =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "lista"; readonly provincia: ProvinciaCargada }
  | { readonly tipo: "fallo"; readonly motivo: MotivoFalloProvincia };

const PREFIJO_PROVINCIA = "p:";

/** La clave del hexágono de una provincia. */
export const claveDeProvincia = (codigo: string): string => `${PREFIJO_PROVINCIA}${codigo}`;

/** El prefijo de las claves de las agrupaciones y los barrios de una provincia. */
export const prefijoDeProvincia = (codigo: string): string => `${codigo}:`;

/** La provincia de una clave de agrupación, de barrio o de municipio (`a:08:123`), o `undefined`. */
const provinciaDeClave = (clave: string): string | undefined =>
  /^[afbm]:([^:]+):/u.exec(clave)?.[1];

/**
 * El agrupador de una provincia leída, con sus barrios y, si está cubierta en `resumen`, sus
 * municipios. Las ausencias de los municipios cuentan con las compañías de todo el resumen, como
 * las de las provincias. Una provincia a medias va en hexágonos también en los niveles de
 * municipios: un municipio del borde de lo barrido contaría solo una parte de sus emplazamientos.
 */
export const agrupadorDeProvincia = (
  capa: CapaDeProvincia,
  resumen: ResumenLeido,
  indices?: IndicesDeCapa<Indice>,
): Agrupador => {
  const cubierta = resumen.provincias.find((p) => p.codigo === capa.provincia)?.cubierta === true;
  const opciones: OpcionesAgrupador = {
    prefijo: prefijoDeProvincia(capa.provincia),
    municipios: cubierta
      ? resumirMunicipios(
          capa.municipios,
          capa.emplazamientos.map((e) => ({ ...e, municipio: e.municipio ?? null })),
          companiasDelResumen(resumen.provincias),
          COMPANIAS_DE_CAPA,
        )
      : [],
  };
  return crearAgrupador(
    capa.emplazamientos,
    capa.barrios,
    indices === undefined ? opciones : { ...opciones, indices },
  );
};

/**
 * Las provincias con capa que hay que pedir para ver `vista`: las que tienen emplazamientos en la
 * caja de la vista con su margen. Por debajo del nivel de provincias, ninguna.
 */
export const provinciasDeLaVista = (resumen: ResumenLeido, vista: Vista): ReadonlyArray<string> => {
  if (Math.floor(vista.zoom) < NIVEL_DE_PROVINCIAS) return [];
  const caja = cajaConMargen(vista.caja);
  return resumen.provincias.flatMap((p) =>
    p.fichero !== undefined && p.caja !== undefined && seCortan(p.caja, caja) ? [p.codigo] : [],
  );
};

/** Cada provincia de una escena: detalle de su agrupador, o su hexágono del resumen (`null`). */
type Partes = ReadonlyMap<
  string,
  { readonly escena: Escena; readonly agrupador: Agrupador } | null
>;

/** Las partes de cada escena nacional, las haga el agrupador que las haga. */
const partesDe = new WeakMap<Escena, Partes>();

/**
 * El agrupador de toda España con las provincias de `provincias`: las listas con su detalle, y el
 * resto con su hexágono del resumen, que dice si se están pidiendo o si han fallado. Se vuelve a
 * crear cada vez que cambia una provincia, pero las transiciones funcionan entre escenas de
 * agrupadores distintos, porque cada provincia conserva el suyo.
 */
export const crearAgrupadorNacional = (
  resumen: ResumenLeido,
  provincias: ReadonlyMap<string, EstadoProvincia>,
): Agrupador => {
  const enElResumen = companiasDelResumen(resumen.provincias);
  const cargadas = new Map(
    [...provincias].flatMap(([codigo, estado]) =>
      estado.tipo === "lista" ? [[codigo, estado.provincia] as const] : [],
    ),
  );
  let deClave: ReadonlyMap<string, ProvinciaCargada> | undefined;
  /** La provincia cargada en que está un emplazamiento. */
  const cargadaDe = (clave: string): ProvinciaCargada | undefined => {
    deClave ??= new Map(
      [...cargadas.values()].flatMap((p) =>
        p.capa.emplazamientos.map((e) => [e.clave, p] as const),
      ),
    );
    return deClave.get(clave);
  };

  const cargaDe = (codigo: string): CargaDeProvincia => {
    const estado = provincias.get(codigo);
    return estado?.tipo === "cargando"
      ? "cargando"
      : estado?.tipo === "fallo"
        ? "fallo"
        : "resumen";
  };
  const hexagono = (p: ProvinciaDelResumen, posicion: Coordenada): ElementoProvincia => ({
    tipo: "provincia",
    clave: claveDeProvincia(p.codigo),
    posicion,
    provincia: p,
    carga: cargaDe(p.codigo),
    ausentes: ausentesDeProvincia(p, enElResumen, COMPANIAS_DE_CAPA),
  });

  /**
   * Cómo se ve una provincia en una escena: con el detalle de su agrupador, con su hexágono (en
   * `posicion`) o nada si no cae en la caja.
   */
  const parteDe = (
    p: ProvinciaDelResumen,
    nivel: number,
    caja: Rectangulo,
    visible: Rectangulo,
  ): { readonly detalle: ProvinciaCargada } | { readonly posicion: Coordenada } | undefined => {
    const corta = p.caja !== undefined && seCortan(p.caja, caja);
    if (nivel >= NIVEL_DE_PROVINCIAS && corta && p.caja !== undefined) {
      const cargada = cargadas.get(p.codigo);
      if (cargada !== undefined) return { detalle: cargada };
      // Mientras llega su capa, su hexágono dentro de lo que se ve de ella: nunca un hueco.
      const suya = seCortan(p.caja, visible)
        ? interseccion(p.caja, visible)
        : interseccion(p.caja, caja);
      return { posicion: alBorde(p.etiqueta, suya) };
    }
    const soloResumen = nivel < NIVEL_DE_PROVINCIAS || p.caja === undefined;
    return soloResumen && contiene(caja, p.etiqueta) ? { posicion: p.etiqueta } : undefined;
  };

  /** El seleccionado, suelto, si alguna provincia cargada lo tiene y cae en la caja. */
  const sueltoEn = (caja: Rectangulo, aparte: string | null): Elemento | undefined => {
    const suya = aparte === null ? undefined : cargadaDe(aparte);
    const emplazamiento = suya?.capa.emplazamientos.find((e) => e.clave === aparte);
    if (emplazamiento === undefined || !contiene(caja, emplazamiento.posicion)) return undefined;
    return {
      tipo: "emplazamiento",
      clave: claveDeEmplazamiento(emplazamiento.clave),
      posicion: emplazamiento.posicion,
      emplazamiento,
    };
  };

  const escena = (nivel: number, caja: Rectangulo, aparte: string | null = null): Escena => {
    const elementos = new Map<string, Elemento>();
    const partes = new Map<string, { escena: Escena; agrupador: Agrupador } | null>();
    const visible = cajaVisible(caja);
    for (const p of resumen.provincias) {
      const parte = parteDe(p, nivel, caja, visible);
      if (parte === undefined) continue;
      if ("detalle" in parte) {
        const detalle = parte.detalle.agrupador.escena(nivel, caja, aparte);
        for (const [clave, elemento] of detalle.elementos) elementos.set(clave, elemento);
        partes.set(p.codigo, { escena: detalle, agrupador: parte.detalle.agrupador });
      } else {
        elementos.set(claveDeProvincia(p.codigo), hexagono(p, parte.posicion));
        partes.set(p.codigo, null);
      }
    }
    // El seleccionado se ve siempre, también sobre el resumen.
    const suelto = sueltoEn(caja, aparte);
    if (suelto !== undefined && !elementos.has(suelto.clave)) elementos.set(suelto.clave, suelto);
    const hecha = { nivel, elementos };
    partesDe.set(hecha, partes);
    return hecha;
  };

  const agrupadorDe = (elemento: Elemento): Agrupador | undefined =>
    elemento.tipo === "emplazamiento"
      ? cargadaDe(elemento.emplazamiento.clave)?.agrupador
      : cargadas.get(provinciaDeClave(elemento.clave) ?? "")?.agrupador;

  const zoomDeApertura = (elemento: ElementoAbrible): number =>
    elemento.tipo === "provincia"
      ? NIVEL_DE_PROVINCIAS
      : (agrupadorDe(elemento)?.zoomDeApertura(elemento) ?? NIVEL_DE_PROVINCIAS);

  const emplazamientosDe = (elemento: Elemento): ReadonlyArray<EmplazamientoLeido> =>
    agrupadorDe(elemento)?.emplazamientosDe(elemento) ?? [];

  return { escena, transicion: transicionNacional, zoomDeApertura, emplazamientosDe };
};

/**
 * Cómo pasan los elementos de una escena nacional a otra, provincia a provincia: con la
 * transición de su agrupador si hay detalle a los dos lados, y desde su hexágono o hacia él si
 * está en el resumen a un lado. Sirve también al mismo nivel, cuando llega una provincia.
 */
export const transicionNacional = (antes: Escena, despues: Escena): Transicion => {
  const partesAntes = partesDe.get(antes);
  const partesDespues = partesDe.get(despues);
  if (partesAntes === undefined || partesDespues === undefined) return SIN_TRANSICION;
  const destino = new Map<string, string>();
  const origen = new Map<string, string>();
  /** Todo lo de `detalle` que no está en `otra` va a `hexagono` o sale de él. */
  const conSuHexagono = (
    detalle: Escena,
    otra: Escena,
    hexagono: string,
    relacion: Map<string, string>,
  ) => {
    for (const clave of detalle.elementos.keys()) {
      if (!otra.elementos.has(clave)) relacion.set(clave, hexagono);
    }
  };
  for (const codigo of new Set([...partesAntes.keys(), ...partesDespues.keys()])) {
    const a = partesAntes.get(codigo);
    const d = partesDespues.get(codigo);
    const hexagono = claveDeProvincia(codigo);
    if (a === null && d !== undefined && d !== null) {
      conSuHexagono(d.escena, antes, hexagono, origen);
    } else if (d === null && a !== undefined && a !== null) {
      conSuHexagono(a.escena, despues, hexagono, destino);
    } else if (a !== undefined && a !== null && d !== undefined && d !== null) {
      if (a.agrupador !== d.agrupador) continue;
      const suya = a.agrupador.transicion(a.escena, d.escena);
      for (const [clave, hacia] of suya.destino) destino.set(clave, hacia);
      for (const [clave, desde] of suya.origen) origen.set(clave, desde);
    }
  }
  return { destino, origen };
};
