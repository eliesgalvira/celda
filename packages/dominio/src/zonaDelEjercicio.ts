import * as Schema from "effect/Schema";

import type { Coordenada } from "./area.ts";
import { Caja } from "./barrido.ts";
import type { Poligono } from "./barrio.ts";
import type { ZonaBarrida } from "./cobertura.ts";
import { FuenteDeMunicipios } from "./municipio.ts";
import { nombreDeLugarDeMunicipio, nombreDeLugarDeProvincia } from "./nombreDeLugar.ts";

/**
 * La zona del ejercicio de emplazamientos: un barrio de Barcelona o cualquier municipio de España
 * (ADR 0017). La web la lleva en la URL como un código: el del barrio, de dos cifras, o el código
 * INE del municipio, de cinco. Para buscarla sin descargar toda España, la web lleva un índice con
 * el nombre de cada municipio; el contorno de los municipios de una provincia se descarga al abrir
 * el ejercicio en ella.
 */

/** El municipio de Barcelona, el único con barrios. */
export const MUNICIPIO_DE_BARCELONA = "08019";

/** La provincia de Barcelona. */
export const PROVINCIA_DE_BARCELONA = "08";

export type ZonaDelEjercicio =
  | {
      readonly tipo: "barrio";
      /** Código del Ayuntamiento, de «01» a «73». */
      readonly codigo: string;
    }
  | {
      readonly tipo: "municipio";
      /** Código INE de cinco cifras. */
      readonly codigo: string;
    };

/**
 * La zona que dice un código: dos cifras son un barrio de Barcelona, como en los enlaces de antes
 * de los municipios, y cinco, un municipio. Cualquier otra cosa no es una zona.
 */
export const zonaDeCodigo = (codigo: string): ZonaDelEjercicio | undefined => {
  if (/^\d{2}$/u.test(codigo)) return { tipo: "barrio", codigo };
  if (/^\d{5}$/u.test(codigo)) return { tipo: "municipio", codigo };
  return undefined;
};

/** La provincia en cuya capa están los emplazamientos de la zona. */
export const provinciaDeZona = (zona: ZonaDelEjercicio): string =>
  zona.tipo === "barrio" ? PROVINCIA_DE_BARCELONA : zona.codigo.slice(0, 2);

/** Una provincia con la caja de sus límites: dice qué contornos mirar para un punto del mapa. */
export const ProvinciaConCaja = Schema.Struct({
  codigo: Schema.String,
  nombre: Schema.String,
  caja: Caja,
});
export type ProvinciaConCaja = typeof ProvinciaConCaja.Type;

/** El índice de municipios y provincias que la web usa para buscar una zona. */
export const IndiceDeZonas = Schema.Struct({
  fuente: FuenteDeMunicipios,
  /** Tolerancia de los contornos de cada provincia, en metros. */
  toleranciaMetros: Schema.Finite,
  /** Por código. */
  provincias: Schema.Array(ProvinciaConCaja),
  /** Código y nombre de cada municipio, por código. */
  municipios: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
});
export type IndiceDeZonas = typeof IndiceDeZonas.Type;

/**
 * Las provincias del índice, sin los municipios. La cabecera del mapa y la vista inicial las usan
 * para saber en qué provincia cae un punto sin descargar el nombre de los 8.132 municipios.
 */
export const ProvinciasDeZonas = Schema.Struct({
  fuente: FuenteDeMunicipios,
  provincias: Schema.Array(ProvinciaConCaja),
});
export type ProvinciasDeZonas = typeof ProvinciasDeZonas.Type;

/** Una zona que se puede elegir, con lo que se lee de ella en la lista. */
export interface ZonaNombrada {
  readonly zona: ZonaDelEjercicio;
  /** Su nombre de lugar, en una sola forma: «Elx» (ADR 0025). */
  readonly nombre: string;
  /** Dónde está: la provincia de un municipio o «Barrio de Barcelona». */
  readonly lugar: string;
  /** El nombre oficial de un municipio, «Elx/Elche». La búsqueda también lo mira. */
  readonly oficial?: string | undefined;
}

/**
 * Los municipios del índice como zonas, con su nombre de lugar y el de su provincia. El índice
 * guarda el oficial, y la zona lo lleva para buscar: «Elche» encuentra Elx.
 */
export const municipiosDelIndice = (indice: IndiceDeZonas): ReadonlyArray<ZonaNombrada> => {
  const provincias = new Map(
    indice.provincias.map((p) => [p.codigo, nombreDeLugarDeProvincia(p.codigo, p.nombre)]),
  );
  return indice.municipios.map(([codigo, oficial]) => ({
    zona: { tipo: "municipio", codigo },
    nombre: nombreDeLugarDeMunicipio(codigo, oficial),
    lugar: provincias.get(codigo.slice(0, 2)) ?? "",
    oficial,
  }));
};

/** Un texto sin tildes, en minúsculas y con los signos como espacios, para comparar nombres. */
export const normalizar = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();

/**
 * Qué tal casa un nombre con lo buscado: 0 si es igual, 1 si empieza igual, 2 si alguna de sus
 * palabras empieza igual y 3 si lo contiene. `undefined` si no casa.
 */
const parecido = (nombre: string, buscado: string): number | undefined => {
  if (nombre === buscado) return 0;
  if (nombre.startsWith(buscado)) return 1;
  const palabras = nombre.split(" ");
  if (palabras.some((_, i) => palabras.slice(i).join(" ").startsWith(buscado))) return 2;
  return nombre.includes(buscado) ? 3 : undefined;
};

/** El mejor de unos parecidos, el más bajo, o `undefined` si ninguno casa. */
const elMejor = (parecidos: ReadonlyArray<number | undefined>): number | undefined =>
  parecidos.reduce<number | undefined>(
    (mejor, otro) => (otro === undefined || (mejor !== undefined && mejor <= otro) ? mejor : otro),
    undefined,
  );

/**
 * Las zonas cuyo nombre casa con lo buscado, sin mirar tildes, mayúsculas ni apóstrofos: primero
 * las que se llaman así, luego las que empiezan así, las que tienen una palabra que empieza así y
 * las que lo contienen. Dentro de cada grupo, el nombre más corto y después por orden alfabético.
 * El nombre de la provincia también cuenta, así que «Soria» da la capital antes que los pueblos
 * de la provincia, y el oficial también: «Elche» y «Elx» dan Elx.
 */
export const buscarZonas = (
  consulta: string,
  zonas: ReadonlyArray<ZonaNombrada>,
  maximo = 8,
): ReadonlyArray<ZonaNombrada> => {
  const buscado = normalizar(consulta);
  if (buscado === "") return [];
  const encontradas: Array<{ readonly zona: ZonaNombrada; readonly orden: number }> = [];
  for (const zona of zonas) {
    const nombres = zona.oficial === undefined ? [zona.nombre] : [zona.nombre, zona.oficial];
    const propio = elMejor(nombres.map((nombre) => parecido(normalizar(nombre), buscado)));
    const conLugar = elMejor(
      nombres.map((nombre) => parecido(normalizar(`${nombre} ${zona.lugar}`), buscado)),
    );
    const orden = propio ?? (conLugar === undefined ? undefined : conLugar + 4);
    if (orden !== undefined) encontradas.push({ zona, orden });
  }
  return encontradas
    .sort(
      (a, b) =>
        a.orden - b.orden ||
        a.zona.nombre.length - b.zona.nombre.length ||
        a.zona.nombre.localeCompare(b.zona.nombre, "es"),
    )
    .slice(0, maximo)
    .map((e) => e.zona);
};

/** Las provincias cuyos límites pueden contener el punto: las de caja que lo contiene. */
export const provinciasDelPunto = (
  indice: IndiceDeZonas,
  punto: Coordenada,
): ReadonlyArray<string> =>
  indice.provincias
    .filter(
      ({ caja: [oeste, sur, este, norte] }) =>
        punto.longitud >= oeste &&
        punto.longitud <= este &&
        punto.latitud >= sur &&
        punto.latitud <= norte,
    )
    .map((p) => p.codigo);

/**
 * Si Celda tiene todos los emplazamientos de una zona: cada vértice de su límite cae en una caja
 * de alguna zona de barrido ya barrida. Dentro de lo barrido el mapa tiene todos los del registro
 * oficial, así que una zona dentro tiene todos los suyos. Mide con el contorno simplificado: un
 * trozo de menos de la tolerancia que se salga de lo barrido no se ve.
 */
export const zonaCubierta = (
  poligonos: ReadonlyArray<Poligono>,
  cobertura: ReadonlyArray<ZonaBarrida>,
): boolean => {
  const cajas = cobertura.flatMap((z) => (z.barrido === null ? [] : z.cajas));
  const vertices = poligonos.flatMap((p) => p[0] ?? []);
  return (
    vertices.length > 0 &&
    vertices.every(([x, y]) =>
      cajas.some(([oeste, sur, este, norte]) => x >= oeste && x <= este && y >= sur && y <= norte),
    )
  );
};
