import type { Coordenada } from "@celda/dominio/area";
import { dentroDelPoligono, type Poligono } from "@celda/dominio/barrio";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type { ProvinciaConVecinas } from "@celda/dominio/ejercicio";
import { type IndiceDeMunicipios, municipioDelPunto } from "@celda/dominio/municipio";
import { nombreDeLugarDeMunicipio } from "@celda/dominio/nombreDeLugar";
import type { PoblacionDeBarrios } from "@celda/dominio/poblacion";
import type { ProvinciaDelResumen, ResumenLeido } from "@celda/dominio/provincias";
import {
  type IndiceDeZonas,
  municipiosDelIndice,
  MUNICIPIO_DE_BARCELONA,
  PROVINCIA_DE_BARCELONA,
  provinciaDeZona,
  provinciasDelPunto,
  zonaCubierta,
  type ZonaDelEjercicio,
  type ZonaNombrada,
} from "@celda/dominio/zonaDelEjercicio";

import type { EstadoProvincia, ProvinciaCargada } from "../capa/nacional.ts";
import type { OrigenDeLaZona } from "./tabla.ts";
import { poligonosDelMunicipio } from "./zona.ts";

/**
 * Qué sabe el ejercicio de la zona elegida, a partir de lo que ha llegado: el índice de zonas, los
 * habitantes por barrio, el resumen nacional, la capa de su provincia y sus contornos. Todo son
 * funciones puras; el panel solo junta lo que llega y lo enseña.
 */

/** Cómo va algo que el ejercicio descarga. */
export type Descarga<A> =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "lista"; readonly datos: A }
  | { readonly tipo: "fallo" };

/** Una zona con todo lo que hace falta para el ejercicio. */
export interface ZonaResuelta {
  readonly zona: ZonaDelEjercicio;
  readonly nombre: string;
  /** Cómo se lee en el título y en la tabla: «Pedralbes» o «Tordera (Barcelona)». */
  readonly titulo: string;
  readonly provincia: { readonly codigo: string; readonly nombre: string };
  /** `null` si el padrón aún no la tiene. */
  readonly habitantes: number | null;
  readonly areaKm2: number;
  readonly poligonos: ReadonlyArray<Poligono>;
  readonly origen: OrigenDeLaZona;
  /** Si Celda tiene todos los emplazamientos de la zona o solo los de una parte. */
  readonly cubierta: boolean;
}

/** Lo que el ejercicio puede decir de la zona elegida. */
export type EstadoDeLaZona =
  /** Aún no se ha elegido ninguna, o la de la URL no existe. */
  | { readonly tipo: "sin-zona" }
  /** Falta algo por llegar. */
  | { readonly tipo: "cargando"; readonly nombre: string | undefined }
  /** Celda aún no tiene emplazamientos de su provincia. */
  | { readonly tipo: "sin-datos"; readonly nombre: string; readonly provincia: string }
  /** Algo no ha llegado: la capa de su provincia o sus contornos. */
  | {
      readonly tipo: "fallo";
      readonly nombre: string | undefined;
      readonly que: "capa" | "contornos" | "zonas";
    }
  | { readonly tipo: "lista"; readonly zona: ZonaResuelta };

/** Lo que ha llegado para resolver la zona. */
export interface DatosDeLaZona {
  readonly indice: Descarga<IndiceDeZonas>;
  readonly poblacion: Descarga<PoblacionDeBarrios>;
  readonly resumen: ResumenLeido | undefined;
  /** La capa de su provincia, si se ha pedido. */
  readonly capa: EstadoProvincia | undefined;
  /** Los contornos de su provincia, si se han pedido. */
  readonly contornos: Descarga<IndiceDeMunicipios> | undefined;
}

/**
 * El nombre de lugar de un municipio del índice, que guarda el oficial: «Elx», no «Elx/Elche»
 * (ADR 0025).
 */
export const nombreDeMunicipio = (indice: IndiceDeZonas, codigo: string): string | undefined => {
  const oficial = indice.municipios.find(([otro]) => otro === codigo)?.[1];
  return oficial === undefined ? undefined : nombreDeLugarDeMunicipio(codigo, oficial);
};

/** El nombre de una zona, si ya ha llegado lo que lo dice. */
export const nombreDeZona = (
  zona: ZonaDelEjercicio,
  datos: Pick<DatosDeLaZona, "indice" | "poblacion">,
): string | undefined => {
  if (zona.tipo === "barrio") {
    return datos.poblacion.tipo === "lista"
      ? datos.poblacion.datos.barrios.find((b) => b.codigo === zona.codigo)?.nombre
      : undefined;
  }
  return datos.indice.tipo === "lista"
    ? nombreDeMunicipio(datos.indice.datos, zona.codigo)
    : undefined;
};

const barrioResuelto = (
  zona: ZonaDelEjercicio,
  poblacion: PoblacionDeBarrios,
  resumen: ResumenLeido,
): ZonaResuelta | undefined => {
  const barrio = poblacion.barrios.find((b) => b.codigo === zona.codigo);
  if (barrio === undefined) return undefined;
  return {
    zona,
    nombre: barrio.nombre,
    titulo: barrio.nombre,
    provincia: { codigo: PROVINCIA_DE_BARCELONA, nombre: "Barcelona" },
    habitantes: barrio.habitantes,
    areaKm2: barrio.areaKm2,
    poligonos: barrio.poligonos,
    origen: { tipo: "barrio", limites: poblacion.fuenteDeLimites, poblacion: poblacion.fuente },
    cubierta: zonaCubierta(barrio.poligonos, resumen.cobertura),
  };
};

const municipioResuelto = (
  zona: ZonaDelEjercicio,
  nombre: string,
  capa: ProvinciaCargada,
  contornos: IndiceDeMunicipios,
  resumen: ResumenLeido,
  provincia: ProvinciaDelResumen,
): ZonaResuelta | undefined => {
  const municipio = capa.capa.municipios.find((m) => m.codigo === zona.codigo);
  const poligonos = poligonosDelMunicipio(contornos, zona.codigo);
  if (municipio === undefined || poligonos === undefined) return undefined;
  return {
    zona,
    nombre,
    titulo: nombre === provincia.nombre ? nombre : `${nombre} (${provincia.nombre})`,
    provincia: { codigo: provincia.codigo, nombre: provincia.nombre },
    habitantes: municipio.habitantes,
    areaKm2: municipio.areaKm2,
    poligonos,
    origen: {
      tipo: "municipio",
      codigo: zona.codigo,
      limites: resumen.fuentes.municipios,
      poblacion: resumen.fuentes.padron,
    },
    cubierta: provincia.cubierta || zonaCubierta(poligonos, resumen.cobertura),
  };
};

/** Con la zona y su provincia conocidas, lo que aún falta o ha fallado, o la zona resuelta. */
const conSuProvincia = (
  zona: ZonaDelEjercicio,
  nombre: string,
  datos: DatosDeLaZona,
  resumen: ResumenLeido,
  provincia: ProvinciaDelResumen,
): EstadoDeLaZona => {
  if (datos.capa?.tipo === "fallo") return { tipo: "fallo", nombre, que: "capa" };
  if (datos.contornos?.tipo === "fallo") return { tipo: "fallo", nombre, que: "contornos" };
  if (datos.capa?.tipo !== "lista") return { tipo: "cargando", nombre };
  if (zona.tipo === "barrio") {
    if (datos.poblacion.tipo !== "lista") return { tipo: "cargando", nombre };
    const resuelta = barrioResuelto(zona, datos.poblacion.datos, resumen);
    return resuelta === undefined ? { tipo: "sin-zona" } : { tipo: "lista", zona: resuelta };
  }
  if (datos.contornos?.tipo !== "lista") return { tipo: "cargando", nombre };
  const resuelta = municipioResuelto(
    zona,
    nombre,
    datos.capa.provincia,
    datos.contornos.datos,
    resumen,
    provincia,
  );
  return resuelta === undefined ? { tipo: "sin-zona" } : { tipo: "lista", zona: resuelta };
};

/**
 * Qué se sabe de la zona elegida. Un barrio necesita los habitantes por barrio y la capa de
 * Barcelona. Un municipio necesita el índice para su nombre, el resumen para saber si su provincia
 * tiene capa, la capa, con sus habitantes y su área, y los contornos, para dibujarlo y saber si
 * está entero en lo barrido.
 */
export const estadoDeLaZona = (
  zona: ZonaDelEjercicio | undefined,
  datos: DatosDeLaZona,
): EstadoDeLaZona => {
  if (zona === undefined) return { tipo: "sin-zona" };
  const nombre = nombreDeZona(zona, datos);
  const nombres = zona.tipo === "barrio" ? datos.poblacion.tipo : datos.indice.tipo;
  if (nombres === "fallo") return { tipo: "fallo", nombre, que: "zonas" };
  if (nombres === "lista" && nombre === undefined) return { tipo: "sin-zona" };
  const { resumen } = datos;
  if (resumen === undefined || nombre === undefined) return { tipo: "cargando", nombre };
  const codigo = provinciaDeZona(zona);
  const provincia = resumen.provincias.find((p) => p.codigo === codigo);
  if (provincia?.fichero === undefined) {
    return { tipo: "sin-datos", nombre, provincia: provincia?.nombre ?? codigo };
  }
  return conSuProvincia(zona, nombre, datos, resumen, provincia);
};

/** Los emplazamientos de las provincias cargadas que caen en la zona. */
export const emplazamientosDeLaZona = (
  zona: ZonaDelEjercicio,
  emplazamientos: ReadonlyArray<EmplazamientoLeido>,
): ReadonlyArray<EmplazamientoLeido> =>
  zona.tipo === "barrio"
    ? emplazamientos.filter(
        (e) => e.barrio === zona.codigo && e.provincia === PROVINCIA_DE_BARCELONA,
      )
    : emplazamientos.filter((e) => e.municipio === zona.codigo);

/** Las provincias del resumen como las necesita la búsqueda de vecinas. */
export const provinciasConVecinas = (resumen: ResumenLeido): ReadonlyArray<ProvinciaConVecinas> =>
  resumen.provincias.map((p) => ({
    codigo: p.codigo,
    caja: p.caja,
    companias: p.companias,
    cubierta: p.cubierta,
    conCapa: p.fichero !== undefined,
  }));

/** Las zonas en que se puede buscar: todos los municipios y los barrios de Barcelona. */
export const zonasParaBuscar = (
  indice: IndiceDeZonas | undefined,
  poblacion: PoblacionDeBarrios | undefined,
): ReadonlyArray<ZonaNombrada> => [
  ...(indice === undefined ? [] : municipiosDelIndice(indice)),
  ...(poblacion?.barrios ?? []).map((b): ZonaNombrada => ({
    zona: { tipo: "barrio", codigo: b.codigo },
    nombre: b.nombre,
    lugar: "Barrio de Barcelona",
  })),
];

/** Si en la zona se puede elegir entre el municipio de Barcelona entero y sus barrios. */
export const conBarrios = (zona: ZonaDelEjercicio | undefined): boolean =>
  zona !== undefined && (zona.tipo === "barrio" || zona.codigo === MUNICIPIO_DE_BARCELONA);

/** Qué zona hay en un punto del mapa. */
export type ZonaDelPunto =
  /** Faltan los contornos de estas provincias para saberlo. */
  | { readonly tipo: "faltan"; readonly provincias: ReadonlyArray<string> }
  | { readonly tipo: "zona"; readonly zona: ZonaDelEjercicio }
  /** El punto no cae en ningún municipio: en el mar, fuera de España o en un territorio compartido. */
  | { readonly tipo: "ninguna" };

/**
 * La zona de un punto del mapa: el municipio en que cae según los contornos de las provincias
 * cuya caja lo contiene y, en Barcelona, su barrio. Si faltan contornos, dice cuáles.
 */
export const zonaDelPunto = (
  punto: Coordenada,
  indice: IndiceDeZonas,
  contornos: ReadonlyMap<string, Descarga<IndiceDeMunicipios>>,
  poblacion: PoblacionDeBarrios | undefined,
): ZonaDelPunto => {
  const candidatas = provinciasDelPunto(indice, punto);
  const faltan = candidatas.filter((codigo) => contornos.get(codigo)?.tipo !== "lista");
  if (faltan.length > 0) return { tipo: "faltan", provincias: faltan };
  for (const codigo of candidatas) {
    const suyos = contornos.get(codigo);
    if (suyos?.tipo !== "lista") continue;
    const { municipio } = municipioDelPunto(punto, suyos.datos);
    if (municipio === undefined) continue;
    const barrio =
      municipio.codigo === MUNICIPIO_DE_BARCELONA && poblacion !== undefined
        ? poblacion.barrios.find((b) => b.poligonos.some((p) => dentroDelPoligono(punto, p)))
        : undefined;
    return {
      tipo: "zona",
      zona:
        barrio === undefined
          ? { tipo: "municipio", codigo: municipio.codigo }
          : { tipo: "barrio", codigo: barrio.codigo },
    };
  }
  return { tipo: "ninguna" };
};
