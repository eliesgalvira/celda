import { cajaDe, type Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type {
  CapaDeProvincia,
  MunicipioDeCapa,
  ProvinciaDelResumen,
  ResumenLeido,
} from "@celda/dominio/provincias";

import { crearAgrupador } from "./agrupacion.ts";
import {
  agrupadorDeProvincia,
  type EstadoProvincia,
  type ProvinciaCargada,
  prefijoDeProvincia,
} from "./nacional.ts";
import { cajaDeBarcelona, FUENTES_DE_PRUEBA } from "./pruebas.ts";

/** El mundo entero, como caja de una escena. */
export const MUNDO: Rectangulo = {
  suroeste: { longitud: -180, latitud: -85 },
  noreste: { longitud: 180, latitud: 85 },
};

export const NOCHE = Date.UTC(2026, 8, 26, 2, 15);

const en = (
  clave: string,
  provincia: string,
  longitud: number,
  latitud: number,
): EmplazamientoLeido => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: provincia === "08" ? ["movistar"] : ["vodafone"],
  barrio: null,
  lote: 0,
  provincia,
  municipio: null,
});

/**
 * Dos provincias vecinas con emplazamientos a los dos lados de su borde, en 2,5° de longitud:
 * Barcelona al oeste y Girona al este. Lleida no tiene ninguno: está sin cubrir.
 */
export const EMPLAZAMIENTOS_POR_PROVINCIA: ReadonlyMap<
  string,
  ReadonlyArray<EmplazamientoLeido>
> = new Map([
  [
    "08",
    Array.from({ length: 40 }, (_, i) =>
      en(`b${i}`, "08", 2.4 + (i % 10) * 0.0095, 41.9 + Math.floor(i / 10) * 0.01),
    ),
  ],
  [
    "17",
    Array.from({ length: 30 }, (_, i) =>
      en(`g${i}`, "17", 2.5005 + (i % 10) * 0.0095, 41.9 + Math.floor(i / 10) * 0.01),
    ),
  ],
]);

const fila = (
  codigo: string,
  nombre: string,
  etiqueta: { longitud: number; latitud: number },
): ProvinciaDelResumen => {
  const suyos = EMPLAZAMIENTOS_POR_PROVINCIA.get(codigo) ?? [];
  return {
    codigo,
    nombre,
    etiqueta,
    caja: cajaDe(suyos.map((e) => e.posicion)),
    emplazamientos: suyos.length,
    companias: [...new Set(suyos.flatMap((e) => e.companias))],
    cubierta: suyos.length > 0,
    barrido: suyos.length > 0 ? NOCHE : null,
    fichero: suyos.length > 0 ? `provincias/${codigo}/prueba.json` : undefined,
  };
};

export const RESUMEN: ResumenLeido = {
  version: "sitios@2026-09-26T02:15:00Z",
  fecha: NOCHE,
  fuentes: FUENTES_DE_PRUEBA,
  cobertura: [{ ...cajaDeBarcelona(NOCHE), cajas: [[2, 41, 3, 42]] }],
  provincias: [
    fila("08", "Barcelona", { longitud: 2.3, latitud: 41.95 }),
    fila("17", "Girona", { longitud: 2.7, latitud: 41.95 }),
    fila("25", "Lleida", { longitud: 1, latitud: 42 }),
  ],
};

/** Una provincia cargada, con su agrupador hecho en el hilo. */
export const cargada = (codigo: string): ProvinciaCargada => {
  const emplazamientos = EMPLAZAMIENTOS_POR_PROVINCIA.get(codigo) ?? [];
  return {
    codigo,
    version: RESUMEN.version,
    fecha: NOCHE,
    capa: {
      provincia: codigo,
      emplazamientos,
      barrios: [],
      fuenteDeBarrios: undefined,
      municipios: [],
      lotes: [`fichas/${codigo}/prueba.json`],
    },
    agrupador: crearAgrupador(emplazamientos, [], { prefijo: prefijoDeProvincia(codigo) }),
  };
};

export const BARCELONA = cargada("08");
export const GIRONA = cargada("17");

/** Los estados de las provincias pedidas, en el formato que usa la pantalla. */
export const estados = (
  ...pares: ReadonlyArray<readonly [string, EstadoProvincia]>
): ReadonlyMap<string, EstadoProvincia> => new Map(pares);

const municipio = (
  codigo: string,
  nombre: string,
  longitud: number,
  latitud: number,
): MunicipioDeCapa => ({
  codigo,
  nombre,
  etiqueta: { longitud, latitud },
  habitantes: 5000,
  areaKm2: 20,
  emplazamientos: 0,
  companias: [],
});

/**
 * La capa de Barcelona con tres municipios: Oeste con 20 emplazamientos, Este con 15, Pequeño con
 * 3 (menos del umbral de ausencias) y dos sin municipio, como en un territorio compartido.
 */
export const CAPA_CON_MUNICIPIOS: CapaDeProvincia = {
  ...BARCELONA.capa,
  emplazamientos: BARCELONA.capa.emplazamientos.map((e, i) => ({
    ...e,
    municipio: i % 10 < 5 ? "08001" : i < 30 ? "08002" : i % 10 < 8 ? "08003" : null,
  })),
  municipios: [
    municipio("08001", "Oeste", 2.42, 41.915),
    municipio("08002", "Este", 2.47, 41.915),
    municipio("08003", "Pequeño", 2.47, 41.935),
  ],
};

/** El resumen de prueba con Barcelona cubierta o a medias. */
export const resumenConBarcelona = (cubierta: boolean): ResumenLeido => ({
  ...RESUMEN,
  provincias: RESUMEN.provincias.map((p) => (p.codigo === "08" ? { ...p, cubierta } : p)),
});

/** Barcelona con sus municipios, agrupada según su cobertura en `resumen`. */
export const barcelonaConMunicipios = (resumen: ResumenLeido): ProvinciaCargada => ({
  codigo: "08",
  version: resumen.version,
  fecha: NOCHE,
  capa: CAPA_CON_MUNICIPIOS,
  agrupador: agrupadorDeProvincia(CAPA_CON_MUNICIPIOS, resumen),
});
