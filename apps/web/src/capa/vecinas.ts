import { type Coordenada, RADIO_TIERRA_METROS, type Rectangulo } from "@celda/dominio/area";
import { seCortan } from "@celda/dominio/cobertura";
import type { ResumenLeido } from "@celda/dominio/provincias";

import type { ProvinciaNombrada } from "./estado.ts";
import type { EstadoProvincia, ProvinciaCargada } from "./nacional.ts";

/**
 * Las provincias vecinas que necesitan las celdas y la vista de interferencia (#45). El mapa pide
 * las provincias que se ven, pero una celda o la interferencia junto al borde de una provincia
 * dependen también de los emplazamientos del otro lado. Con las provincias que hacen falta
 * cargadas, el resultado es el mismo que con todas en una sola capa; mientras falta alguna, la
 * interfaz lo dice en vez de dibujar algo incompleto.
 */

const METROS_POR_GRADO = (RADIO_TIERRA_METROS * Math.PI) / 180;

/**
 * Un rectángulo ampliado `metros` por cada lado. Con la latitud más alejada del ecuador de los
 * dos bordes, así que en longitud amplía de más, nunca de menos.
 */
export const ampliarRectangulo = (rectangulo: Rectangulo, metros: number): Rectangulo => {
  const latitud = Math.max(
    Math.abs(rectangulo.suroeste.latitud),
    Math.abs(rectangulo.noreste.latitud),
  );
  const dy = metros / METROS_POR_GRADO;
  const dx = metros / (METROS_POR_GRADO * Math.max(Math.cos((latitud * Math.PI) / 180), 0.01));
  return {
    suroeste: {
      longitud: rectangulo.suroeste.longitud - dx,
      latitud: rectangulo.suroeste.latitud - dy,
    },
    noreste: {
      longitud: rectangulo.noreste.longitud + dx,
      latitud: rectangulo.noreste.latitud + dy,
    },
  };
};

/** Un punto como rectángulo sin área. */
export const rectanguloDePunto = (punto: Coordenada): Rectangulo => ({
  suroeste: punto,
  noreste: punto,
});

/**
 * Las provincias con capa cuya caja de emplazamientos queda a `metros` o menos de alguna de
 * `zonas`, por código.
 */
export const provinciasCerca = (
  resumen: ResumenLeido,
  zonas: ReadonlyArray<Rectangulo>,
  metros: number,
): ReadonlyArray<string> => {
  const ampliadas = zonas.map((zona) => ampliarRectangulo(zona, metros));
  return resumen.provincias.flatMap((p) => {
    const caja = p.caja;
    return p.fichero !== undefined &&
      caja !== undefined &&
      ampliadas.some((zona) => seCortan(caja, zona))
      ? [p.codigo]
      : [];
  });
};

/** Cómo van las provincias que hacen falta para calcular algo. */
export type EstadoDeLasVecinas =
  | { readonly tipo: "listas" }
  /** Alguna aún no ha llegado. Una que no se ha pedido todavía también cuenta. */
  | { readonly tipo: "cargando"; readonly provincias: ReadonlyArray<ProvinciaNombrada> }
  /** Alguna no ha llegado y no se volverá a pedir sola. */
  | { readonly tipo: "fallo"; readonly provincias: ReadonlyArray<ProvinciaNombrada> };

export const VECINAS_LISTAS: EstadoDeLasVecinas = { tipo: "listas" };

/** Cómo van `necesarias`: si alguna ha fallado, las fallidas; si no, las que faltan. */
export const estadoDeLasVecinas = (
  resumen: ResumenLeido,
  provincias: ReadonlyMap<string, EstadoProvincia>,
  necesarias: ReadonlyArray<string>,
): EstadoDeLasVecinas => {
  const nombradas = (tipo: "fallo" | "cargando") =>
    resumen.provincias
      .filter((p) => {
        if (!necesarias.includes(p.codigo)) return false;
        const estado = provincias.get(p.codigo)?.tipo ?? "cargando";
        return estado === tipo;
      })
      .map((p) => ({ codigo: p.codigo, nombre: p.nombre }));
  const fallidas = nombradas("fallo");
  if (fallidas.length > 0) return { tipo: "fallo", provincias: fallidas };
  const cargando = nombradas("cargando");
  return cargando.length > 0 ? { tipo: "cargando", provincias: cargando } : VECINAS_LISTAS;
};

/** Si dos estados dicen lo mismo de las mismas provincias. */
export const mismasVecinas = (a: EstadoDeLasVecinas, b: EstadoDeLasVecinas): boolean =>
  a.tipo === b.tipo &&
  (a.tipo === "listas" ||
    b.tipo === "listas" ||
    (a.provincias.length === b.provincias.length &&
      a.provincias.every((p, i) => p.codigo === b.provincias[i]?.codigo)));

/** Las provincias de `codigos` que ya han llegado, en el orden de `codigos`. */
export const cargadasDe = (
  provincias: ReadonlyMap<string, EstadoProvincia>,
  codigos: ReadonlyArray<string>,
): ReadonlyArray<ProvinciaCargada> =>
  codigos.flatMap((codigo) => {
    const estado = provincias.get(codigo);
    return estado?.tipo === "lista" ? [estado.provincia] : [];
  });

/** «Barcelona», «Barcelona y Girona», «Barcelona, Girona y Lleida». */
export const enumerar = (nombres: ReadonlyArray<string>): string =>
  nombres.length <= 1
    ? (nombres[0] ?? "")
    : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1) ?? ""}`;
