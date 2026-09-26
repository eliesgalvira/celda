import type { Ficha } from "@celda/dominio/ficha";

/**
 * Fichas de prueba con correcciones de la comunidad, como las deja la ingesta con las muestras
 * grabadas de antenasmoviles.es (`convex/test/antenasmoviles.test.ts`).
 */

/** 04:15 en Barcelona: la ingesta del registro oficial. */
const REGISTRO = Date.UTC(2026, 8, 26, 2, 15);
/** Un día después, la de antenasmoviles.es. */
const COMUNIDAD = Date.UTC(2026, 8, 27, 3, 15);
const GEOPORTAL = "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=";

/** Campus Nord con la estación de Vodafone dada por desmontada en antenasmoviles.es. */
export const FICHA_CORREGIDA: Ficha = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "corregido",
  confianza: "baja",
  conflictos: [
    {
      tipo: "desmontada",
      compania: "vodafone",
      procedencia: { fuente: "antenasmoviles", clave: "vodafone - 086040" },
      fecha: COMUNIDAD,
    },
  ],
  estaciones: [
    {
      compania: "movistar",
      codigos: ["0802532"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: `${GEOPORTAL}0802532`,
          fecha: REGISTRO,
          afirma: "presente",
        },
      ],
    },
    {
      compania: "vodafone",
      codigos: ["086040", "86040"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "VODAFONE ESPAÑA, S.A.U. - 086040",
          url: `${GEOPORTAL}086040`,
          fecha: REGISTRO,
          afirma: "presente",
        },
        {
          fuente: "antenasmoviles",
          clave: "vodafone - 086040",
          url: "https://antenasmoviles.es/#19/41.388342/2.113628",
          fecha: COMUNIDAD,
          afirma: "desmontada",
        },
      ],
    },
  ],
  datosDel: COMUNIDAD,
  version: COMUNIDAD,
};

/** Una ER5 de Movistar que el registro oficial no tiene. */
export const FICHA_NUEVA: Ficha = {
  clave: "movistar-MV-BCN-82383",
  posicion: { longitud: 2.14306, latitud: 41.37958 },
  direccion: "Carrer de Tarragona, 177, Sants-Montjuïc, 08014 Barcelona",
  municipio: "BARCELONA",
  estado: "nuevo",
  confianza: "media",
  conflictos: [],
  estaciones: [
    {
      compania: "movistar",
      codigos: ["MV-BCN-82383"],
      bandas: [],
      origenes: [
        {
          fuente: "antenasmoviles",
          clave: "movistar - MV-BCN-82383",
          url: "https://antenasmoviles.es/#19/41.379580/2.143060",
          fecha: COMUNIDAD,
          afirma: "presente",
        },
      ],
    },
  ],
  datosDel: COMUNIDAD,
  version: COMUNIDAD,
};

/** Urquinaona: Movistar en el registro y una ER5 de Orange a 7 m. */
export const FICHA_COMPANIA_ANADIDA: Ficha = {
  ...FICHA_NUEVA,
  clave: "movistar-0800542",
  posicion: { longitud: 2.173606, latitud: 41.389709 },
  direccion: "PZ DURQUINAONA, 7. BARCELONA, BARCELONA",
  estado: "corregido",
  confianza: "alta",
  estaciones: [
    {
      compania: "movistar",
      codigos: ["0800542"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800542",
          url: `${GEOPORTAL}0800542`,
          fecha: REGISTRO,
          afirma: "presente",
        },
      ],
    },
    {
      compania: "orange",
      codigos: ["CATR6031A"],
      bandas: [],
      origenes: [
        {
          fuente: "antenasmoviles",
          clave: "orange - CATR6031A",
          url: "https://antenasmoviles.es/#19/41.389648/2.173639",
          fecha: COMUNIDAD,
          afirma: "presente",
        },
      ],
    },
  ],
};
