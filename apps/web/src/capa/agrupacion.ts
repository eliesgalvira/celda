import { type Coordenada, contiene, type Rectangulo } from "@celda/dominio/area";
import { type Barrio, type ResumenDeBarrio, resumirBarrios } from "@celda/dominio/barrio";
import { COMPANIAS_DE_CAPA, type EmplazamientoLeido } from "@celda/dominio/capa";
import { seCortan } from "@celda/dominio/cobertura";
import type { Compania } from "@celda/dominio/compania";
import type { ProvinciaDelResumen } from "@celda/dominio/provincias";
import type { ResumenDeMunicipio } from "@celda/dominio/zona";

import { type Indice, type IndicesDeCapa, indexarCapa, NIVEL_MAXIMO } from "./indice.ts";
import { cajaVisible } from "./marcadores.ts";

/**
 * Agrupación por zoom de los emplazamientos de la capa (ADR 0004). A cada nivel de zoom, los
 * emplazamientos que quedan a menos de `RADIO` píxeles se recogen en una agrupación con su número.
 * La jerarquía entre niveles es la de supercluster, así que se sabe a qué agrupación va cada
 * emplazamiento al alejar y de cuál sale al acercar.
 *
 * En los niveles de municipios, los emplazamientos de una provincia cubierta se recogen por
 * municipio, con su nombre, su número y, si tiene 10 o más, sus ausencias (ADR 0017). En el nivel
 * de barrios, los de Barcelona se recogen por barrio. Los que no tienen municipio o barrio siguen
 * sueltos o agrupados en hexágonos. Las transiciones que entran o salen de esos niveles se
 * calculan por los emplazamientos que recoge cada elemento: cada uno va al elemento que se queda
 * con la mayoría de los suyos.
 */

/**
 * Nivel en que los emplazamientos de Barcelona se agrupan por barrio: del zoom 13 al 14. Más
 * lejos, las etiquetas de los 73 barrios no caben en la pantalla, y las agrupaciones del nivel 12
 * ya son más grandes que un barrio. Más cerca, las del nivel 14 son más pequeñas. Así, al alejar,
 * cada paso recoge lo del anterior.
 */
export const NIVEL_DE_BARRIOS = 13;

/**
 * Primer nivel en que los emplazamientos se recogen por municipio: los del zoom 11 al 13, justo
 * antes del de barrios. En el 10, con los datos de Cataluña, se verían unas 180 etiquetas en la
 * pantalla de un móvil alrededor de Barcelona; en el 11, unas 60, como los barrios en el suyo.
 * Así, al alejar, los barrios de Barcelona van a su municipio y los municipios, a los hexágonos
 * del nivel 10, que son más grandes que casi todos.
 */
export const NIVEL_DE_MUNICIPIOS = 11;

/** Tope de pasos al bajar por la jerarquía en un salto de muchos niveles. */
const TOPE_DE_PASOS = 4000;

/** Un emplazamiento que se dibuja suelto, con su marcador de logos. */
export interface ElementoEmplazamiento {
  readonly tipo: "emplazamiento";
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly emplazamiento: EmplazamientoLeido;
}

/** Una agrupación: el hexágono con el número de emplazamientos que recoge. */
export interface ElementoAgrupacion {
  readonly tipo: "agrupacion";
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly cuantos: number;
}

/** Un barrio en el nivel de barrios: su etiqueta, con su número de emplazamientos y sus ausencias. */
export interface ElementoBarrio {
  readonly tipo: "barrio";
  readonly clave: string;
  /** Dónde va la etiqueta, dentro del barrio. */
  readonly posicion: Coordenada;
  readonly resumen: ResumenDeBarrio;
}

/**
 * Un municipio en los niveles de municipios: su etiqueta, con su número de emplazamientos y, si
 * tiene 10 o más, sus ausencias.
 */
export interface ElementoMunicipio {
  readonly tipo: "municipio";
  readonly clave: string;
  /**
   * Dónde va la etiqueta: la del municipio o, si queda fuera de la vista y sus emplazamientos no,
   * dentro de lo que se ve de ellos.
   */
  readonly posicion: Coordenada;
  readonly resumen: ResumenDeMunicipio;
}

/**
 * Cómo está la capa de una provincia en el mapa: solo en el resumen, pidiéndose (se ve su
 * hexágono mientras llega) o sin llegar por un fallo.
 */
export type CargaDeProvincia = "resumen" | "cargando" | "fallo";

/**
 * Una provincia del resumen nacional: su hexágono con su número. Se ve por debajo del nivel de
 * provincias y, más cerca, mientras su capa no ha llegado.
 */
export interface ElementoProvincia {
  readonly tipo: "provincia";
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly provincia: ProvinciaDelResumen;
  readonly carga: CargaDeProvincia;
  /**
   * Compañías con algún emplazamiento en el resumen y ninguno en la provincia. Solo en una
   * provincia cubierta: de una a medias no se puede decir que falte nadie.
   */
  readonly ausentes: ReadonlyArray<Compania>;
}

/** Lo que el mapa dibuja en un sitio. La clave identifica el mismo elemento entre escenas. */
export type Elemento =
  | ElementoEmplazamiento
  | ElementoAgrupacion
  | ElementoBarrio
  | ElementoMunicipio
  | ElementoProvincia;

/** Lo que recoge varios emplazamientos y, al pulsarlo, acerca el mapa a su zona. */
export type ElementoAbrible =
  | ElementoAgrupacion
  | ElementoBarrio
  | ElementoMunicipio
  | ElementoProvincia;

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
  /**
   * Los elementos del nivel `nivel` cuyo punto cae dentro de `caja`. El emplazamiento de clave
   * `aparte` (el seleccionado) se ve siempre suelto, aunque una agrupación lo recoja; esa
   * agrupación lo sigue contando en su número.
   */
  readonly escena: (nivel: number, caja: Rectangulo, aparte?: string | null) => Escena;
  /**
   * Cómo pasan los elementos de la escena `antes` a la escena `despues`. Si alguna la ha hecho otro
   * agrupador, como al llegar una capa nueva, no hay transición.
   */
  readonly transicion: (antes: Escena, despues: Escena) => Transicion;
  /**
   * El zoom al que hay que acercarse para que la agrupación, el barrio o el municipio se abra en
   * varios elementos.
   */
  readonly zoomDeApertura: (elemento: ElementoAbrible) => number;
  /** Los emplazamientos que recoge un elemento: él mismo, o los de su agrupación o su zona. */
  readonly emplazamientosDe: (elemento: Elemento) => ReadonlyArray<EmplazamientoLeido>;
}

/** El nivel de agrupación de un zoom del mapa: su parte entera, hasta el primero sin agrupaciones. */
export const nivelDeZoom = (zoom: number): number =>
  Math.max(0, Math.min(Math.floor(zoom), NIVEL_MAXIMO + 1));

const PREFIJO_EMPLAZAMIENTO = "e:";

/** La clave con que se ve suelto un emplazamiento, en cualquier agrupador. */
export const claveDeEmplazamiento = (clave: string): string => `${PREFIJO_EMPLAZAMIENTO}${clave}`;

/** El identificador de supercluster de una clave con ese prefijo, o `undefined` si no lo lleva. */
const idConPrefijo = (clave: string, prefijo: string): number | undefined =>
  clave.startsWith(prefijo) ? Number(clave.slice(prefijo.length)) : undefined;

type Punto = ReturnType<Indice["getClusters"]>[number];

/** La clave del elemento que se lleva más votos; en caso de empate, el primero que los tuvo. */
const masVotado = (votos: ReadonlyMap<string, number>): string | undefined => {
  let ganador: string | undefined;
  let maximo = 0;
  for (const [clave, n] of votos) {
    if (n > maximo) {
      ganador = clave;
      maximo = n;
    }
  }
  return ganador;
};

export interface OpcionesAgrupador {
  /**
   * Los índices ya construidos, por ejemplo en un Worker (`rehidratarIndice`). Sin ellos, se
   * construyen aquí.
   */
  readonly indices?: IndicesDeCapa<Indice>;
  /**
   * Lo que llevan detrás de su tipo las claves de agrupaciones y barrios, para que no se
   * confundan con las de otro agrupador en la misma escena: el código de la provincia y «:».
   */
  readonly prefijo?: string;
  /**
   * Los municipios de la provincia, ya resumidos (`resumirMunicipios`). Solo en una provincia
   * cubierta: de una a medias, un municipio del borde de lo barrido contaría solo una parte. Sin
   * ellos, los niveles de municipios son de hexágonos.
   */
  readonly municipios?: ReadonlyArray<ResumenDeMunicipio>;
}

/** El punto de `caja` más cercano a `punto`. */
export const alBorde = (punto: Coordenada, caja: Rectangulo): Coordenada => ({
  longitud: Math.min(Math.max(punto.longitud, caja.suroeste.longitud), caja.noreste.longitud),
  latitud: Math.min(Math.max(punto.latitud, caja.suroeste.latitud), caja.noreste.latitud),
});

/** Lo común a dos rectángulos que se cortan. */
export const interseccion = (a: Rectangulo, b: Rectangulo): Rectangulo => ({
  suroeste: {
    longitud: Math.max(a.suroeste.longitud, b.suroeste.longitud),
    latitud: Math.max(a.suroeste.latitud, b.suroeste.latitud),
  },
  noreste: {
    longitud: Math.min(a.noreste.longitud, b.noreste.longitud),
    latitud: Math.min(a.noreste.latitud, b.noreste.latitud),
  },
});

/** Si un nivel es de municipios: del `NIVEL_DE_MUNICIPIOS` al de barrios, sin él. */
export const esNivelDeMunicipios = (nivel: number): boolean =>
  nivel >= NIVEL_DE_MUNICIPIOS && nivel < NIVEL_DE_BARRIOS;

/**
 * Agrupa los emplazamientos de una capa. Indexar 1300 emplazamientos cuesta unos milisegundos.
 * Con `barrios`, el nivel `NIVEL_DE_BARRIOS` recoge por barrio los emplazamientos que tienen uno;
 * sin ellos, ese nivel es uno más de hexágonos. Con `municipios`, los niveles de municipios los
 * recogen por municipio, y los que no tienen ninguno van sueltos: son pocos, los de un territorio
 * compartido.
 */
export const crearAgrupador = (
  emplazamientos: ReadonlyArray<EmplazamientoLeido>,
  barrios: ReadonlyArray<Barrio> = [],
  opciones: OpcionesAgrupador = {},
): Agrupador => {
  const prefijo = opciones.prefijo ?? "";
  const PREFIJO_AGRUPACION = `a:${prefijo}`;
  // Las agrupaciones de fuera de Barcelona en el nivel de barrios, que salen de otro índice.
  const PREFIJO_AGRUPACION_FUERA = `f:${prefijo}`;
  const PREFIJO_BARRIO = `b:${prefijo}`;
  const PREFIJO_MUNICIPIO = `m:${prefijo}`;
  const idDeClave = (clave: string): number | undefined => idConPrefijo(clave, PREFIJO_AGRUPACION);
  const indices = opciones.indices ?? indexarCapa(emplazamientos, barrios.length > 0);
  const indice = indices.todos;
  // Los de fuera de Barcelona se agrupan aparte en el nivel de barrios. Sin barrios no hace falta.
  const fuera = indices.fuera ?? indice;
  const resumenes = resumirBarrios(barrios, emplazamientos, COMPANIAS_DE_CAPA);
  const hayBarrios = resumenes.length > 0;
  const deBarrio = new Map<string, Array<number>>();
  for (const [i, emplazamiento] of emplazamientos.entries()) {
    if (emplazamiento.barrio === null) continue;
    const suyos = deBarrio.get(emplazamiento.barrio) ?? [];
    suyos.push(i);
    deBarrio.set(emplazamiento.barrio, suyos);
  }
  const barriosPorClave = new Map(
    resumenes.map((resumen): [string, ElementoBarrio] => {
      const clave = `${PREFIJO_BARRIO}${resumen.barrio.codigo}`;
      return [clave, { tipo: "barrio", clave, posicion: resumen.barrio.etiqueta, resumen }];
    }),
  );
  const esDeBarrios = (nivel: number): boolean => hayBarrios && nivel === NIVEL_DE_BARRIOS;

  const municipios = (opciones.municipios ?? []).map((resumen): ElementoMunicipio => ({
    tipo: "municipio",
    clave: `${PREFIJO_MUNICIPIO}${resumen.municipio.codigo}`,
    posicion: resumen.municipio.etiqueta,
    resumen,
  }));
  const hayMunicipios = municipios.length > 0;
  const deMunicipio = new Map<string, Array<number>>();
  const sinMunicipio: Array<number> = [];
  if (hayMunicipios) {
    for (const [i, emplazamiento] of emplazamientos.entries()) {
      const codigo = emplazamiento.municipio ?? null;
      if (codigo === null) {
        sinMunicipio.push(i);
        continue;
      }
      const suyos = deMunicipio.get(codigo) ?? [];
      suyos.push(i);
      deMunicipio.set(codigo, suyos);
    }
  }
  const esDeMunicipios = (nivel: number): boolean => hayMunicipios && esNivelDeMunicipios(nivel);
  /** Los niveles en que las zonas recogen los emplazamientos, sin jerarquía de supercluster. */
  const esDeZonas = (nivel: number): boolean => esDeBarrios(nivel) || esDeMunicipios(nivel);

  /**
   * Los municipios que se ven en `caja`: los que tienen su etiqueta dentro y los que tienen dentro
   * algún emplazamiento aunque su etiqueta quede fuera, con la etiqueta dentro de lo que se ve de
   * ellos. Si no, en un municipio grande se verían sus calles sin nada que diga que tiene
   * emplazamientos.
   */
  const municipiosEn = (caja: Rectangulo, elementos: Map<string, Elemento>): void => {
    const visible = cajaVisible(caja);
    for (const municipio of municipios) {
      if (contiene(caja, municipio.posicion)) {
        elementos.set(municipio.clave, municipio);
        continue;
      }
      const suya = municipio.resumen.caja;
      if (suya === undefined || !seCortan(suya, caja)) continue;
      const dentro = seCortan(suya, visible)
        ? interseccion(suya, visible)
        : interseccion(suya, caja);
      elementos.set(municipio.clave, {
        ...municipio,
        posicion: alBorde(municipio.posicion, dentro),
      });
    }
  };

  const elementoDe = (
    punto: Punto,
    prefijoAgrupacion = PREFIJO_AGRUPACION,
  ): Elemento | undefined => {
    const [longitud = 0, latitud = 0] = punto.geometry.coordinates;
    const posicion = { longitud, latitud };
    const propiedades = punto.properties;
    if ("cluster" in propiedades) {
      return {
        tipo: "agrupacion",
        clave: `${prefijoAgrupacion}${propiedades.cluster_id}`,
        posicion,
        cuantos: propiedades.point_count,
      };
    }
    const emplazamiento = emplazamientos[propiedades.indice];
    return emplazamiento === undefined
      ? undefined
      : {
          tipo: "emplazamiento",
          clave: claveDeEmplazamiento(emplazamiento.clave),
          posicion: emplazamiento.posicion,
          emplazamiento,
        };
  };

  // Las escenas de este agrupador: las claves de agrupación de otro no valen en este índice.
  const propias = new WeakSet<Escena>();

  const indicePorClave = new Map(emplazamientos.map((e, i) => [e.clave, i]));

  const escena = (nivel: number, caja: Rectangulo, aparte: string | null = null): Escena => {
    const elementos = new Map<string, Elemento>();
    const bbox: [number, number, number, number] = [
      caja.suroeste.longitud,
      caja.suroeste.latitud,
      caja.noreste.longitud,
      caja.noreste.latitud,
    ];
    if (esDeMunicipios(nivel)) {
      municipiosEn(caja, elementos);
      for (const i of sinMunicipio) {
        const emplazamiento = emplazamientos[i];
        if (emplazamiento === undefined || !contiene(caja, emplazamiento.posicion)) continue;
        const clave = claveDeEmplazamiento(emplazamiento.clave);
        elementos.set(clave, {
          tipo: "emplazamiento",
          clave,
          posicion: emplazamiento.posicion,
          emplazamiento,
        });
      }
    } else {
      if (esDeBarrios(nivel)) {
        for (const barrio of barriosPorClave.values()) {
          if (contiene(caja, barrio.posicion)) elementos.set(barrio.clave, barrio);
        }
      }
      const [origen, prefijoAgrupacion] = esDeBarrios(nivel)
        ? [fuera, PREFIJO_AGRUPACION_FUERA]
        : [indice, PREFIJO_AGRUPACION];
      for (const punto of origen.getClusters(bbox, nivel)) {
        const elemento = elementoDe(punto, prefijoAgrupacion);
        if (elemento !== undefined) elementos.set(elemento.clave, elemento);
      }
    }
    const suelto = emplazamientos[indicePorClave.get(aparte ?? "") ?? -1];
    if (suelto !== undefined && contiene(caja, suelto.posicion)) {
      const clave = claveDeEmplazamiento(suelto.clave);
      elementos.set(clave, {
        tipo: "emplazamiento",
        clave,
        posicion: suelto.posicion,
        emplazamiento: suelto,
      });
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

  /** Las posiciones en la capa de los emplazamientos que recoge un elemento. */
  const hojasDe = (elemento: Elemento): ReadonlyArray<number> => {
    switch (elemento.tipo) {
      case "emplazamiento": {
        const i = indicePorClave.get(elemento.emplazamiento.clave);
        return i === undefined ? [] : [i];
      }
      case "barrio": {
        return deBarrio.get(elemento.resumen.barrio.codigo) ?? [];
      }
      case "municipio": {
        return deMunicipio.get(elemento.resumen.municipio.codigo) ?? [];
      }
      case "provincia": {
        return [];
      }
      case "agrupacion": {
        const id = idDeClave(elemento.clave);
        const idFuera = idConPrefijo(elemento.clave, PREFIJO_AGRUPACION_FUERA);
        const [origen, cual] = id === undefined ? [fuera, idFuera] : [indice, id];
        return cual === undefined
          ? []
          : origen.getLeaves(cual, Number.POSITIVE_INFINITY).map((hoja) => hoja.properties.indice);
      }
    }
  };

  /**
   * Al entrar o salir de un nivel de zonas (barrios o municipios) no hay jerarquía de supercluster
   * que seguir: cada elemento de la escena fina va al de la gruesa que recoge más emplazamientos
   * suyos. Una zona sin emplazamientos no va a ninguno y aparece o se apaga en su sitio.
   */
  const relacionPorHojas = (fina: Escena, gruesa: Escena): Map<string, string> => {
    const deHoja = new Map<number, string>();
    for (const elemento of gruesa.elementos.values()) {
      for (const hoja of hojasDe(elemento)) {
        // El seleccionado va suelto además de contar en su grupo: manda el grupo, que va antes.
        if (!deHoja.has(hoja)) deHoja.set(hoja, elemento.clave);
      }
    }
    const relacion = new Map<string, string>();
    for (const elemento of fina.elementos.values()) {
      if (gruesa.elementos.has(elemento.clave)) continue;
      const votos = new Map<string, number>();
      for (const hoja of hojasDe(elemento)) {
        const destino = deHoja.get(hoja);
        if (destino !== undefined) votos.set(destino, (votos.get(destino) ?? 0) + 1);
      }
      const ganador = masVotado(votos);
      if (ganador !== undefined) relacion.set(elemento.clave, ganador);
    }
    return relacion;
  };

  const transicion = (antes: Escena, despues: Escena): Transicion => {
    if (antes.nivel === despues.nivel || !propias.has(antes) || !propias.has(despues)) {
      return SIN_TRANSICION;
    }
    const alejar = despues.nivel < antes.nivel;
    const [fina, gruesa] = alejar ? [antes, despues] : [despues, antes];
    if (esDeZonas(fina.nivel) || esDeZonas(gruesa.nivel)) {
      const relacion = relacionPorHojas(fina, gruesa);
      return alejar
        ? { destino: relacion, origen: SIN_TRANSICION.origen }
        : { destino: SIN_TRANSICION.destino, origen: relacion };
    }
    const relacion = new Map<string, string>();
    const tope = { pasos: TOPE_DE_PASOS };
    for (const elemento of gruesa.elementos.values()) {
      if (elemento.tipo !== "agrupacion") continue;
      const descendientes: Array<string> = [];
      bajar(elemento.clave, Math.min(fina.nivel, NIVEL_MAXIMO + 1), descendientes, tope);
      for (const descendiente of descendientes) {
        // Lo que está en las dos escenas, como el seleccionado, no se mueve.
        if (fina.elementos.has(descendiente) && !gruesa.elementos.has(descendiente)) {
          relacion.set(descendiente, elemento.clave);
        }
      }
    }
    return alejar
      ? { destino: relacion, origen: SIN_TRANSICION.origen }
      : { destino: SIN_TRANSICION.destino, origen: relacion };
  };

  const zoomDeApertura = (elemento: ElementoAbrible): number => {
    if (elemento.tipo === "barrio") return NIVEL_DE_BARRIOS + 1;
    // Un municipio se abre en el nivel siguiente a los de municipios: barrios en Barcelona y
    // hexágonos pequeños en el resto.
    if (elemento.tipo === "municipio") return NIVEL_DE_BARRIOS;
    if (elemento.tipo === "provincia") return NIVEL_MAXIMO + 1;
    const id = idDeClave(elemento.clave);
    const idFuera = idConPrefijo(elemento.clave, PREFIJO_AGRUPACION_FUERA);
    const expansion =
      id === undefined
        ? idFuera === undefined
          ? NIVEL_MAXIMO + 1
          : fuera.getClusterExpansionZoom(idFuera)
        : indice.getClusterExpansionZoom(id);
    return Math.min(expansion, NIVEL_MAXIMO + 1);
  };

  const emplazamientosDe = (elemento: Elemento): ReadonlyArray<EmplazamientoLeido> =>
    hojasDe(elemento).flatMap((i) => emplazamientos[i] ?? []);

  return { escena, transicion, zoomDeApertura, emplazamientosDe };
};
