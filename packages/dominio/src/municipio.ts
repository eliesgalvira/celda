import * as Schema from "effect/Schema";

import { Coordenada, distanciaMetros } from "./area.ts";
import { type Anillo, dentroDelPoligono, type Poligono } from "./barrio.ts";
import { aPlano } from "./plano.ts";
import { FuenteDePoblacion } from "./poblacion.ts";

/**
 * Municipios y provincias de España (ADR 0017). Los límites salen de la Base de Datos de Límites
 * Jurisdiccionales del IGN y los habitantes, del padrón del INE; los descarga a mano la orden
 * `municipios` de `tools/capas`, que los guarda simplificados en el repositorio. La capital de
 * cada municipio sale del Nomenclátor Geográfico Básico de España del IGN, con la orden
 * `capitales`. El publicador pone a cada emplazamiento su municipio y su provincia con
 * `municipioDelPunto`, y a cada municipio su punto en el mapa con `puntoDeMunicipio`.
 */

/** De dónde salen los límites: lo que hay que citar en una obra derivada del IGN. */
export const FuenteDeMunicipios = Schema.Struct({
  atribucion: Schema.String,
  /** Nombre del producto tal como lo da el canal de descarga del IGN. */
  producto: Schema.String,
  licencia: Schema.String,
  /** Canal ATOM del conjunto. */
  enlace: Schema.String,
  /** Fecha de los datos según el canal, `AAAA-MM-DD`. */
  fecha: Schema.String,
  /** SHA-256 del fichero descargado del que salen, para saber si dos descargas son la misma. */
  huella: Schema.String,
});
export type FuenteDeMunicipios = typeof FuenteDeMunicipios.Type;

/** Una provincia: su código INE de dos cifras, su nombre en el IGN y dónde va su etiqueta. */
export const Provincia = Schema.Struct({
  codigo: Schema.String,
  nombre: Schema.String,
  etiqueta: Coordenada,
});
export type Provincia = typeof Provincia.Type;

/**
 * Qué es cada recinto del IGN: un municipio, un territorio compartido por varios municipios sin
 * ser de ninguno (Bardenas Reales, las «Comunidad de…» de Burgos) o un territorio sin provincia
 * (Gibraltar, las plazas de soberanía).
 */
export const TipoDeTerritorio = Schema.Literals(["municipio", "compartido", "sin-provincia"]);
export type TipoDeTerritorio = typeof TipoDeTerritorio.Type;

/**
 * Un recinto del IGN. Su límite no lleva coordenadas, sino los arcos de `LimitesDeMunicipios`
 * que lo forman: el lado que comparten dos vecinos es un solo arco, así que simplificarlo no abre
 * huecos ni solapes entre ellos.
 */
export const Territorio = Schema.Struct({
  /**
   * Código INE de cinco cifras si es un municipio («08019»). Si no, el código nacional de once
   * cifras del IGN, que no se confunde con ninguno del INE.
   */
  codigo: Schema.String,
  tipo: TipoDeTerritorio,
  nombre: Schema.String,
  /** Código INE de la provincia, o `null` en un territorio sin provincia. */
  provincia: Schema.NullOr(Schema.String),
  /** Un punto dentro del recinto, cerca de su centro. */
  etiqueta: Coordenada,
  /** Área en km², calculada con el límite sin simplificar. */
  areaKm2: Schema.Finite,
  /**
   * Polígonos, cada uno con su anillo exterior y sus agujeros. Un anillo es una lista de arcos:
   * `i` recorre el arco `i` tal cual y `~i` (`-i - 1`), al revés.
   */
  poligonos: Schema.Array(Schema.Array(Schema.Array(Schema.Int))),
});
export type Territorio = typeof Territorio.Type;

/** Los límites de todos los recintos de España, simplificados y con su fuente. */
export const LimitesDeMunicipios = Schema.Struct({
  fuente: FuenteDeMunicipios,
  /** Tolerancia de la simplificación, en metros. */
  toleranciaMetros: Schema.Finite,
  /** Cuántas unidades de los arcos hay en un grado. */
  unidadesPorGrado: Schema.Int,
  provincias: Schema.Array(Provincia),
  /** Ordenados por código. Si dos se solapan, gana el primero. */
  territorios: Schema.Array(Territorio),
  /**
   * Los arcos, cada uno como `[x0, y0, dx1, dy1, …]`: el primer vértice y la diferencia de cada
   * uno con el anterior, en enteros de `1 / unidadesPorGrado` grados, longitud antes que latitud.
   */
  arcos: Schema.Array(Schema.Array(Schema.Int)),
});
export type LimitesDeMunicipios = typeof LimitesDeMunicipios.Type;

/** De dónde salen las capitales: lo que hay que citar en una obra derivada del IGN. */
export const FuenteDeCapitales = Schema.Struct({
  atribucion: Schema.String,
  /** Nombre del producto tal como lo da el servicio del IGN. */
  producto: Schema.String,
  licencia: Schema.String,
  /** Las capacidades del servicio WFS, que dicen la licencia. */
  enlace: Schema.String,
  /** El último cambio de alguna capital según el servicio, `AAAA-MM-DD`. */
  fecha: Schema.String,
});
export type FuenteDeCapitales = typeof FuenteDeCapitales.Type;

/**
 * La capital de cada municipio: el punto oficial de su núcleo principal en el Nomenclátor
 * Geográfico Básico de España del IGN, con el nombre del núcleo. La descarga a mano la orden
 * `capitales` de `tools/capas`.
 */
export const CapitalesDeMunicipios = Schema.Struct({
  fuente: FuenteDeCapitales,
  /** Por código INE, ordenadas, una por municipio. */
  capitales: Schema.Array(
    Schema.Struct({ codigo: Schema.String, nombre: Schema.String, posicion: Coordenada }),
  ),
});
export type CapitalesDeMunicipios = typeof CapitalesDeMunicipios.Type;

/** Los habitantes de cada municipio en el padrón, con la fuente que hay que citar. */
export const PadronDeMunicipios = Schema.Struct({
  fuente: FuenteDePoblacion,
  /** Por código INE, ordenados. */
  municipios: Schema.Array(Schema.Struct({ codigo: Schema.String, habitantes: Schema.Int })),
});
export type PadronDeMunicipios = typeof PadronDeMunicipios.Type;

const Nombrado = Schema.Struct({ codigo: Schema.String, nombre: Schema.String });

/**
 * El municipio y la provincia de un emplazamiento, tal como los cuenta su ficha. En el lote de
 * fichas la fuente va una sola vez, en `fuenteDeLugares`, y `leerLoteDeProvincia` la copia en
 * cada ficha.
 */
export const Lugar = Schema.Struct({
  /** `null` en un territorio compartido, fuera de España o en el mar lejos de la costa. */
  municipio: Schema.NullOr(Nombrado),
  /** `null` fuera de España, en el mar lejos de la costa o en un territorio sin provincia. */
  provincia: Schema.NullOr(Nombrado),
  fuente: Schema.optionalKey(FuenteDeMunicipios),
});
export type Lugar = typeof Lugar.Type;

/**
 * Hasta dónde se busca el municipio de un punto que no cae en ninguno. La costa simplificada a
 * 50 m deja en el mar emplazamientos que están en el puerto o en el paseo marítimo.
 */
export const DISTANCIA_A_LA_COSTA_METROS = 200;

/** Lado de las celdas de la rejilla del índice, en grados. */
const LADO_CELDA = 0.1;

/** Metros en un grado de latitud, con el radio medio de la Tierra. */
const METROS_POR_GRADO = 111_195;

const claveDeCelda = (columna: number, fila: number): number => (columna + 4000) * 8000 + fila;

/**
 * Los límites listos para preguntar en qué municipio cae un punto: una rejilla de celdas de
 * 0,1° con los recintos que llegan a cada una. Los anillos de un recinto se reconstruyen la
 * primera vez que hacen falta, así que el índice de toda España ocupa poco hasta que se usa.
 */
export interface IndiceDeMunicipios {
  readonly fuente: FuenteDeMunicipios;
  readonly provincias: ReadonlyMap<string, Provincia>;
  readonly territorios: ReadonlyArray<Territorio>;
  /** Oeste, sur, este y norte de cada recinto, en grados. */
  readonly cajas: Float64Array;
  /** Por celda, los recintos cuya caja, con el margen de la costa, llega a ella. */
  readonly rejilla: ReadonlyMap<number, ReadonlyArray<number>>;
  /** Los polígonos de un recinto, en grados. */
  readonly poligonosDe: (territorio: number) => ReadonlyArray<Poligono>;
}

/** La caja de un arco sin reconstruir sus vértices. */
const cajaDelArco = (arco: ReadonlyArray<number>, porGrado: number): readonly number[] => {
  let x = 0;
  let y = 0;
  let oeste = Infinity;
  let sur = Infinity;
  let este = -Infinity;
  let norte = -Infinity;
  for (let k = 0; k + 1 < arco.length; k += 2) {
    x += arco[k] ?? 0;
    y += arco[k + 1] ?? 0;
    oeste = Math.min(oeste, x);
    este = Math.max(este, x);
    sur = Math.min(sur, y);
    norte = Math.max(norte, y);
  }
  return [oeste / porGrado, sur / porGrado, este / porGrado, norte / porGrado];
};

const verticesDelArco = (arco: ReadonlyArray<number>, porGrado: number): Anillo => {
  const vertices: Array<readonly [number, number]> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < arco.length; k += 2) {
    x += arco[k] ?? 0;
    y += arco[k + 1] ?? 0;
    vertices.push([x / porGrado, y / porGrado]);
  }
  return vertices;
};

/** El arco al que se refiere `referencia`: `i` o `~i`. */
export const arcoDe = (referencia: number): number => (referencia >= 0 ? referencia : ~referencia);

/** Un anillo a partir de sus arcos: cada arco empieza donde acaba el anterior. */
export const anilloDeArcos = (
  referencias: ReadonlyArray<number>,
  verticesDe: (arco: number) => Anillo,
): Anillo => {
  const anillo: Array<Anillo[number]> = [];
  for (const referencia of referencias) {
    const vertices = verticesDe(arcoDe(referencia));
    const ordenados = referencia >= 0 ? vertices : vertices.toReversed();
    for (let k = anillo.length === 0 ? 0 : 1; k < ordenados.length; k++) {
      const vertice = ordenados[k];
      if (vertice !== undefined) anillo.push(vertice);
    }
  }
  return anillo;
};

/**
 * Prepara los límites para `municipioDelPunto`. Recorre los arcos una vez para sacar la caja de
 * cada recinto; los vértices se reconstruyen después, recinto a recinto, cuando hacen falta.
 */
export const indexarMunicipios = (limites: LimitesDeMunicipios): IndiceDeMunicipios => {
  const porGrado = limites.unidadesPorGrado;
  const cajasDeArcos = limites.arcos.map((arco) => cajaDelArco(arco, porGrado));
  const cajas = new Float64Array(limites.territorios.length * 4);
  const rejilla = new Map<number, Array<number>>();
  for (const [i, territorio] of limites.territorios.entries()) {
    let [oeste, sur, este, norte] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poligono of territorio.poligonos) {
      for (const referencia of poligono[0] ?? []) {
        const [o = 0, s = 0, e = 0, n = 0] = cajasDeArcos[arcoDe(referencia)] ?? [];
        oeste = Math.min(oeste, o);
        sur = Math.min(sur, s);
        este = Math.max(este, e);
        norte = Math.max(norte, n);
      }
    }
    cajas.set([oeste, sur, este, norte], i * 4);
    if (!Number.isFinite(oeste)) continue;
    const margenLatitud = DISTANCIA_A_LA_COSTA_METROS / METROS_POR_GRADO;
    const coseno = Math.cos((Math.max(Math.abs(sur), Math.abs(norte)) * Math.PI) / 180);
    const margenLongitud = margenLatitud / Math.max(coseno, 0.01);
    const desdeColumna = Math.floor((oeste - margenLongitud) / LADO_CELDA);
    const hastaColumna = Math.floor((este + margenLongitud) / LADO_CELDA);
    const desdeFila = Math.floor((sur - margenLatitud) / LADO_CELDA);
    const hastaFila = Math.floor((norte + margenLatitud) / LADO_CELDA);
    for (let columna = desdeColumna; columna <= hastaColumna; columna++) {
      for (let fila = desdeFila; fila <= hastaFila; fila++) {
        const clave = claveDeCelda(columna, fila);
        const lista = rejilla.get(clave);
        if (lista === undefined) rejilla.set(clave, [i]);
        else lista.push(i);
      }
    }
  }

  const arcosLeidos = new Map<number, Anillo>();
  const verticesDe = (arco: number): Anillo => {
    let vertices = arcosLeidos.get(arco);
    if (vertices === undefined) {
      vertices = verticesDelArco(limites.arcos[arco] ?? [], porGrado);
      arcosLeidos.set(arco, vertices);
    }
    return vertices;
  };
  const poligonosLeidos = new Map<number, ReadonlyArray<Poligono>>();
  const poligonosDe = (territorio: number): ReadonlyArray<Poligono> => {
    let poligonos = poligonosLeidos.get(territorio);
    if (poligonos === undefined) {
      poligonos = (limites.territorios[territorio]?.poligonos ?? []).map((anillos) =>
        anillos.map((referencias) => anilloDeArcos(referencias, verticesDe)),
      );
      poligonosLeidos.set(territorio, poligonos);
    }
    return poligonos;
  };

  return {
    fuente: limites.fuente,
    provincias: new Map(limites.provincias.map((p) => [p.codigo, p])),
    territorios: limites.territorios,
    cajas,
    rejilla,
    poligonosDe,
  };
};

/** Distancia en metros de `punto` al borde más cercano de unos polígonos. */
const distanciaAlBorde = (punto: Coordenada, poligonos: ReadonlyArray<Poligono>): number => {
  let minima = Infinity;
  for (const poligono of poligonos) {
    for (const anillo of poligono) {
      for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i++) {
        const [xi = 0, yi = 0] = anillo[i] ?? [];
        const [xj = 0, yj = 0] = anillo[j] ?? [];
        const a = aPlano(punto, { longitud: xi, latitud: yi });
        const b = aPlano(punto, { longitud: xj, latitud: yj });
        const dx = b.este - a.este;
        const dy = b.norte - a.norte;
        const largo = dx * dx + dy * dy;
        const t = largo === 0 ? 0 : Math.max(0, Math.min(1, -(a.este * dx + a.norte * dy) / largo));
        minima = Math.min(minima, Math.hypot(a.este + t * dx, a.norte + t * dy));
      }
    }
  }
  return minima;
};

/** Dónde cae un emplazamiento: su municipio y su provincia. */
export interface Asignacion {
  /**
   * El municipio, o `undefined` en un territorio compartido, en uno sin provincia, fuera de
   * España o en el mar a más de `DISTANCIA_A_LA_COSTA_METROS` de la costa.
   */
  readonly municipio: Territorio | undefined;
  /** La provincia del municipio, o la del territorio compartido en que cae. */
  readonly provincia: Provincia | undefined;
}

const SIN_ASIGNAR: Asignacion = { municipio: undefined, provincia: undefined };

const asignacionDe = (indice: IndiceDeMunicipios, territorio: number): Asignacion => {
  const encontrado = indice.territorios[territorio];
  if (encontrado === undefined || encontrado.provincia === null) return SIN_ASIGNAR;
  return {
    municipio: encontrado.tipo === "municipio" ? encontrado : undefined,
    provincia: indice.provincias.get(encontrado.provincia),
  };
};

const enLaCaja = (indice: IndiceDeMunicipios, territorio: number, punto: Coordenada): boolean => {
  const k = territorio * 4;
  return (
    punto.longitud >= (indice.cajas[k] ?? Infinity) &&
    punto.latitud >= (indice.cajas[k + 1] ?? Infinity) &&
    punto.longitud <= (indice.cajas[k + 2] ?? -Infinity) &&
    punto.latitud <= (indice.cajas[k + 3] ?? -Infinity)
  );
};

/**
 * El municipio y la provincia en que cae un punto, por punto en polígono con la misma regla de
 * bordes que los barrios: un punto sobre el límite entre dos municipios cae en uno solo. Si no
 * cae en ningún recinto, va al más cercano a `DISTANCIA_A_LA_COSTA_METROS` o menos; si empatan,
 * al primero. En un territorio compartido no tiene municipio, pero sí la provincia del
 * territorio. En un territorio sin provincia no tiene ninguna de las dos cosas.
 */
export const municipioDelPunto = (punto: Coordenada, indice: IndiceDeMunicipios): Asignacion => {
  const candidatos =
    indice.rejilla.get(
      claveDeCelda(Math.floor(punto.longitud / LADO_CELDA), Math.floor(punto.latitud / LADO_CELDA)),
    ) ?? [];
  for (const territorio of candidatos) {
    if (
      enLaCaja(indice, territorio, punto) &&
      indice.poligonosDe(territorio).some((poligono) => dentroDelPoligono(punto, poligono))
    ) {
      return asignacionDe(indice, territorio);
    }
  }
  let cercano: number | undefined;
  let distancia = DISTANCIA_A_LA_COSTA_METROS;
  for (const territorio of candidatos) {
    const metros = distanciaAlBorde(punto, indice.poligonosDe(territorio));
    if (metros < distancia || (metros === distancia && cercano === undefined)) {
      cercano = territorio;
      distancia = metros;
    }
  }
  return cercano === undefined ? SIN_ASIGNAR : asignacionDe(indice, cercano);
};

/** El lugar que cuenta la ficha de un emplazamiento en `posicion`, sin la fuente. */
export const lugarDelPunto = (posicion: Coordenada, indice: IndiceDeMunicipios): Lugar => {
  const { municipio, provincia } = municipioDelPunto(posicion, indice);
  return {
    municipio:
      municipio === undefined ? null : { codigo: municipio.codigo, nombre: municipio.nombre },
    provincia:
      provincia === undefined ? null : { codigo: provincia.codigo, nombre: provincia.nombre },
  };
};

/** Un municipio con sus habitantes, para las tablas de zonas y el ejercicio. */
export interface MunicipioConHabitantes {
  readonly codigo: string;
  readonly nombre: string;
  readonly provincia: string;
  /** La etiqueta de su recinto (`Territorio`). */
  readonly etiqueta: Coordenada;
  /** `null` si las capitales aún no lo tienen, como un municipio recién creado. */
  readonly capital: Coordenada | null;
  readonly areaKm2: number;
  /** `null` si el padrón aún no lo tiene, como un municipio recién creado. */
  readonly habitantes: number | null;
}

/**
 * Los municipios de los límites, por código, con los habitantes del padrón y su capital. Se
 * cruzan por código INE, nunca por nombre: el IGN escribe «La Roda» y el INE, «Roda, La».
 */
export const municipiosConHabitantes = (
  limites: Pick<LimitesDeMunicipios, "territorios">,
  padron: PadronDeMunicipios,
  capitales: Pick<CapitalesDeMunicipios, "capitales">,
): ReadonlyArray<MunicipioConHabitantes> => {
  const habitantes = new Map(padron.municipios.map((m) => [m.codigo, m.habitantes]));
  const capital = new Map(capitales.capitales.map((c) => [c.codigo, c.posicion]));
  return limites.territorios.flatMap((t) =>
    t.tipo === "municipio" && t.provincia !== null
      ? [
          {
            codigo: t.codigo,
            nombre: t.nombre,
            provincia: t.provincia,
            etiqueta: t.etiqueta,
            capital: capital.get(t.codigo) ?? null,
            areaKm2: t.areaKm2,
            habitantes: habitantes.get(t.codigo) ?? null,
          },
        ]
      : [],
  );
};

/**
 * Hasta dónde llega el núcleo de un municipio alrededor de su capital. Medido el 06/10/2026 con
 * la publicación de toda España: con 2 km, el punto queda a menos de 25 px de la capital en el
 * zoom 11 en el 75 % de los municipios con emplazamientos (a 470 m de mediana) y en el 92 % de
 * los de más de 100.000 habitantes (ADR 0017).
 */
export const RADIO_DEL_NUCLEO_METROS = 2000;

/**
 * Dónde va un municipio en el mapa: en la media de sus emplazamientos a menos de
 * `RADIO_DEL_NUCLEO_METROS` de su capital o, si no tiene ninguno, en la capital. Así su hexágono
 * cae en el pueblo aunque el término sea mucho mayor, como Gavà, que sube al Garraf. La media de
 * todos sus emplazamientos caía en el mar o en otro municipio en 48 casos. Un municipio sin
 * capital va a la etiqueta de su recinto.
 */
export const puntoDeMunicipio = (
  municipio: Pick<MunicipioConHabitantes, "capital" | "etiqueta">,
  posiciones: ReadonlyArray<Coordenada>,
): Coordenada => {
  const { capital } = municipio;
  if (capital === null) return municipio.etiqueta;
  const nucleo = posiciones.filter((p) => distanciaMetros(capital, p) < RADIO_DEL_NUCLEO_METROS);
  if (nucleo.length === 0) return capital;
  return {
    longitud: nucleo.reduce((suma, p) => suma + p.longitud, 0) / nucleo.length,
    latitud: nucleo.reduce((suma, p) => suma + p.latitud, 0) / nucleo.length,
  };
};
