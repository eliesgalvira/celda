import type { Ficha } from "@celda/dominio/ficha";

/**
 * Fichas de prueba con correcciones de la comunidad, con la forma que les da la fusión (ADR 0012).
 * Cómo llega una corrección aceptada a la ficha lo decide el buzón (#56); el enlace es de prueba.
 */

/** 04:15 en Barcelona: la ingesta del registro oficial. */
const REGISTRO = Date.UTC(2026, 8, 26, 2, 15);
/** Un día después, la corrección de la comunidad. */
const COMUNIDAD = Date.UTC(2026, 8, 27, 3, 15);
const GEOPORTAL = "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=";
const CORRECCION = "https://comunidad.example/correccion/";

/** Campus Nord con la estación de Vodafone dada por desmontada por la comunidad. */
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
      procedencia: { fuente: "comunidad", clave: "vodafone - 086040" },
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
          fuente: "comunidad",
          clave: "vodafone - 086040",
          url: `${CORRECCION}1`,
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
          fuente: "comunidad",
          clave: "movistar - MV-BCN-82383",
          url: `${CORRECCION}2`,
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
          fuente: "comunidad",
          clave: "orange - CATR6031A",
          url: `${CORRECCION}3`,
          fecha: COMUNIDAD,
          afirma: "presente",
        },
      ],
    },
  ],
};

/** 3 oct 2026: la moderación acepta las correcciones de la comunidad (ADR 0020). */
const ACEPTADA = Date.UTC(2026, 9, 3, 9, 0);

/**
 * Campus Nord con correcciones aceptadas en el buzón, con el formato que les da la publicación:
 * dos personas sitúan el emplazamiento 120 m al este y una dice que Vodafone ya no está. El
 * registro sigue diciendo lo suyo.
 */
export const FICHA_CON_CORRECCIONES_ACEPTADAS: Ficha = {
  ...FICHA_CORREGIDA,
  conflictos: [],
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
      codigos: ["086040"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "VODAFONE ESPAÑA, S.A.U. - 086040",
          url: `${GEOPORTAL}086040`,
          fecha: REGISTRO,
          afirma: "presente",
        },
      ],
    },
  ],
  correcciones: [
    {
      clave: "5d8a7c4e-1b2f-4a3c-9e8d-7f6a5b4c3d2e",
      cambio: { tipo: "posicion", posicion: { longitud: 2.115068, latitud: 41.388344 } },
      personas: 2,
      aceptadaEl: ACEPTADA,
      licencia: "CC0-1.0",
    },
    {
      clave: "6e9b8d5f-2c3a-4b4d-8f9e-8a7b6c5d4e3f",
      cambio: { tipo: "compania", compania: "vodafone", esta: false },
      personas: 1,
      aceptadaEl: ACEPTADA,
      licencia: "CC0-1.0",
    },
  ],
};
