import { type Coordenada, contiene, type Rectangulo } from "@celda/dominio/area";
import { COMPANIAS_DE_CAPA, type EmplazamientoLeido } from "@celda/dominio/capa";
import { centroVisual } from "@celda/dominio/centroVisual";
import { seCortan } from "@celda/dominio/cobertura";
import {
  claveDeFiltro,
  contarConFiltro,
  type FiltroDeCompanias,
  hayFiltro,
  separarPorPapel,
  SIN_FILTRO,
} from "@celda/dominio/filtro";
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
import type { IndicesDeFiltro, ParteDeCapa } from "./indexador.ts";
import type { Indice, IndicesDeCapa } from "./indice.ts";
import { cajaConMargen, cajaVisible, type Vista } from "./marcadores.ts";

/**
 * El mapa de toda España (ADR 0016). Por debajo del nivel de provincias solo se dibuja el resumen
 * nacional: un hexágono por provincia con su número, en su centro visual (ADR 0024). Desde ese
 * nivel se piden las provincias que corta la vista; cada una se agrupa con su propio índice, y
 * mientras no llega se ve su hexágono.
 *
 * Las transiciones son las de cada provincia donde hay detalle a los dos lados. Entre el resumen y
 * una provincia, cada elemento de la provincia sale de su hexágono o va a él. En el borde entre
 * dos provincias pueden quedar dos hexágonos cerca, uno de cada una: cada uno cuenta bien los
 * suyos, y ningún emplazamiento está en dos.
 */

/**
 * Primer nivel en que se piden y se dibujan las provincias con detalle. Hasta el 9, el resumen:
 * de lejos los datos van discretos y una vista a z8 no pide ninguna capa de provincia (ADR 0024).
 */
export const NIVEL_DE_PROVINCIAS = 9;

/**
 * Dónde va el hexágono de una provincia: su centro visual (`centroVisual`) o, si la tabla no la
 * tiene, la etiqueta del resumen. La etiqueta se queda en el resumen: la publicación la usa para
 * dar provincia a los emplazamientos que no tienen ninguna.
 */
export type CentroDeProvincia = (provincia: ProvinciaDelResumen) => Coordenada;

const enSuCentroVisual: CentroDeProvincia = (p) => centroVisual(p.codigo) ?? p.etiqueta;

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

/** Lo que marca, tras el código de la provincia, las agrupaciones de la red que usa un filtro. */
const DE_LA_RED = "r";

/**
 * El prefijo de las agrupaciones de la red que usa una compañía del filtro en una provincia
 * (`a:08r:12`), que no chocan con las suyas (ADR 0026).
 */
export const prefijoDeRedUsada = (codigo: string): string => `${codigo}${DE_LA_RED}:`;

/**
 * La provincia de una clave de agrupación, de barrio o de municipio (`a:08:123`, `s11:08:4`), o
 * `undefined`. Las de la red usada llevan la marca detrás (`08r`).
 */
const provinciaDeClave = (clave: string): string | undefined =>
  /^(?:[afbm]|s\d+):([^:]+):/u.exec(clave)?.[1];

/**
 * Cómo se agrupa una provincia con un filtro de compañías (ADR 0026): sus emplazamientos de las
 * compañías del filtro, con sus zonas, y aparte, si hay, los de la red que usan, en hexágonos y
 * logos sin zonas.
 */
export interface AgrupacionConFiltro {
  /** El filtro con que se hizo (`claveDeFiltro`). */
  readonly filtro: string;
  readonly propios: Agrupador;
  readonly redUsada: Agrupador | undefined;
}

/**
 * Lo que hay que indexar de una capa con un filtro: los emplazamientos de las compañías del
 * filtro, con los municipios si la provincia está cubierta y sus barrios, y los de la red que
 * usan, sin zonas. Sin ninguno de la red, `redUsada` no está.
 */
export interface PartesDelFiltro {
  readonly propios: ParteDeCapa;
  readonly redUsada: ParteDeCapa | undefined;
}

/** Las partes de una capa con un filtro (`PartesDelFiltro`). */
export const partesDelFiltro = (
  capa: CapaDeProvincia,
  resumen: ResumenLeido,
  filtro: FiltroDeCompanias,
): PartesDelFiltro => {
  const cubierta = resumen.provincias.find((p) => p.codigo === capa.provincia)?.cubierta === true;
  const { propios, redUsada } = separarPorPapel(capa.emplazamientos, filtro);
  return {
    propios: {
      emplazamientos: propios,
      municipios: cubierta ? capa.municipios : [],
      conBarrios: capa.barrios.length > 0,
    },
    redUsada:
      redUsada.length === 0
        ? undefined
        : { emplazamientos: redUsada, municipios: [], conBarrios: false },
  };
};

/**
 * La agrupación de una provincia con un filtro, con los índices que hizo el Worker para las
 * partes de `partesDelFiltro` o, sin ellos, hechos aquí.
 */
export const agrupacionConFiltro = (
  capa: CapaDeProvincia,
  resumen: ResumenLeido,
  filtro: { readonly companias: FiltroDeCompanias; readonly clave: string },
  indices?: IndicesDeFiltro,
): AgrupacionConFiltro => {
  const partes = partesDelFiltro(capa, resumen, filtro.companias);
  const red = partes.redUsada;
  const indicesDeLaRed = indices?.redUsada;
  return {
    filtro: filtro.clave,
    propios: agrupadorDeProvincia(
      { ...capa, emplazamientos: partes.propios.emplazamientos },
      resumen,
      indices?.propios,
    ),
    redUsada:
      red === undefined
        ? undefined
        : crearAgrupador(
            red.emplazamientos,
            [],
            indicesDeLaRed === undefined
              ? { prefijo: prefijoDeRedUsada(capa.provincia), redUsada: true }
              : {
                  prefijo: prefijoDeRedUsada(capa.provincia),
                  redUsada: true,
                  indices: indicesDeLaRed,
                },
          ),
  };
};

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
 * caja de la vista con su margen. Por debajo del nivel `desde`, ninguna: con la vista agrupada es
 * el de provincias, y con la de puntos, el anterior al de los logos (ADR 0028).
 */
export const provinciasDeLaVista = (
  resumen: ResumenLeido,
  vista: Vista,
  desde: number = NIVEL_DE_PROVINCIAS,
): ReadonlyArray<string> => {
  if (Math.floor(vista.zoom) < desde) return [];
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

/** La agrupación sin filtro de una provincia lista: su agrupador, con todos. */
export const agrupacionSinFiltro = (cargada: ProvinciaCargada): AgrupacionConFiltro => ({
  filtro: claveDeFiltro(SIN_FILTRO),
  propios: cargada.agrupador,
  redUsada: undefined,
});

/**
 * La agrupación de una provincia lista con un filtro, hecha en el hilo, sin el Worker: la de las
 * pruebas de pantalla.
 */
export const agrupacionEnHilo = (
  cargada: ProvinciaCargada,
  resumen: ResumenLeido,
  filtro: FiltroDeCompanias,
): AgrupacionConFiltro =>
  hayFiltro(filtro)
    ? agrupacionConFiltro(cargada.capa, resumen, {
        companias: filtro,
        clave: claveDeFiltro(filtro),
      })
    : agrupacionSinFiltro(cargada);

/** Lo que cambia el agrupador de toda España, además del resumen y las provincias. */
export interface OpcionesNacional {
  /** Dónde va el hexágono de cada provincia. Sin él, en su centro visual. */
  readonly centroDe?: CentroDeProvincia;
  /** Las compañías que se ven (ADR 0026). Sin él, todas. */
  readonly filtro?: FiltroDeCompanias;
  /**
   * Con un filtro, la agrupación de cada provincia lista que se dibuja: la del filtro o, mientras
   * el Worker la prepara, la que ya se veía. Una provincia lista sin ninguna se ve con su hexágono,
   * cargando.
   */
  readonly agrupaciones?: ReadonlyMap<string, AgrupacionConFiltro> | undefined;
}

/**
 * Lo que dice el hexágono de una provincia del resumen con un filtro: los emplazamientos de las
 * compañías del filtro y, aparte, los de la red que usan. Con un resumen de antes de las
 * combinaciones no se puede contar: dice los de todas y lo marca `sinFiltrar`.
 */
export const cuentaDeProvincia = (
  provincia: ProvinciaDelResumen,
  filtro: FiltroDeCompanias,
): Pick<ElementoProvincia, "cuantos" | "deLaRed" | "sinFiltrar"> => {
  if (!hayFiltro(filtro)) {
    return { cuantos: provincia.emplazamientos, deLaRed: 0, sinFiltrar: false };
  }
  if (provincia.combinaciones === undefined) {
    return { cuantos: provincia.emplazamientos, deLaRed: 0, sinFiltrar: true };
  }
  const { propios, redUsada } = contarConFiltro(provincia.combinaciones, filtro);
  return { cuantos: propios, deLaRed: redUsada, sinFiltrar: false };
};

/**
 * El agrupador de toda España con las provincias de `provincias`: las listas con su detalle, y el
 * resto con su hexágono del resumen, que dice si se están pidiendo o si han fallado. Se vuelve a
 * crear cada vez que cambia una provincia, pero las transiciones funcionan entre escenas de
 * agrupadores distintos, porque cada provincia conserva el suyo. Con un filtro de compañías, los
 * hexágonos cuentan solo lo del filtro y cada provincia lista se dibuja con su agrupación de
 * `agrupaciones` (ADR 0026).
 */
export const crearAgrupadorNacional = (
  resumen: ResumenLeido,
  provincias: ReadonlyMap<string, EstadoProvincia>,
  opciones: OpcionesNacional = {},
): Agrupador => {
  const centroDe = opciones.centroDe ?? enSuCentroVisual;
  const filtro = opciones.filtro ?? SIN_FILTRO;
  const conFiltro = hayFiltro(filtro);
  const agrupaciones = opciones.agrupaciones ?? new Map<string, AgrupacionConFiltro>();
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

  /** Cómo se agrupa una provincia lista: sin filtro, con su agrupador; con él, con el suyo. */
  const agrupacionDe = (cargada: ProvinciaCargada): AgrupacionConFiltro | undefined =>
    conFiltro ? agrupaciones.get(cargada.codigo) : agrupacionSinFiltro(cargada);

  const cargaDe = (codigo: string): CargaDeProvincia => {
    const estado = provincias.get(codigo);
    return estado?.tipo === "cargando"
      ? "cargando"
      : estado?.tipo === "fallo"
        ? "fallo"
        : "resumen";
  };
  const hexagono = (
    p: ProvinciaDelResumen,
    posicion: Coordenada,
    carga: CargaDeProvincia,
  ): ElementoProvincia => ({
    tipo: "provincia",
    clave: claveDeProvincia(p.codigo),
    posicion,
    provincia: p,
    carga,
    ausentes: ausentesDeProvincia(p, enElResumen, COMPANIAS_DE_CAPA),
    ...cuentaDeProvincia(p, filtro),
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
  ):
    | { readonly detalle: AgrupacionConFiltro }
    | { readonly posicion: Coordenada; readonly carga: CargaDeProvincia }
    | undefined => {
    const corta = p.caja !== undefined && seCortan(p.caja, caja);
    if (nivel >= NIVEL_DE_PROVINCIAS && corta && p.caja !== undefined) {
      const cargada = cargadas.get(p.codigo);
      const agrupacion = cargada === undefined ? undefined : agrupacionDe(cargada);
      if (agrupacion !== undefined) return { detalle: agrupacion };
      // Mientras llega su capa, su hexágono dentro de lo que se ve de ella: nunca un hueco.
      const suya = seCortan(p.caja, visible)
        ? interseccion(p.caja, visible)
        : interseccion(p.caja, caja);
      // Lista, pero sin la agrupación del filtro: el Worker la está preparando.
      const carga = cargada === undefined ? cargaDe(p.codigo) : "cargando";
      return { posicion: alBorde(centroDe(p), suya), carga };
    }
    const soloResumen = nivel < NIVEL_DE_PROVINCIAS || p.caja === undefined;
    const centro = centroDe(p);
    return soloResumen && contiene(caja, centro)
      ? { posicion: centro, carga: cargaDe(p.codigo) }
      : undefined;
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
        const { propios, redUsada } = parte.detalle;
        const detalle = propios.escena(nivel, caja, aparte);
        for (const [clave, elemento] of detalle.elementos) elementos.set(clave, elemento);
        partes.set(p.codigo, { escena: detalle, agrupador: propios });
        if (redUsada !== undefined) {
          // La red usada va aparte, con sus propias transiciones, y no cuenta en las zonas.
          const deLaRed = redUsada.escena(nivel, caja, aparte);
          for (const [clave, elemento] of deLaRed.elementos) {
            if (!elementos.has(clave)) elementos.set(clave, elemento);
          }
          partes.set(`${p.codigo}${DE_LA_RED}`, { escena: deLaRed, agrupador: redUsada });
        }
      } else {
        elementos.set(claveDeProvincia(p.codigo), hexagono(p, parte.posicion, parte.carga));
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

  const agrupadorDe = (elemento: Elemento): Agrupador | undefined => {
    if (elemento.tipo === "emplazamiento") {
      return cargadaDe(elemento.emplazamiento.clave)?.agrupador;
    }
    const codigo = provinciaDeClave(elemento.clave) ?? "";
    const deLaRed = codigo.endsWith(DE_LA_RED);
    const cargada = cargadas.get(deLaRed ? codigo.slice(0, -DE_LA_RED.length) : codigo);
    const agrupacion = cargada === undefined ? undefined : agrupacionDe(cargada);
    return deLaRed ? agrupacion?.redUsada : agrupacion?.propios;
  };

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
