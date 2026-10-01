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
 * 3 (menos del mínimo de una zona) y dos sin municipio, como en un territorio compartido. Oeste y
 * Este caben en la pantalla en los dos niveles de municipios: son zona en los dos.
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

/**
 * `n` emplazamientos en rejilla dentro de una caja de `ancho` × `alto` grados centrada en
 * `centro`, todos de `municipio` y con el barrio que diga `barrioDe`.
 */
const rejilla = (
  prefijo: string,
  provincia: string,
  n: number,
  centro: { readonly longitud: number; readonly latitud: number },
  [ancho, alto]: readonly [number, number],
  municipio: string | null,
  barrioDe: (longitud: number) => string | null = () => null,
): ReadonlyArray<EmplazamientoLeido> => {
  const columnas = Math.ceil(Math.sqrt(n));
  const filas = Math.ceil(n / columnas);
  return Array.from({ length: n }, (_, i) => {
    const longitud =
      centro.longitud + (columnas === 1 ? 0 : ((i % columnas) / (columnas - 1) - 0.5) * ancho);
    const latitud =
      centro.latitud + (filas === 1 ? 0 : (Math.floor(i / columnas) / (filas - 1) - 0.5) * alto);
    return {
      clave: `${prefijo}${i}`,
      posicion: { longitud, latitud },
      estado: "verificado",
      companias: i % 3 === 0 ? ["movistar", "vodafone"] : i % 3 === 1 ? ["orange"] : ["digi"],
      barrio: barrioDe(longitud),
      lote: 0,
      provincia,
      municipio,
    };
  });
};

const municipioDePrueba = (
  codigo: string,
  nombre: string,
  longitud: number,
  latitud: number,
): MunicipioDeCapa => ({ ...municipio(codigo, nombre, longitud, latitud), habitantes: 10_000 });

/**
 * Una España en pequeño con los casos de las zonas, para recorrer todos los zooms: Zaragoza, una
 * ciudad que no cabe en la pantalla en los niveles de municipios; Utebo, 8 emplazamientos
 * juntos, zona en los dos; Cuarte, 6 en 5 km, zona solo en el 11; Pinseque, con uno; y dos sin
 * municipio. En Barcelona, la ciudad con dos barrios y Badalona, compacta. Lleida no tiene nada.
 */
export const espanaDePrueba = () => {
  const capas: ReadonlyArray<CapaDeProvincia> = [
    {
      provincia: "50",
      emplazamientos: [
        ...rejilla("z", "50", 200, { longitud: -0.89, latitud: 41.65 }, [0.12, 0.07], "50297"),
        ...rejilla("u", "50", 8, { longitud: -1, latitud: 41.71 }, [0.02, 0.012], "50272"),
        ...rejilla("c", "50", 6, { longitud: -0.93, latitud: 41.58 }, [0.06, 0.03], "50089"),
        ...rejilla("p", "50", 1, { longitud: -1.1, latitud: 41.735 }, [0, 0], "50208"),
        ...rejilla("n", "50", 2, { longitud: -1.2, latitud: 41.6 }, [0.01, 0], null),
      ],
      barrios: [],
      fuenteDeBarrios: undefined,
      municipios: [
        municipioDePrueba("50297", "Zaragoza", -0.88, 41.65),
        municipioDePrueba("50272", "Utebo", -1, 41.71),
        municipioDePrueba("50089", "Cuarte de Huerva", -0.93, 41.58),
        municipioDePrueba("50208", "Pinseque", -1.1, 41.735),
      ],
      lotes: ["fichas/50/prueba.json"],
    },
    {
      provincia: "08",
      emplazamientos: [
        ...rejilla("b", "08", 60, { longitud: 2.15, latitud: 41.4 }, [0.1, 0.06], "08019", (lon) =>
          lon < 2.15 ? "10" : "68",
        ),
        ...rejilla("d", "08", 10, { longitud: 2.245, latitud: 41.45 }, [0.016, 0.01], "08015"),
      ],
      barrios: [
        { codigo: "10", nombre: "Sant Antoni", etiqueta: { longitud: 2.125, latitud: 41.4 } },
        { codigo: "68", nombre: "el Poblenou", etiqueta: { longitud: 2.175, latitud: 41.4 } },
      ],
      fuenteDeBarrios: undefined,
      municipios: [
        municipioDePrueba("08019", "Barcelona", 2.15, 41.4),
        municipioDePrueba("08015", "Badalona", 2.245, 41.45),
      ],
      lotes: ["fichas/08/prueba.json"],
    },
  ];
  const filaDe = (
    codigo: string,
    nombre: string,
    etiqueta: { longitud: number; latitud: number },
  ): ProvinciaDelResumen => {
    const suyos = capas.find((c) => c.provincia === codigo)?.emplazamientos ?? [];
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
  const resumen: ResumenLeido = {
    ...RESUMEN,
    provincias: [
      filaDe("08", "Barcelona", { longitud: 2.1, latitud: 41.6 }),
      filaDe("25", "Lleida", { longitud: 1, latitud: 42 }),
      filaDe("50", "Zaragoza", { longitud: -1, latitud: 41.6 }),
    ],
  };
  const provincias = new Map<string, EstadoProvincia>(
    capas.map((capa) => [
      capa.provincia,
      {
        tipo: "lista",
        provincia: {
          codigo: capa.provincia,
          version: resumen.version,
          fecha: NOCHE,
          capa,
          agrupador: agrupadorDeProvincia(capa, resumen),
        },
      },
    ]),
  );
  return { resumen, provincias };
};
