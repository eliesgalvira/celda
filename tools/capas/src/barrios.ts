import type { Coordenada } from "@celda/dominio/area";
import {
  type Anillo,
  dentroDelPoligono,
  type FuenteDeBarrios,
  type LimiteDeBarrio,
  type LimitesDeBarrios,
  type Poligono,
} from "@celda/dominio/barrio";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Límites de barrio de Open Data BCN: el conjunto «Unitats administratives de la ciutat de
 * Barcelona» (`20170706-districtes-barris`), fichero `BarcelonaCiutat_Barris.json`, con licencia
 * CC BY 4.0. Cada registro trae la geometría en WKT, en ETRS89 y en WGS84; se usa la de WGS84.
 */
export const CONJUNTO = "20170706-districtes-barris";
export const RECURSO = "BarcelonaCiutat_Barris.json";
export const ENLACE_CONJUNTO = `https://opendata-ajuntament.barcelona.cat/data/es/dataset/${CONJUNTO}`;

/** Un registro del fichero de barrios, con lo que se usa de él. */
export const RegistroDeBarrio = Schema.Struct({
  codi_barri: Schema.String,
  nom_barri: Schema.String,
  geometria_wgs84: Schema.String,
});
export type RegistroDeBarrio = typeof RegistroDeBarrio.Type;

/** La geometría de un barrio no es un POLYGON ni un MULTIPOLYGON que se sepa leer. */
export class GeometriaIlegible extends Schema.TaggedError<GeometriaIlegible>()(
  "GeometriaIlegible",
  { barrio: Schema.String, motivo: Schema.String },
) {}

/** Seis decimales, como la capa: unos 10 cm. */
const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

/** Un paréntesis de WKT con lo que lleva dentro: otros paréntesis o una lista de vértices. */
type Grupo = ReadonlyArray<Grupo> | Anillo;

/**
 * Lee el cuerpo de una geometría WKT, desde el primer paréntesis, como grupos anidados. Un
 * POLYGON da un grupo de anillos y un MULTIPOLYGON, un grupo de polígonos.
 */
const leerGrupos = (texto: string): Grupo => {
  let i = 0;
  const grupo = (): Grupo => {
    // Aquí `texto[i]` es el paréntesis que abre.
    i += 1;
    if (texto.slice(i).trimStart().startsWith("(")) {
      const hijos: Array<Grupo> = [];
      while (i < texto.length) {
        const siguiente = texto.indexOf("(", i);
        const cierre = texto.indexOf(")", i);
        if (cierre !== -1 && (siguiente === -1 || cierre < siguiente)) {
          i = cierre + 1;
          return hijos;
        }
        i = siguiente;
        hijos.push(grupo());
      }
      throw new Error("falta un paréntesis de cierre");
    }
    const cierre = texto.indexOf(")", i);
    if (cierre === -1) throw new Error("falta un paréntesis de cierre");
    const vertices = texto
      .slice(i, cierre)
      .split(",")
      .map((par) => {
        const [x, y] = par.trim().split(/\s+/u).map(Number);
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error(`vértice mal formado: «${par.trim()}»`);
        }
        return [redondear(x), redondear(y)] as const;
      });
    i = cierre + 1;
    return vertices;
  };
  const inicio = texto.indexOf("(");
  if (inicio === -1) throw new Error("no hay coordenadas");
  i = inicio;
  return grupo();
};

const esAnillo = (grupo: Grupo): grupo is Anillo =>
  grupo.length === 0 || !Array.isArray(grupo[0]?.[0]);

const comoPoligono = (grupo: Grupo): Poligono => {
  if (esAnillo(grupo)) throw new Error("un polígono debe llevar anillos");
  return grupo.map((anillo) => {
    if (!esAnillo(anillo) || anillo.length < 4) throw new Error("anillo mal formado");
    return anillo;
  });
};

/** Los polígonos de una geometría WKT en WGS84: un POLYGON o un MULTIPOLYGON. */
export const leerWkt = (wkt: string): ReadonlyArray<Poligono> => {
  const tipo = wkt.trimStart().split(/[\s(]/u, 1)[0]?.toUpperCase();
  const grupos = leerGrupos(wkt);
  if (tipo === "POLYGON") return [comoPoligono(grupos)];
  if (tipo === "MULTIPOLYGON" && !esAnillo(grupos)) return grupos.map(comoPoligono);
  throw new Error(`tipo de geometría no admitido: ${tipo ?? "ninguno"}`);
};

/** Área con signo y centroide de un anillo, en grados. */
const centroideDelAnillo = (anillo: Anillo) => {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < anillo.length; k++) {
    const [x1 = 0, y1 = 0] = anillo[k] ?? [];
    const [x2 = 0, y2 = 0] = anillo[(k + 1) % anillo.length] ?? [];
    const f = x1 * y2 - x2 * y1;
    area += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return {
    area: Math.abs(area / 2),
    centro: { longitud: cx / (3 * area), latitud: cy / (3 * area) },
  };
};

/**
 * El centro del tramo más largo de la horizontal de latitud `latitud` que queda dentro del
 * polígono. Sirve de etiqueta cuando el centroide cae fuera, como en un barrio con forma de C.
 */
const centroDelTramoMasLargo = (poligono: Poligono, latitud: number): Coordenada | undefined => {
  const cortes: Array<number> = [];
  for (const anillo of poligono) {
    for (let k = 0, j = anillo.length - 1; k < anillo.length; j = k, k++) {
      const [xi = 0, yi = 0] = anillo[k] ?? [];
      const [xj = 0, yj = 0] = anillo[j] ?? [];
      if (yi > latitud !== yj > latitud) {
        cortes.push(((xj - xi) * (latitud - yi)) / (yj - yi) + xi);
      }
    }
  }
  cortes.sort((a, b) => a - b);
  let mejor: Coordenada | undefined;
  let ancho = 0;
  for (let k = 0; k + 1 < cortes.length; k += 2) {
    const [desde = 0, hasta = 0] = [cortes[k], cortes[k + 1]];
    if (hasta - desde > ancho) {
      ancho = hasta - desde;
      mejor = { longitud: (desde + hasta) / 2, latitud };
    }
  }
  return mejor;
};

/**
 * Dónde va la etiqueta de un barrio: el centroide de su polígono más grande, o, si cae fuera de
 * él, el centro del tramo interior más largo a esa latitud. Siempre queda dentro del barrio.
 */
export const puntoDeEtiqueta = (poligonos: ReadonlyArray<Poligono>): Coordenada => {
  const [mayor] = poligonos
    .map((poligono) => ({ poligono, ...centroideDelAnillo(poligono[0] ?? []) }))
    .sort((a, b) => b.area - a.area);
  if (mayor === undefined) throw new Error("un barrio sin polígonos no tiene etiqueta");
  const centro = dentroDelPoligono(mayor.centro, mayor.poligono)
    ? mayor.centro
    : (centroDelTramoMasLargo(mayor.poligono, mayor.centro.latitud) ?? mayor.centro);
  return { longitud: redondear(centro.longitud), latitud: redondear(centro.latitud) };
};

const limiteDe = (registro: RegistroDeBarrio): Result.Result<LimiteDeBarrio, GeometriaIlegible> =>
  Result.try({
    try: () => {
      const poligonos = leerWkt(registro.geometria_wgs84);
      return {
        codigo: registro.codi_barri,
        nombre: registro.nom_barri,
        etiqueta: puntoDeEtiqueta(poligonos),
        poligonos,
      };
    },
    catch: (causa) =>
      new GeometriaIlegible({
        barrio: `${registro.codi_barri} ${registro.nom_barri}`,
        motivo: causa instanceof Error ? causa.message : String(causa),
      }),
  });

/**
 * Los límites de barrio a partir de los registros de Open Data BCN, ordenados por código. Falla
 * con `GeometriaIlegible` si alguna geometría no se puede leer: mejor no publicar que publicar
 * un barrio sin límites.
 */
export const limitesDeOpenData = (
  registros: ReadonlyArray<RegistroDeBarrio>,
  fuente: FuenteDeBarrios,
): Result.Result<LimitesDeBarrios, GeometriaIlegible> =>
  Result.map(Result.all(registros.map(limiteDe)), (barrios) => ({
    fuente,
    barrios: barrios.toSorted((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0)),
  }));

/**
 * El fichero de límites que se guarda en el repositorio: JSON con un barrio por línea, para que
 * un cambio en los datos se lea bien en un diff.
 */
export const ficheroDeLimites = (limites: LimitesDeBarrios): string => {
  const barrios = limites.barrios.map((barrio) => JSON.stringify(barrio));
  return `{"fuente":${JSON.stringify(limites.fuente)},"barrios":[\n${barrios.join(",\n")}\n]}\n`;
};
