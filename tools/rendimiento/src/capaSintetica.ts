// El script corre con Node tal cual, sin Effect.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

// Rutas relativas y no `@celda/dominio`: Node no quita los tipos de los .ts de node_modules.
import type { LimitesDeBarrios } from "../../../packages/dominio/src/barrio.ts";
import {
  carpetaDeFichas,
  codificarVigente,
  type EmplazamientoDeCapa,
  FICHERO_VIGENTE,
  generarCapa,
} from "../../../packages/dominio/src/capa.ts";
import type { Compania } from "../../../packages/dominio/src/compania.ts";
import type { Ficha } from "../../../packages/dominio/src/ficha.ts";
import { generarLote } from "../../../packages/dominio/src/loteDeFichas.ts";

/**
 * Una capa publicada de prueba, sin descargar nada: 25 emplazamientos en una rejilla alrededor
 * del Campus Nord, con sus fichas y sus bandas, en el formato que publica Celda. Basta para abrir
 * una ficha, calcular las celdas y la vista de interferencia.
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

export interface CapaSintetica {
  readonly carpeta: string;
  /** La clave del emplazamiento del centro, el que abre la prueba. */
  readonly central: string;
  readonly centro: typeof CENTRO;
  /** El primer renglón de la dirección de su ficha, que es el título del panel. */
  readonly titulo: string;
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
    origenes: [
      {
        fuente: "registro-oficial",
        clave: `${compania} - ${i}`,
        url: "https://geoportal.minetur.gob.es/VCTEL/",
        fecha: NOCHE,
        afirma: "presente",
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

  const capa = generarCapa(NOCHE, emplazamientos, LIMITES);
  const carpeta = await NodeFSP.mkdtemp(NodePath.join(base, "celda-capas-"));
  await NodeFSP.writeFile(NodePath.join(carpeta, capa.fichero), capa.contenido);
  const fichas = new Map(emplazamientos.map((e, i) => [e.clave, fichaDe(e, i)]));
  await NodeFSP.mkdir(NodePath.join(carpeta, carpetaDeFichas(capa.version)), { recursive: true });
  for (const [lote, claves] of capa.lotes.entries()) {
    const generado = generarLote(
      capa.version,
      lote,
      claves.flatMap((clave) => {
        const ficha = fichas.get(clave);
        return ficha === undefined ? [] : [ficha];
      }),
    );
    await NodeFSP.writeFile(NodePath.join(carpeta, generado.fichero), generado.contenido);
  }
  await NodeFSP.writeFile(
    NodePath.join(carpeta, FICHERO_VIGENTE),
    codificarVigente({
      version: capa.version,
      fecha: NOCHE,
      emplazamientos: capa.emplazamientos,
      lotes: capa.lotes.length,
    }),
  );
  return {
    carpeta,
    central: central.clave,
    centro: CENTRO,
    titulo: "CL DE PRUEBA, 13",
  };
};
