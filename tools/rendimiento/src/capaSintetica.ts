// El script corre con Node tal cual, sin Effect.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

// Rutas relativas y no `@celda/dominio`: Node no quita los tipos de los .ts de node_modules.
import type { LimitesDeBarrios } from "../../../packages/dominio/src/barrio.ts";
import {
  codificarVigente,
  type EmplazamientoDeCapa,
  FICHERO_VIGENTE,
  versionDeCapa,
} from "../../../packages/dominio/src/capa.ts";
import type { Compania } from "../../../packages/dominio/src/compania.ts";
import type { Ficha } from "../../../packages/dominio/src/ficha.ts";
import { repartirEnLotes } from "../../../packages/dominio/src/lotes.ts";
import {
  cajaDeSituados,
  combinacionesDeSituados,
  companiasDeSituados,
  type EmplazamientoSituado,
  ficheroDeCapaDeProvincia,
  ficheroDeLoteDeProvincia,
  ficheroDeResumen,
  generarCapaDeProvincia,
  generarLoteDeProvincia,
  generarResumen,
} from "../../../packages/dominio/src/provincias.ts";
import { ficheroDePuntos, generarPuntos } from "../../../packages/dominio/src/puntos.ts";

/**
 * Una capa publicada de prueba, sin descargar nada: 25 emplazamientos en una rejilla alrededor
 * del Campus Nord, con sus fichas y sus bandas, en el formato que publica Celda (ADR 0016): un
 * resumen nacional con Barcelona, su capa y sus lotes. Basta para abrir una ficha.
 */

const NOCHE = Date.UTC(2026, 8, 26, 0, 15, 3);
const CENTRO = { longitud: 2.1136, latitud: 41.3883 };
/** Unos 250 m entre emplazamientos. */
const PASO = { longitud: 0.003, latitud: 0.00225 };
const COMPANIAS: ReadonlyArray<Compania> = ["movistar", "vodafone", "orange", "digi"];

const LIMITES: LimitesDeBarrios = {
  fuente: {
    atribucion: "Ajuntament de Barcelona",
    licencia: "CC BY 4.0",
    enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
    fecha: "2024-11-12",
  },
  barrios: [
    {
      codigo: "21",
      nombre: "Pedralbes",
      etiqueta: CENTRO,
      poligonos: [
        [
          [
            [CENTRO.longitud - 0.01, CENTRO.latitud - 0.008],
            [CENTRO.longitud + 0.01, CENTRO.latitud - 0.008],
            [CENTRO.longitud + 0.01, CENTRO.latitud + 0.008],
            [CENTRO.longitud - 0.01, CENTRO.latitud + 0.008],
          ],
        ],
      ],
    },
  ],
};

const FUENTE_IGN = {
  atribucion: "Instituto Geográfico Nacional",
  producto: "Base de Datos de Límites Jurisdiccionales de España",
  licencia: "CC BY 4.0",
  enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
  fecha: "2026-08-10",
  huella: "sha256:prueba",
};

const FUENTE_INE = {
  atribucion: "INE",
  licencia: "CC BY 4.0",
  enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
  referencia: "2025-01-01",
  publicada: "2025-12-11",
};

export interface CapaSintetica {
  readonly carpeta: string;
  /** La clave del emplazamiento del centro, el que abre la prueba. */
  readonly central: string;
  readonly centro: typeof CENTRO;
  /** El primer renglón de la dirección de su ficha, que es el título del panel. */
  readonly titulo: string;
  /** Dónde está cada emplazamiento. */
  readonly posiciones: ReadonlyArray<typeof CENTRO>;
}

const fichaDe = (emplazamiento: EmplazamientoDeCapa, i: number): Ficha => ({
  clave: emplazamiento.clave,
  posicion: emplazamiento.posicion,
  direccion: `CL DE PRUEBA, ${i + 1}. BARCELONA, BARCELONA`,
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: emplazamiento.companias.map((compania) => ({
    compania,
    codigos: [`08${String(i).padStart(5, "0")}`],
    bandas: [],
    bandasSinLeer: true,
    origenes: [
      {
        fuente: "registro-oficial",
        clave: `${compania} - ${i}`,
        url: "https://geoportal.minetur.gob.es/VCTEL/",
        fecha: NOCHE,
        afirma: "presente",
        historial: [{ tipo: "en-el-registro-antes" as const, fecha: NOCHE }],
      },
    ],
  })),
  datosDel: NOCHE,
  version: NOCHE,
});

/** Escribe la capa en una carpeta nueva dentro de `base` y dice dónde está. */
export const escribirCapaSintetica = async (base: string): Promise<CapaSintetica> => {
  const emplazamientos: Array<EmplazamientoDeCapa> = [];
  for (let fila = -2; fila <= 2; fila += 1) {
    for (let columna = -2; columna <= 2; columna += 1) {
      const i = emplazamientos.length;
      const compania = COMPANIAS[i % COMPANIAS.length] ?? "movistar";
      emplazamientos.push({
        clave: `${compania}-${String(i).padStart(4, "0")}`,
        posicion: {
          longitud: CENTRO.longitud + columna * PASO.longitud,
          latitud: CENTRO.latitud + fila * PASO.latitud,
        },
        estado: "verificado",
        companias: [compania],
        bandas: [{ compania, mhz: [800, 1800] }],
      });
    }
  }
  const central = emplazamientos[12];
  if (central === undefined) throw new Error("La rejilla no tiene centro");

  const carpeta = await NodeFSP.mkdtemp(NodePath.join(base, "celda-capas-"));
  const guardar = async (fichero: string, contenido: string) => {
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(carpeta, fichero)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(carpeta, fichero), contenido);
  };
  const huella = (contenido: string) =>
    NodeCrypto.createHash("sha256").update(contenido).digest("hex");
  const version = versionDeCapa(NOCHE);
  const situados: ReadonlyArray<EmplazamientoSituado> = emplazamientos.map((emplazamiento) => ({
    emplazamiento,
    provincia: "08",
    municipio: null,
    lugar: { municipio: null, provincia: null },
  }));
  const fichas = new Map(emplazamientos.map((e, i) => [e.clave, fichaDe(e, i)]));
  const lotes = [];
  for (const claves of repartirEnLotes(emplazamientos)) {
    const contenido = generarLoteDeProvincia(
      "08",
      claves.flatMap((clave) => fichas.get(clave) ?? []),
      new Map(),
      FUENTE_IGN,
    );
    const fichero = ficheroDeLoteDeProvincia("08", huella(contenido));
    await guardar(fichero, contenido);
    lotes.push({ fichero, claves });
  }
  const contenidoCapa = generarCapaDeProvincia({
    provincia: "08",
    situados: situados.toSorted((a, b) => (a.emplazamiento.clave < b.emplazamiento.clave ? -1 : 1)),
    barrios: LIMITES,
    municipios: [],
    lotes,
  });
  const ficheroCapa = ficheroDeCapaDeProvincia("08", huella(contenidoCapa));
  await guardar(ficheroCapa, contenidoCapa);
  const puntos = generarPuntos(new Map([["08", situados]]));
  const ficheroPuntos = ficheroDePuntos(huella(puntos));
  await guardar(ficheroPuntos, puntos);
  const resumen = generarResumen({
    version,
    fuentes: { barrios: LIMITES.fuente, municipios: FUENTE_IGN, padron: FUENTE_INE },
    cobertura: [
      {
        nombre: "prueba",
        titulo: "Campus Nord",
        cajas: [
          [
            CENTRO.longitud - 0.05,
            CENTRO.latitud - 0.05,
            CENTRO.longitud + 0.05,
            CENTRO.latitud + 0.05,
          ],
        ],
        barrido: NOCHE,
      },
    ],
    provincias: [
      {
        codigo: "08",
        nombre: "Barcelona",
        etiqueta: { longitud: 1.983915, latitud: 41.730886 },
        caja: cajaDeSituados(situados),
        emplazamientos: situados.length,
        companias: companiasDeSituados(situados),
        fichero: ficheroCapa,
        combinaciones: combinacionesDeSituados(situados),
      },
    ],
    cuadros: new Map(),
    puntos: ficheroPuntos,
  });
  const ficheroResumen = ficheroDeResumen(version, huella(resumen));
  await guardar(ficheroResumen, resumen);
  await guardar(
    FICHERO_VIGENTE,
    codificarVigente({
      version,
      fecha: NOCHE,
      emplazamientos: emplazamientos.length,
      lotes: lotes.length,
      resumen: ficheroResumen,
    }),
  );
  return {
    carpeta,
    central: central.clave,
    centro: CENTRO,
    titulo: "CL DE PRUEBA, 13",
    posiciones: emplazamientos.map((emplazamiento) => emplazamiento.posicion),
  };
};
