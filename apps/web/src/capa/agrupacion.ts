import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import Supercluster from "supercluster";

/**
 * Agrupación por zoom de los emplazamientos de la capa (ADR 0004). A cada nivel de zoom, los
 * emplazamientos que quedan a menos de `RADIO` píxeles se recogen en una agrupación con su número.
 * La jerarquía entre niveles es la de supercluster, así que se sabe a qué agrupación va cada
 * emplazamiento al alejar y de cuál sale al acercar.
 *
 * Las escenas y las transiciones no dependen de supercluster: un elemento es cualquier cosa que el
 * mapa dibuja en un sitio. Las agrupaciones por barrio (ticket 14) serán otro tipo de elemento y
 * otro tipo de nivel por debajo de cierto zoom, con la misma forma de escena y de transición.
 */

/**
 * Distancia en píxeles de pantalla por debajo de la cual se agrupa, en el zoom entero del nivel. Con
 * 48, dos logos (34 px) o un logo y un hexágono (50 px) no se pisan.
 */
const RADIO = 48;

/** Último nivel con agrupaciones. En el siguiente y más cerca, todos los emplazamientos van sueltos. */
const NIVEL_MAXIMO = 16;

/** Tope de pasos al bajar por la jerarquía en un salto de muchos niveles. */
const TOPE_DE_PASOS = 4000;

/** Un emplazamiento que se dibuja suelto, con su marcador de logos. */
export interface ElementoEmplazamiento {
  readonly tipo: "emplazamiento";
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly emplazamiento: EmplazamientoDeCapa;
}

/** Una agrupación: el hexágono con el número de emplazamientos que recoge. */
export interface ElementoAgrupacion {
  readonly tipo: "agrupacion";
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly cuantos: number;
}

/** Lo que el mapa dibuja en un sitio. La clave identifica el mismo elemento entre escenas. */
export type Elemento = ElementoEmplazamiento | ElementoAgrupacion;

/** Lo que se ve a un nivel de zoom dentro de una caja. */
export interface Escena {
  readonly nivel: number;
  readonly elementos: ReadonlyMap<string, Elemento>;
}

/**
 * Relación entre dos escenas. Al alejar, `destino` dice hacia qué elemento nuevo se desliza cada
 * elemento que desaparece. Al acercar, `origen` dice de qué elemento viejo sale cada elemento que
 * aparece. Lo que no está en ninguno de los dos aparece o se apaga en su sitio.
 */
export interface Transicion {
  readonly destino: ReadonlyMap<string, string>;
  readonly origen: ReadonlyMap<string, string>;
}

export const SIN_TRANSICION: Transicion = { destino: new Map(), origen: new Map() };

export interface Agrupador {
  /** Los elementos del nivel `nivel` cuyo punto cae dentro de `caja`. */
  readonly escena: (nivel: number, caja: Rectangulo) => Escena;
  /**
   * Cómo pasan los elementos de la escena `antes` a la escena `despues`. Si alguna la ha hecho otro
   * agrupador, como al llegar una capa nueva, no hay transición.
   */
  readonly transicion: (antes: Escena, despues: Escena) => Transicion;
  /** El zoom al que hay que acercarse para que la agrupación se abra en varios elementos. */
  readonly zoomDeApertura: (agrupacion: ElementoAgrupacion) => number;
  /** Los emplazamientos que recoge un elemento: él mismo o los de la agrupación. */
  readonly emplazamientosDe: (elemento: Elemento) => ReadonlyArray<EmplazamientoDeCapa>;
}

/** El nivel de agrupación de un zoom del mapa: su parte entera, hasta el primero sin agrupaciones. */
export const nivelDeZoom = (zoom: number): number =>
  Math.max(0, Math.min(Math.floor(zoom), NIVEL_MAXIMO + 1));

interface PropiedadesDePunto {
  readonly indice: number;
}

type PropiedadesDeAgrupacion = Record<string, never>;

/**
 * supercluster con `_getOriginZoom` a la vista. Es un detalle interno de la versión 9.1.0, fijada
 * exacta en el catálogo: el identificador de una agrupación lleva el nivel siguiente a aquel en
 * que se formó. Las pruebas de `agrupacion.test.ts` lo cubren; si una versión nueva lo cambia,
 * fallan.
 */
class Indice extends Supercluster<PropiedadesDePunto, PropiedadesDeAgrupacion> {
  declare _getOriginZoom: (id: number) => number;
}

const PREFIJO_EMPLAZAMIENTO = "e:";
const PREFIJO_AGRUPACION = "a:";

const claveDeAgrupacion = (id: number): string => `${PREFIJO_AGRUPACION}${id}`;

/** El identificador de supercluster de una clave de agrupación, o `undefined` si no lo es. */
const idDeClave = (clave: string): number | undefined =>
  clave.startsWith(PREFIJO_AGRUPACION) ? Number(clave.slice(PREFIJO_AGRUPACION.length)) : undefined;

/** Agrupa los emplazamientos de una capa. Indexar 1300 emplazamientos cuesta unos milisegundos. */
export const crearAgrupador = (emplazamientos: ReadonlyArray<EmplazamientoDeCapa>): Agrupador => {
  const indice = new Indice({ radius: RADIO, maxZoom: NIVEL_MAXIMO });
  indice.load(
    emplazamientos.map((emplazamiento, i) => ({
      type: "Feature",
      properties: { indice: i },
      geometry: {
        type: "Point",
        coordinates: [emplazamiento.posicion.longitud, emplazamiento.posicion.latitud],
      },
    })),
  );

  const elementoDe = (punto: ReturnType<Indice["getClusters"]>[number]): Elemento | undefined => {
    const [longitud = 0, latitud = 0] = punto.geometry.coordinates;
    const posicion = { longitud, latitud };
    const propiedades = punto.properties;
    if ("cluster" in propiedades) {
      return {
        tipo: "agrupacion",
        clave: claveDeAgrupacion(propiedades.cluster_id),
        posicion,
        cuantos: propiedades.point_count,
      };
    }
    const emplazamiento = emplazamientos[propiedades.indice];
    return emplazamiento === undefined
      ? undefined
      : {
          tipo: "emplazamiento",
          clave: `${PREFIJO_EMPLAZAMIENTO}${emplazamiento.clave}`,
          posicion: emplazamiento.posicion,
          emplazamiento,
        };
  };

  // Las escenas de este agrupador: las claves de agrupación de otro no valen en este índice.
  const propias = new WeakSet<Escena>();

  const escena = (nivel: number, caja: Rectangulo): Escena => {
    const elementos = new Map<string, Elemento>();
    const bbox: [number, number, number, number] = [
      caja.suroeste.longitud,
      caja.suroeste.latitud,
      caja.noreste.longitud,
      caja.noreste.latitud,
    ];
    for (const punto of indice.getClusters(bbox, nivel)) {
      const elemento = elementoDe(punto);
      if (elemento !== undefined) elementos.set(elemento.clave, elemento);
    }
    const hecha = { nivel, elementos };
    propias.add(hecha);
    return hecha;
  };

  /**
   * Las claves con que se ve en el nivel `nivel`, más cercano, lo que recoge `clave`. Un
   * emplazamiento se ve igual en todos los niveles. Una agrupación ya existe en `nivel` si se formó
   * en él o en uno más cercano; si no, se baja a sus hijos del nivel siguiente.
   */
  const bajar = (
    clave: string,
    nivel: number,
    fuera: Array<string>,
    tope: { pasos: number },
  ): void => {
    const id = idDeClave(clave);
    if (id === undefined || indice._getOriginZoom(id) - 1 >= nivel) {
      fuera.push(clave);
      return;
    }
    tope.pasos -= 1;
    if (tope.pasos < 0) return;
    for (const hijo of indice.getChildren(id)) {
      const elemento = elementoDe(hijo);
      if (elemento !== undefined) bajar(elemento.clave, nivel, fuera, tope);
    }
  };

  const transicion = (antes: Escena, despues: Escena): Transicion => {
    if (antes.nivel === despues.nivel || !propias.has(antes) || !propias.has(despues)) {
      return SIN_TRANSICION;
    }
    const alejar = despues.nivel < antes.nivel;
    const [fina, gruesa] = alejar ? [antes, despues] : [despues, antes];
    const relacion = new Map<string, string>();
    const tope = { pasos: TOPE_DE_PASOS };
    for (const elemento of gruesa.elementos.values()) {
      if (elemento.tipo !== "agrupacion") continue;
      const descendientes: Array<string> = [];
      bajar(elemento.clave, Math.min(fina.nivel, NIVEL_MAXIMO + 1), descendientes, tope);
      for (const descendiente of descendientes) {
        if (descendiente !== elemento.clave && fina.elementos.has(descendiente)) {
          relacion.set(descendiente, elemento.clave);
        }
      }
    }
    return alejar
      ? { destino: relacion, origen: SIN_TRANSICION.origen }
      : { destino: SIN_TRANSICION.destino, origen: relacion };
  };

  const zoomDeApertura = (agrupacion: ElementoAgrupacion): number => {
    const id = idDeClave(agrupacion.clave);
    return id === undefined
      ? NIVEL_MAXIMO + 1
      : Math.min(indice.getClusterExpansionZoom(id), NIVEL_MAXIMO + 1);
  };

  const emplazamientosDe = (elemento: Elemento): ReadonlyArray<EmplazamientoDeCapa> => {
    if (elemento.tipo === "emplazamiento") return [elemento.emplazamiento];
    const id = idDeClave(elemento.clave);
    if (id === undefined) return [];
    return indice
      .getLeaves(id, Number.POSITIVE_INFINITY)
      .flatMap((hoja) => emplazamientos[hoja.properties.indice] ?? []);
  };

  return { escena, transicion, zoomDeApertura, emplazamientosDe };
};
