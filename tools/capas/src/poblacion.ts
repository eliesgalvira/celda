import type { Coordenada } from "@celda/dominio/area";
import type { Anillo, LimitesDeBarrios, Poligono } from "@celda/dominio/barrio";
import { aPlano } from "@celda/dominio/plano";
import { areaKm2, type FuenteDePoblacion, type PoblacionDeBarrios } from "@celda/dominio/poblacion";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Habitantes por barrio del padrón municipal de Open Data BCN: el conjunto «Població de
 * Barcelona segons el Padró Municipal d'Habitants» (`pad_mdbas`), con licencia CC BY 4.0. Hay un
 * CSV por año, a 1 de enero, con los habitantes de cada sección censal; aquí se suman por barrio.
 */
export const CONJUNTO_PADRON = "pad_mdbas";
export const ENLACE_PADRON = `https://opendata-ajuntament.barcelona.cat/data/es/dataset/${CONJUNTO_PADRON}`;

/** Nombre del CSV de un año: `2026_pad_mdbas.csv`. */
export const RECURSO_PADRON = /^(\d{4})_pad_mdbas\.csv$/u;

/** El CSV del padrón no es el que se esperaba. */
export class PadronIlegible extends Schema.TaggedError<PadronIlegible>()("PadronIlegible", {
  motivo: Schema.String,
}) {}

/** Las filas de un CSV con comillas dobles, como lo escribe el portal. */
export const leerCsv = (texto: string): ReadonlyArray<ReadonlyArray<string>> => {
  const filas: Array<Array<string>> = [];
  let fila: Array<string> = [];
  let campo = "";
  let entreComillas = false;
  const limpio = texto.replace(/^﻿/u, "");
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i += 1;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((valor) => valor !== ""));
};

/** Tolerancia de la simplificación del límite: se dibuja a escala de barrio, no de calle. */
const TOLERANCIA_METROS = 6;

/** Cinco decimales: algo más de un metro. */
const redondear = (grados: number): number => Math.round(grados * 1e5) / 1e5;

/** Distancia de `p` al segmento de `a` a `b`, en el plano local. */
const distanciaAlSegmento = (
  p: { este: number; norte: number },
  a: { este: number; norte: number },
  b: { este: number; norte: number },
): number => {
  const dx = b.este - a.este;
  const dy = b.norte - a.norte;
  const largo = dx * dx + dy * dy;
  const t =
    largo === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.este - a.este) * dx + (p.norte - a.norte) * dy) / largo));
  return Math.hypot(p.este - (a.este + t * dx), p.norte - (a.norte + t * dy));
};

/** Douglas-Peucker sobre un anillo, sin bajar de cuatro vértices. */
const simplificarAnillo = (anillo: Anillo): Anillo => {
  if (anillo.length <= 4) return anillo;
  const [x = 0, y = 0] = anillo[0] ?? [];
  const origen: Coordenada = { longitud: x, latitud: y };
  const plano = anillo.map(([lon, lat]) => aPlano(origen, { longitud: lon, latitud: lat }));
  const guardar = Array.from({ length: anillo.length }, () => false);
  guardar[0] = true;
  guardar[anillo.length - 1] = true;
  // El anillo se parte por el vértice más lejano al primero, para no degenerar en un segmento.
  // El primer vértice es el origen del plano: su distancia a otro es la norma de este.
  const lejos = plano.map((p) => Math.hypot(p.este, p.norte));
  const lejano = Math.max(1, lejos.indexOf(Math.max(...lejos)));
  guardar[lejano] = true;
  const pila: Array<readonly [number, number]> = [
    [0, lejano],
    [lejano, anillo.length - 1],
  ];
  while (pila.length > 0) {
    const [desde, hasta] = pila.pop() ?? [0, 0];
    const a = plano[desde];
    const b = plano[hasta];
    if (a === undefined || b === undefined) continue;
    let peor = -1;
    let distancia = 0;
    for (let k = desde + 1; k < hasta; k++) {
      const p = plano[k];
      if (p === undefined) continue;
      const d = distanciaAlSegmento(p, a, b);
      if (d > distancia) {
        distancia = d;
        peor = k;
      }
    }
    if (peor !== -1 && distancia > TOLERANCIA_METROS) {
      guardar[peor] = true;
      pila.push([desde, peor], [peor, hasta]);
    }
  }
  const quedan = anillo.filter((_, k) => guardar[k]);
  return quedan.length >= 4
    ? quedan.map(([lon, lat]) => [redondear(lon), redondear(lat)] as const)
    : anillo;
};

const simplificar = (poligonos: ReadonlyArray<Poligono>): ReadonlyArray<Poligono> =>
  poligonos.map((poligono) => poligono.map(simplificarAnillo));

const COLUMNAS = ["Codi_Barri", "Nom_Barri", "Valor", "Data_Referencia"] as const;

/**
 * Los habitantes de cada barrio a partir del CSV del padrón, con el área y el límite
 * simplificado de `limites`. Falla con `PadronIlegible` si faltan columnas, si un valor no es un
 * número, si el CSV mezcla fechas o si sus barrios no son los de los límites: mejor no publicar
 * que publicar un barrio sin habitantes.
 */
export const poblacionDeOpenData = (
  csv: string,
  limites: LimitesDeBarrios,
  fuente: Omit<FuenteDePoblacion, "referencia">,
): Result.Result<PoblacionDeBarrios, PadronIlegible> => {
  const ilegible = (motivo: string) => Result.fail(new PadronIlegible({ motivo }));
  const [cabecera, ...filas] = leerCsv(csv);
  const posicion = Object.fromEntries(
    COLUMNAS.map((columna) => [columna, cabecera?.indexOf(columna) ?? -1]),
  );
  const falta = COLUMNAS.find((columna) => (posicion[columna] ?? -1) < 0);
  if (falta !== undefined) return ilegible(`falta la columna ${falta}`);

  const habitantes = new Map<string, number>();
  const fechas = new Set<string>();
  for (const [i, fila] of filas.entries()) {
    const codigo = (fila[posicion["Codi_Barri"] ?? 0] ?? "").padStart(2, "0");
    const valor = fila[posicion["Valor"] ?? 0] ?? "";
    if (!/^\d+$/u.test(valor)) return ilegible(`la fila ${i + 2} no trae un número: «${valor}»`);
    fechas.add(fila[posicion["Data_Referencia"] ?? 0] ?? "");
    habitantes.set(codigo, (habitantes.get(codigo) ?? 0) + Number(valor));
  }
  const [referencia, ...otras] = [...fechas];
  if (referencia === undefined || otras.length > 0 || !/^\d{4}-\d{2}-\d{2}$/u.test(referencia)) {
    return ilegible(`fechas de referencia inesperadas: ${[...fechas].join(", ")}`);
  }
  const conocidos = new Set(limites.barrios.map((b) => b.codigo));
  const sobra = [...habitantes.keys()].find((codigo) => !conocidos.has(codigo));
  if (sobra !== undefined) return ilegible(`el barrio ${sobra} no está en los límites`);
  const sinHabitantes = limites.barrios.find((b) => !habitantes.has(b.codigo));
  if (sinHabitantes !== undefined) {
    return ilegible(
      `el barrio ${sinHabitantes.codigo} ${sinHabitantes.nombre} no tiene habitantes`,
    );
  }

  return Result.succeed({
    fuente: { ...fuente, referencia },
    fuenteDeLimites: limites.fuente,
    barrios: limites.barrios
      .map((barrio) => ({
        codigo: barrio.codigo,
        nombre: barrio.nombre,
        habitantes: habitantes.get(barrio.codigo) ?? 0,
        areaKm2: Math.round(areaKm2(barrio.poligonos) * 1e4) / 1e4,
        poligonos: simplificar(barrio.poligonos),
      }))
      .toSorted((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0)),
  });
};

/** El fichero que lee la web: JSON con un barrio por línea, para que un diff se lea bien. */
export const ficheroDePoblacion = (poblacion: PoblacionDeBarrios): string => {
  const barrios = poblacion.barrios.map((barrio) => JSON.stringify(barrio));
  return (
    `{"fuente":${JSON.stringify(poblacion.fuente)},` +
    `"fuenteDeLimites":${JSON.stringify(poblacion.fuenteDeLimites)},"barrios":[\n` +
    `${barrios.join(",\n")}\n]}\n`
  );
};
