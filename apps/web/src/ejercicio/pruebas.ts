import { cajaDe, type Coordenada } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import {
  ficheroDeCapaDeProvincia,
  ficheroDeLoteDeProvincia,
  type MunicipioDeCapa,
  type ResumenLeido,
} from "@celda/dominio/provincias";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { crearAgrupador } from "../capa/agrupacion.ts";
import { agrupacionEnHilo, type ProvinciaCargada, prefijoDeProvincia } from "../capa/nacional.ts";
import { cajaDeBarcelona, FUENTES_DE_PRUEBA } from "../capa/pruebas.ts";
import { CapaEmplazamientos, CapaNoDescargada } from "../capa/servicio.ts";

/**
 * Una capa de varias provincias para las pruebas del ejercicio: cada provincia se pide aparte,
 * se cuenta cada petición y contesta cuando la prueba lo dice, como la red.
 */

/** Un emplazamiento de prueba en un municipio. */
export const emplazamiento = (
  clave: string,
  municipio: string,
  posicion: Coordenada,
  companias: ReadonlyArray<Compania>,
): EmplazamientoLeido => ({
  clave,
  posicion,
  estado: "verificado",
  companias,
  barrio: null,
  lote: 0,
  provincia: municipio.slice(0, 2),
  municipio,
});

/** Un municipio de la tabla de su provincia, con sus emplazamientos contados. */
export const municipio = (
  codigo: string,
  nombre: string,
  habitantes: number | null,
  areaKm2: number,
  emplazamientos: ReadonlyArray<EmplazamientoLeido>,
): MunicipioDeCapa => {
  const suyos = emplazamientos.filter((e) => e.municipio === codigo);
  return {
    codigo,
    nombre,
    etiqueta: suyos[0]?.posicion ?? { longitud: 0, latitud: 0 },
    habitantes,
    areaKm2,
    emplazamientos: suyos.length,
    companias: [...new Set(suyos.flatMap((e) => e.companias))],
  };
};

/** Una provincia de la capa de prueba. Sin emplazamientos va en el resumen sin capa. */
export interface ProvinciaDePrueba {
  readonly codigo: string;
  readonly nombre: string;
  readonly etiqueta: Coordenada;
  readonly cubierta: boolean;
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  readonly municipios: ReadonlyArray<MunicipioDeCapa>;
}

const VERSION = "sitios@2026-09-28T22:13:40Z";
const FECHA = Date.UTC(2026, 8, 28, 22, 13, 40);

/** El resumen nacional con estas provincias, con Cataluña barrida. */
export const resumenDeProvincias = (
  provincias: ReadonlyArray<ProvinciaDePrueba>,
): ResumenLeido => ({
  version: VERSION,
  fecha: FECHA,
  fuentes: FUENTES_DE_PRUEBA,
  cobertura: [
    {
      ...cajaDeBarcelona(FECHA),
      nombre: "cataluna",
      titulo: "Cataluña",
      cajas: [
        [0, 40, 1, 41],
        [0, 41, 1, 42],
        [1, 41, 2, 42],
        [2, 41, 3, 42],
        [3, 41, 4, 42],
        [0, 42, 1, 43],
        [1, 42, 2, 43],
        [2, 42, 3, 43],
        [3, 42, 4, 43],
      ],
    },
  ],
  provincias: provincias.map((p) => ({
    codigo: p.codigo,
    nombre: p.nombre,
    etiqueta: p.etiqueta,
    caja: cajaDe(p.emplazamientos.map((e) => e.posicion)),
    emplazamientos: p.emplazamientos.length,
    companias: [...new Set(p.emplazamientos.flatMap((e) => e.companias))],
    cubierta: p.cubierta,
    barrido: FECHA,
    fichero:
      p.emplazamientos.length === 0 ? undefined : ficheroDeCapaDeProvincia(p.codigo, "prueba"),
  })),
});

/** Una provincia de prueba ya leída e indexada, como la deja el servicio de capa. */
export const provinciaCargada = (provincia: ProvinciaDePrueba): ProvinciaCargada => ({
  codigo: provincia.codigo,
  version: VERSION,
  fecha: FECHA,
  capa: {
    provincia: provincia.codigo,
    emplazamientos: provincia.emplazamientos,
    barrios: [],
    fuenteDeBarrios: undefined,
    municipios: provincia.municipios,
    lotes: [ficheroDeLoteDeProvincia(provincia.codigo, "prueba0")],
  },
  agrupador: crearAgrupador(provincia.emplazamientos, [], {
    prefijo: prefijoDeProvincia(provincia.codigo),
  }),
});

/**
 * La capa de prueba: el resumen llega en el acto y cada provincia, cuando la prueba llama a
 * `responder` con su código. `pedidas` lista cada petición de provincia, en orden, y con
 * `fallar` la petición en curso no llega.
 */
export const capaDeProvincias = (provincias: ReadonlyArray<ProvinciaDePrueba>) => {
  const pedidas: Array<string> = [];
  const esperas = new Map<string, Deferred.Deferred<boolean>>();
  const espera = (codigo: string) => {
    let actual = esperas.get(codigo);
    if (actual === undefined) {
      actual = Deferred.makeUnsafe<boolean>();
      esperas.set(codigo, actual);
    }
    return actual;
  };
  const capa = Layer.succeed(
    CapaEmplazamientos,
    CapaEmplazamientos.of({
      resumen: Effect.succeed(resumenDeProvincias(provincias)),
      provincia: (codigo) =>
        Effect.gen(function* () {
          pedidas.push(codigo);
          const llega = yield* Deferred.await(espera(codigo));
          const provincia = provincias.find((p) => p.codigo === codigo);
          if (!llega || provincia === undefined) {
            return yield* new CapaNoDescargada({ url: codigo, motivo: "prueba" });
          }
          return provinciaCargada(provincia);
        }),
      situarClave: (clave) =>
        Effect.succeed(
          Option.map(
            Option.fromNullishOr(
              provincias.find((p) => p.emplazamientos.some((e) => e.clave === clave))?.codigo,
            ),
            (provincia) => ({ clave, provincia }),
          ),
        ),
      agrupacion: (codigo, filtro) => {
        const provincia = provincias.find((p) => p.codigo === codigo);
        return provincia === undefined
          ? Effect.fail(new CapaNoDescargada({ url: codigo, motivo: "prueba" }))
          : Effect.succeed(
              agrupacionEnHilo(
                provinciaCargada(provincia),
                resumenDeProvincias(provincias),
                filtro,
              ),
            );
      },
    }),
  );
  return {
    capa,
    pedidas: (): ReadonlyArray<string> => [...pedidas],
    responder: (codigo: string) => Deferred.doneUnsafe(espera(codigo), Effect.succeed(true)),
    /** La petición en curso falla; la siguiente vuelve a esperar a `responder`. */
    fallar: (codigo: string) => {
      Deferred.doneUnsafe(espera(codigo), Effect.succeed(false));
      esperas.delete(codigo);
    },
  };
};
