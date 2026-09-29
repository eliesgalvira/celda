import {
  type Coordenada,
  distanciaAlRectangulo,
  distanciaMetros,
  type Rectangulo,
} from "./area.ts";
import type { Mhz } from "./banda.ts";
import { Compania } from "./compania.ts";
import { type Generacion, USOS_DE_BANDA } from "./tecnologia.ts";

/**
 * El ejercicio de emplazamientos del modo estudiante: para una zona, cuántas estaciones base
 * tiene cada compañía, su radio de cobertura, cuántos habitantes y usuarios le tocan a cada una
 * y en qué tecnologías y bandas emiten. Todo es una función pura de lo que se le da.
 */

/**
 * Grupos que publican sus líneas móviles por separado. Orange y Yoigo son de la misma empresa
 * desde 2024 y la estadística oficial da sus líneas juntas, así que sus clientes se reparten
 * entre las estaciones base de las dos.
 */
export const GRUPOS_DE_LINEAS = ["movistar", "vodafone", "masorange", "digi"] as const;
export type GrupoDeLineas = (typeof GRUPOS_DE_LINEAS)[number];

export const GRUPO_DE_LINEAS: Readonly<Record<Compania, GrupoDeLineas>> = {
  movistar: "movistar",
  vodafone: "vodafone",
  orange: "masorange",
  yoigo: "masorange",
  digi: "digi",
};

export const NOMBRE_GRUPO: Readonly<Record<GrupoDeLineas, string>> = {
  movistar: "Movistar",
  vodafone: "Vodafone",
  masorange: "Orange y Yoigo",
  digi: "Digi",
};

/** Lo que el estudiante puede cambiar: las líneas por habitante y cómo se reparten. */
export interface ParametrosDelEjercicio {
  /** Líneas móviles por cada 100 habitantes. */
  readonly penetracion: number;
  /** Porcentaje de todas las líneas móviles que tiene cada grupo. */
  readonly cuotas: Readonly<Record<GrupoDeLineas, number>>;
}

/** De dónde sale un parámetro por defecto: lo que hay que citar con él. */
export interface FuenteDeParametros {
  readonly atribucion: string;
  readonly titulo: string;
  readonly enlace: string;
  /** El periodo al que se refieren los datos, como se escribe: «julio de 2026». */
  readonly periodo: string;
  /** Día de publicación, `AAAA-MM-DD`. */
  readonly publicada: string;
}

/**
 * Los parámetros por defecto: los de toda España en julio de 2026 según la CNMC. Las cuotas del
 * comunicado van en un gráfico; las demás líneas (1,84 %) son de marcas que usan la red de otra
 * compañía y no se reparten. Detalles en `docs/investigacion/poblacion-y-lineas.md`.
 */
export const PARAMETROS_POR_DEFECTO: ParametrosDelEjercicio = {
  penetracion: 128.3,
  cuotas: { movistar: 26.13, vodafone: 18.72, masorange: 40.6, digi: 12.71 },
};

export const FUENTE_DE_PARAMETROS: FuenteDeParametros = {
  atribucion: "CNMC",
  titulo: "Estadísticas de telecomunicaciones, julio 2026",
  enlace: "https://www.cnmc.es/prensa/datos-telecos-julio-20260923",
  periodo: "julio de 2026",
  publicada: "2026-09-23",
};

/** Lo que el ejercicio necesita de cada emplazamiento: dónde está y qué compañías emiten. */
export interface EmplazamientoDelEjercicio {
  readonly clave: string;
  readonly posicion: Coordenada;
  readonly companias: ReadonlyArray<Compania>;
}

/** Las bandas de cada compañía en un emplazamiento; `null` es un expediente sin banda conocida. */
export type BandasPorCompania = Readonly<Partial<Record<Compania, ReadonlyArray<Mhz | null>>>>;

export interface EntradaDelEjercicio {
  /** Del padrón; `null` si el padrón aún no tiene la zona, como un municipio recién creado. */
  readonly habitantes: number | null;
  readonly areaKm2: number;
  /** Los emplazamientos que caen en la zona. */
  readonly enZona: ReadonlyArray<EmplazamientoDelEjercicio>;
  /** Todos los de la capa: la estación vecina más cercana puede estar fuera de la zona. */
  readonly todos: ReadonlyArray<EmplazamientoDelEjercicio>;
  /** Las bandas de los emplazamientos de la zona cuya ficha se ha leído, por clave. */
  readonly bandas: ReadonlyMap<string, BandasPorCompania>;
  readonly parametros: ParametrosDelEjercicio;
}

/** Una estación base de la zona y la más cercana de su misma compañía. */
export interface Vecina {
  readonly desde: string;
  readonly hasta: string;
  readonly metros: number;
}

/** Cuánto se puede afirmar una tecnología a partir de las bandas. */
export type Certeza = "probable" | "posible" | "no-consta";

export interface ResultadoDeCompania {
  readonly compania: Compania;
  /** Estaciones base de la compañía en la zona: una por emplazamiento en que emite. */
  readonly estaciones: number;
  /** La vecina de cada estación de la zona, si la compañía tiene alguna otra en la capa. */
  readonly vecinas: ReadonlyArray<Vecina>;
  /** Media de las distancias a la vecina, en metros. */
  readonly distanciaMedia: number | undefined;
  /** Radio de cobertura: la mitad de la distancia media a la vecina, en metros. */
  readonly radio: number | undefined;
  readonly habitantesPorEstacion: number | undefined;
  /** Líneas móviles de su grupo en la zona. Orange y Yoigo comparten las suyas. */
  readonly lineasDelGrupo: number | undefined;
  /** Las líneas del grupo entre sus estaciones base de la zona. */
  readonly usuariosPorEstacion: number | undefined;
  /** Estaciones de la zona con alguna banda conocida en su ficha. */
  readonly conBandas: number;
  /** Estaciones de la zona cuya ficha no se ha leído. */
  readonly sinFicha: number;
  /** Bandas en que emite en la zona, de menor a mayor. */
  readonly bandas: ReadonlyArray<Mhz>;
  readonly tecnologias: Readonly<Record<Generacion, Certeza>>;
}

export interface ResultadoDelEjercicio {
  /** `null` si el padrón no tiene la zona: entonces no hay nada por habitante. */
  readonly habitantes: number | null;
  readonly areaKm2: number;
  /** Habitantes por km². */
  readonly densidad: number | undefined;
  /** Líneas móviles de toda la zona: habitantes por la penetración. */
  readonly lineas: number | undefined;
  readonly companias: ReadonlyArray<ResultadoDeCompania>;
}

export const GENERACIONES: ReadonlyArray<Generacion> = ["2G", "3G", "4G", "5G"];

const ORDEN_CERTEZA: Readonly<Record<Certeza, number>> = {
  "no-consta": 0,
  posible: 1,
  probable: 2,
};

/** La más cercana de las otras estaciones de la compañía, o nada si no hay ninguna otra. */
const vecinaDe = (
  desde: EmplazamientoDelEjercicio,
  candidatas: ReadonlyArray<EmplazamientoDelEjercicio>,
): Vecina | undefined => {
  let mejor: Vecina | undefined;
  for (const otra of candidatas) {
    if (otra.clave === desde.clave) continue;
    const metros = distanciaMetros(desde.posicion, otra.posicion);
    if (mejor === undefined || metros < mejor.metros) {
      mejor = { desde: desde.clave, hasta: otra.clave, metros };
    }
  }
  return mejor;
};

/** Qué tecnologías salen de unas bandas: la más probable de cada una y las demás que admite. */
const tecnologiasDe = (bandas: ReadonlyArray<Mhz>): Readonly<Record<Generacion, Certeza>> => {
  const certezas: Record<Generacion, Certeza> = {
    "2G": "no-consta",
    "3G": "no-consta",
    "4G": "no-consta",
    "5G": "no-consta",
  };
  const subir = (generacion: Generacion, certeza: Certeza) => {
    if (ORDEN_CERTEZA[certeza] > ORDEN_CERTEZA[certezas[generacion]]) {
      certezas[generacion] = certeza;
    }
  };
  for (const mhz of bandas) {
    USOS_DE_BANDA[mhz].forEach((generacion, i) =>
      subir(generacion, i === 0 ? "probable" : "posible"),
    );
  }
  return certezas;
};

const media = (valores: ReadonlyArray<number>): number | undefined =>
  valores.length === 0 ? undefined : valores.reduce((a, b) => a + b, 0) / valores.length;

const entre = (dividendo: number, divisor: number): number | undefined =>
  divisor === 0 ? undefined : dividendo / divisor;

/**
 * Resuelve el ejercicio de emplazamientos para una zona.
 *
 * - Cada emplazamiento de la zona en que emite una compañía es una estación base suya.
 * - La vecina de una estación es la más cercana de su misma compañía en toda la capa, esté o no
 *   en la zona. El radio de cobertura es la mitad de la distancia media a la vecina.
 * - Los habitantes por estación son los de la zona entre las estaciones de la compañía. Sin
 *   habitantes en el padrón no se calcula nada por habitante: nunca se divide por cero.
 * - Las líneas de la zona son los habitantes por la penetración; las de cada grupo, por su
 *   cuota. Los usuarios por estación son las líneas del grupo entre sus estaciones de la zona.
 * - Las tecnologías salen de las bandas y nunca son seguras: «probable» si es el uso más
 *   habitual de alguna banda y «posible» si solo lo admite.
 */
export const resolverEjercicio = (entrada: EntradaDelEjercicio): ResultadoDelEjercicio => {
  const { habitantes, areaKm2, parametros } = entrada;
  const lineas = habitantes === null ? undefined : (habitantes * parametros.penetracion) / 100;
  const todos = new Map(entrada.todos.map((e) => [e.clave, e]));
  for (const e of entrada.enZona) todos.set(e.clave, e);
  const candidatas = [...todos.values()];

  const estacionesDe = (compania: Compania) =>
    entrada.enZona.filter((e) => e.companias.includes(compania));
  const estacionesDelGrupo = (grupo: GrupoDeLineas) =>
    Compania.literals
      .filter((c) => GRUPO_DE_LINEAS[c] === grupo)
      .reduce((suma, c) => suma + estacionesDe(c).length, 0);

  const companias = Compania.literals.map((compania): ResultadoDeCompania => {
    const propias = estacionesDe(compania);
    const suyas = candidatas.filter((e) => e.companias.includes(compania));
    const vecinas = propias.flatMap((e) => {
      const vecina = vecinaDe(e, suyas);
      return vecina === undefined ? [] : [vecina];
    });
    const distanciaMedia = media(vecinas.map((v) => v.metros));
    const grupo = GRUPO_DE_LINEAS[compania];
    const lineasDelGrupo =
      lineas === undefined ? undefined : (lineas * parametros.cuotas[grupo]) / 100;

    const bandas = new Set<Mhz>();
    let conBandas = 0;
    let sinFicha = 0;
    for (const e of propias) {
      const leidas = entrada.bandas.get(e.clave);
      if (leidas === undefined) {
        sinFicha += 1;
        continue;
      }
      const conocidas = (leidas[compania] ?? []).filter((mhz): mhz is Mhz => mhz !== null);
      if (conocidas.length > 0) conBandas += 1;
      for (const mhz of conocidas) bandas.add(mhz);
    }
    const ordenadas = [...bandas].sort((a, b) => a - b);

    return {
      compania,
      estaciones: propias.length,
      vecinas,
      distanciaMedia,
      radio: distanciaMedia === undefined ? undefined : distanciaMedia / 2,
      habitantesPorEstacion: habitantes === null ? undefined : entre(habitantes, propias.length),
      lineasDelGrupo,
      usuariosPorEstacion:
        propias.length === 0 || lineasDelGrupo === undefined
          ? undefined
          : entre(lineasDelGrupo, estacionesDelGrupo(grupo)),
      conBandas,
      sinFicha,
      bandas: ordenadas,
      tecnologias: tecnologiasDe(ordenadas),
    };
  });

  return {
    habitantes,
    areaKm2,
    densidad: habitantes === null ? undefined : entre(habitantes, areaKm2),
    lineas,
    companias,
  };
};

/** Lo que el resumen nacional dice de una provincia y hace falta para buscar vecinas en ella. */
export interface ProvinciaConVecinas {
  readonly codigo: string;
  /** La caja de sus emplazamientos, o `undefined` si no tiene ninguno. */
  readonly caja: Rectangulo | undefined;
  readonly companias: ReadonlyArray<Compania>;
  /** Si Celda tiene todos sus emplazamientos, o solo los de una parte. */
  readonly cubierta: boolean;
  /** Si tiene capa que pedir. */
  readonly conCapa: boolean;
}

/** Qué provincias hacen falta para que las vecinas de la zona sean las de verdad. */
export interface ProvinciasDelBorde {
  /**
   * Las que aún no están en `todos` y pueden tener una vecina más cercana que la encontrada: hay
   * que cargarlas antes de fiarse del radio. Por código.
   */
  readonly faltan: ReadonlyArray<string>;
  /**
   * Las que pueden tener una vecina más cercana pero de las que Celda solo tiene una parte: el
   * radio puede salir mayor que el de verdad. Por código.
   */
  readonly incompletas: ReadonlyArray<string>;
}

/**
 * Las provincias que pueden cambiar el radio de cobertura de una zona junto a un borde. Una
 * estación base de la zona puede tener su vecina en otra provincia si la caja de esa provincia
 * queda más cerca que la vecina encontrada entre `todos`, los emplazamientos de las provincias
 * cargadas. Si su compañía no tiene ninguna otra estación cargada, basta con la provincia más
 * cercana que la tenga: al cargarla, la vecina encontrada acota las demás. Se llama otra vez con
 * cada provincia que llega, hasta que no falta ninguna. Es una función pura.
 */
export const provinciasParaLasVecinas = (entrada: {
  readonly enZona: ReadonlyArray<EmplazamientoDelEjercicio>;
  readonly todos: ReadonlyArray<EmplazamientoDelEjercicio>;
  readonly provincias: ReadonlyArray<ProvinciaConVecinas>;
  /** Las provincias cuyos emplazamientos ya están en `todos`. */
  readonly cargadas: ReadonlySet<string>;
}): ProvinciasDelBorde => {
  const faltan = new Set<string>();
  const incompletas = new Set<string>();
  for (const compania of Compania.literals) {
    const propias = entrada.enZona.filter((e) => e.companias.includes(compania));
    if (propias.length === 0) continue;
    const suyas = [...entrada.todos, ...entrada.enZona].filter((e) =>
      e.companias.includes(compania),
    );
    const conLaCompania = entrada.provincias.filter(
      (p): p is ProvinciaConVecinas & { readonly caja: Rectangulo } =>
        p.caja !== undefined && p.companias.includes(compania),
    );
    for (const estacion of propias) {
      const metros = vecinaDe(estacion, suyas)?.metros ?? Infinity;
      const cerca = conLaCompania
        .map((p) => ({ provincia: p, metros: distanciaAlRectangulo(estacion.posicion, p.caja) }))
        .filter((c) => c.metros < metros);
      for (const { provincia } of cerca) {
        if (!provincia.cubierta) incompletas.add(provincia.codigo);
      }
      const porCargar = cerca
        .filter((c) => c.provincia.conCapa && !entrada.cargadas.has(c.provincia.codigo))
        .sort((a, b) => a.metros - b.metros);
      const elegidas = Number.isFinite(metros) ? porCargar : porCargar.slice(0, 1);
      for (const { provincia } of elegidas) faltan.add(provincia.codigo);
    }
  }
  return { faltan: [...faltan].sort(), incompletas: [...incompletas].sort() };
};
