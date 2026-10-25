/**
 * Publicaciones de prueba para la API: los ficheros de `/capas` de una versión, escritos con los
 * mismos generadores que la publicación de verdad, con los emplazamientos que se le den por
 * provincia.
 */
import { cajaDe } from "@celda/dominio/area";
import { codificarVigente, type EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import type { Ficha } from "@celda/dominio/ficha";
import type { MunicipioConHabitantes } from "@celda/dominio/municipio";
import {
  combinacionesDeSituados,
  companiasDeSituados,
  type EmplazamientoSituado,
  generarCapaDeProvincia,
  generarLoteDeProvincia,
  generarResumen,
} from "@celda/dominio/provincias";
import { generarPuntos } from "@celda/dominio/puntos";

import { FUENTE_DE_BARRIOS, FUENTE_DE_MUNICIPIOS, FUENTES_DE_PRUEBA } from "../capa/pruebas.ts";

export interface EmplazamientoDePrueba {
  readonly clave: string;
  readonly longitud: number;
  readonly latitud: number;
  readonly companias: ReadonlyArray<Compania>;
}

export interface ProvinciaDePrueba {
  readonly codigo: string;
  readonly nombre: string;
  /** El municipio en que caen todos sus emplazamientos. */
  readonly municipio: { readonly codigo: string; readonly nombre: string };
  readonly emplazamientos: ReadonlyArray<EmplazamientoDePrueba>;
}

const ficha = (e: EmplazamientoDePrueba, fecha: number): Ficha => ({
  clave: e.clave,
  posicion: { longitud: e.longitud, latitud: e.latitud },
  direccion: "CL MAYOR, 1",
  municipio: "PRUEBA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: fecha,
  version: fecha,
});

/**
 * Los ficheros de una versión por su ruta bajo `/capas`, con `vigente.json` apuntando a ella. Cada
 * provincia lleva su capa y un solo lote de fichas, en `provincias/<código>/<sello>.json` y
 * `fichas/<código>/<sello>.json`, con el sello de la versión en lugar de la huella.
 */
export const publicacionDePrueba = (
  version: string,
  fecha: number,
  provincias: ReadonlyArray<ProvinciaDePrueba>,
): ReadonlyMap<string, string> => {
  const sello = version.replace(/\W/gu, "");
  const ficheros = new Map<string, string>();
  const porProvincia = new Map<string, ReadonlyArray<EmplazamientoSituado>>();
  const filas = provincias.map((provincia) => {
    const situados = provincia.emplazamientos
      .map((e): EmplazamientoSituado => {
        const emplazamiento: EmplazamientoDeCapa = {
          clave: e.clave,
          posicion: { longitud: e.longitud, latitud: e.latitud },
          estado: "verificado",
          companias: e.companias,
        };
        return {
          emplazamiento,
          provincia: provincia.codigo,
          municipio: provincia.municipio.codigo,
          lugar: { municipio: null, provincia: null },
        };
      })
      .toSorted((a, b) => (a.emplazamiento.clave < b.emplazamiento.clave ? -1 : 1));
    porProvincia.set(provincia.codigo, situados);
    const lote = `fichas/${provincia.codigo}/${sello}.json`;
    ficheros.set(
      lote,
      generarLoteDeProvincia(
        provincia.codigo,
        provincia.emplazamientos.map((e) => ficha(e, fecha)),
        new Map(),
        FUENTE_DE_MUNICIPIOS,
      ),
    );
    const posiciones = situados.map((s) => s.emplazamiento.posicion);
    const etiqueta = posiciones[0] ?? { longitud: 0, latitud: 0 };
    const municipio: MunicipioConHabitantes = {
      ...provincia.municipio,
      provincia: provincia.codigo,
      etiqueta,
      capital: null,
      areaKm2: 10,
      habitantes: 1000,
    };
    const capa = `provincias/${provincia.codigo}/${sello}.json`;
    ficheros.set(
      capa,
      generarCapaDeProvincia({
        provincia: provincia.codigo,
        situados,
        barrios: { fuente: FUENTE_DE_BARRIOS, barrios: [] },
        municipios: [municipio],
        lotes: [{ fichero: lote, claves: situados.map((s) => s.emplazamiento.clave) }],
      }),
    );
    return {
      codigo: provincia.codigo,
      nombre: provincia.nombre,
      etiqueta,
      caja: cajaDe(posiciones),
      emplazamientos: situados.length,
      companias: companiasDeSituados(situados),
      fichero: capa,
      combinaciones: combinacionesDeSituados(situados),
    };
  });
  const puntos = `puntos/${sello}.json`;
  ficheros.set(puntos, generarPuntos(porProvincia));
  const resumen = `resumen@${sello}.json`;
  ficheros.set(
    resumen,
    generarResumen({
      version,
      fuentes: FUENTES_DE_PRUEBA,
      cobertura: [],
      provincias: filas,
      cuadros: new Map(),
      puntos,
    }),
  );
  ficheros.set(
    "vigente.json",
    codificarVigente({
      version,
      fecha,
      emplazamientos: filas.reduce((suma, p) => suma + p.emplazamientos, 0),
      lotes: provincias.length,
      resumen,
    }),
  );
  return ficheros;
};
