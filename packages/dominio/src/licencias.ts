import * as Schema from "effect/Schema";

/**
 * Las licencias de lo que Celda publica (ADR 0021): los datos propios y las aportaciones son
 * CC0 1.0, y los de terceros conservan sus condiciones y su crédito.
 */

/** La dedicación de los datos propios de Celda y de las aportaciones. */
export const DEDICACION_CC0 = {
  nombre: "CC0 1.0 Universal",
  identificador: "CC0-1.0",
  enlace: "https://creativecommons.org/publicdomain/zero/1.0/deed.es",
} as const;

/** Los datos de un tercero que lleva lo publicado, con sus condiciones y el crédito que piden. */
export const DatosDeTercero = Schema.Struct({
  datos: Schema.String,
  condiciones: Schema.String,
  credito: Schema.String,
  enlace: Schema.String,
});
export type DatosDeTercero = typeof DatosDeTercero.Type;

/** Qué parte de lo publicado es CC0 y de quién es el resto. */
export const Licencias = Schema.Struct({
  propios: Schema.Struct({
    licencia: Schema.Literal(DEDICACION_CC0.identificador),
    enlace: Schema.String,
    /** Qué datos son propios de Celda. */
    alcance: Schema.String,
  }),
  terceros: Schema.Array(DatosDeTercero),
});
export type Licencias = typeof Licencias.Type;

/** La tabla del ADR 0021, tal como la lleva lo publicado. */
export const LICENCIAS: Licencias = {
  propios: {
    licencia: DEDICACION_CC0.identificador,
    enlace: DEDICACION_CC0.enlace,
    alcance:
      "Las correcciones aceptadas, las corroboraciones, los agregados de medidas y lo que Celda calcula sobre los datos de otros: el estado, la confianza, las zonas y las simulaciones.",
  },
  terceros: [
    {
      datos: "Registro oficial de estaciones (Infoantenas)",
      condiciones:
        "Ley 37/2007 y condiciones generales de reutilización del Ministerio: citar la fuente, no desnaturalizar los datos, dar la fecha y no sugerir que el Ministerio apoya este uso.",
      credito:
        "Origen de los datos: Ministerio para la Transformación Digital y de la Función Pública (Infoantenas)",
      enlace: "https://geoportal.minetur.gob.es/VCTEL/vcne.do",
    },
    {
      datos: "Límites de provincias y municipios del IGN",
      condiciones: "CC BY 4.0",
      credito: "Obra derivada de las líneas límite del IGN (scne.es)",
      enlace: "https://www.scne.es/",
    },
    {
      datos: "Padrón del INE",
      condiciones: "CC BY 4.0",
      credito: "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es",
      enlace: "https://www.ine.es/",
    },
    {
      datos: "Barrios de Barcelona (Open Data BCN)",
      condiciones: "CC BY 4.0",
      credito: "Ajuntament de Barcelona",
      enlace: "https://opendata-ajuntament.barcelona.cat/",
    },
    {
      datos: "Mapa base y búsqueda de direcciones",
      condiciones: "ODbL",
      credito: "© OpenStreetMap",
      enlace: "https://www.openstreetmap.org/copyright",
    },
    {
      datos: "Ortofoto PNOA del IGN, en la foto aérea",
      condiciones: "CC BY 4.0",
      credito: "PNOA · CC BY 4.0 scne.es",
      enlace: "https://www.scne.es/",
    },
  ],
};
