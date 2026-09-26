import * as Schema from "effect/Schema";

import { repartirEnSectores } from "./celdas.ts";
import { ParamsDiagramaSector, gananciaSector } from "./diagramaSector.ts";
import { DISTANCIA_MINIMA_M, PENDIENTE_DB_POR_DECADA } from "./perdidasUrbanas.ts";
import { contiene, type Poligono, recortar } from "./poligono.ts";
import {
  diferenciaDeRumbo,
  distanciaDe,
  type Malla,
  puntosDe,
  rumboDe,
  type Simulacion,
} from "./simulacion.ts";

/**
 * Los sectores de la estación base, como en el diagrama de sector, y la celda de su emplazamiento
 * con el emplazamiento en el origen de la malla: vértices este y norte alternos, en sentido
 * antihorario. La celda va vacía si todavía no se conoce.
 */
export const ParamsSectorServicio = Schema.Struct({
  ...ParamsDiagramaSector.fields,
  celda: Schema.Array(Schema.Finite).check(
    Schema.makeFilter(
      (celda) =>
        celda.length === 0 ||
        (celda.length >= 6 && celda.length % 2 === 0) ||
        "la celda necesita al menos tres vértices, este y norte alternos",
    ),
  ),
});
export type ParamsSectorServicio = typeof ParamsSectorServicio.Type;

/**
 * Más cerca que esto del emplazamiento no se elige sector: el rumbo no dice nada. Es el umbral de
 * la fusión (ADR 0012), así que la posición del emplazamiento tampoco se conoce mejor.
 */
export const DISTANCIA_JUNTO_M = 15;

/** Cada banda del degradado pierde esto más que la anterior, en dB. */
export const PASO_DEGRADADO_DB = 2;

/** Lo más que se estira el degradado: 60 bandas de 2 dB llegan a unos 50 km. */
const BANDAS_MAXIMAS = 60;

/** Lados del polígono que hace de círculo al recortar las bandas. */
const LADOS_CIRCULO = 64;

export type ResultadoSectorServicio = {
  /** Para cada punto de la malla, el sector que le da servicio, o −1 si está junto al emplazamiento. */
  readonly sector: Int8Array;
  /** Ganancia de ese sector hacia el punto, en dB respecto a su eje (0 en el eje, negativa fuera). */
  readonly gananciaDb: Float64Array;
  /** Rumbo del punto menos el azimut de ese sector, en grados, entre −180 y 180. */
  readonly desviacion: Float64Array;
  /** Distancia del emplazamiento al punto, en metros. */
  readonly distancia: Float64Array;
  /** Rumbo del emplazamiento al punto, en grados desde el norte hacia el este. */
  readonly rumbo: Float64Array;
  /** 1 si el punto cae en la celda, 0 si queda fuera y −1 si no hay celda. */
  readonly enCelda: Int8Array;
  /**
   * La celda repartida entre los sectores con `repartirEnSectores`: el sector `k` son los
   * vértices de `inicioSectores[k]` a `inicioSectores[k + 1]`. Vacío si no hay celda.
   */
  readonly sectores: Float64Array;
  readonly inicioSectores: Uint32Array;
  /**
   * Los límites entre sectores: van del emplazamiento (el origen) al punto del borde de la celda
   * que da cada uno, este y norte alternos. Uno por sector con polígono si hay dos o más.
   */
  readonly cortes: Float64Array;
  /**
   * El degradado: discos cada vez más grandes alrededor del emplazamiento, recortados al sector
   * que da servicio al primer punto de la malla, o a la celda entera si no hay punto o está junto
   * al emplazamiento. La banda `k` son los vértices de `inicioBandas[k]` a `inicioBandas[k + 1]`
   * y contiene a todas las anteriores.
   */
  readonly bandas: Float64Array;
  readonly inicioBandas: Uint32Array;
  /**
   * Lo que se pierde en el borde de cada banda respecto a la primera, en dB, según las pérdidas
   * urbanas: `k · PASO_DEGRADADO_DB`.
   */
  readonly perdidaBandas: Float64Array;
};

/** El trozo `k` de unos vértices seguidos, sin copiarlo. */
export const trozo = (vertices: Float64Array, inicio: Uint32Array, k: number): Poligono =>
  vertices.subarray(2 * (inicio[k] ?? 0), 2 * (inicio[k + 1] ?? 0));

/** Polígonos con sus vértices seguidos y dónde empieza cada uno. */
interface Juntos {
  readonly vertices: Float64Array;
  readonly inicio: Uint32Array;
}

/** Junta polígonos en vértices seguidos y dónde empieza cada uno. */
const juntar = (poligonos: ReadonlyArray<ArrayLike<number>>): Juntos => {
  const inicio = new Uint32Array(poligonos.length + 1);
  for (const [k, p] of poligonos.entries()) inicio[k + 1] = (inicio[k] ?? 0) + p.length / 2;
  const vertices = new Float64Array(2 * (inicio[poligonos.length] ?? 0));
  for (const [k, p] of poligonos.entries()) vertices.set(p, 2 * (inicio[k] ?? 0));
  return { vertices, inicio };
};

/** Radio en que las pérdidas urbanas crecen `perdidaDb` respecto a la distancia mínima. */
const radioDePerdida = (perdidaDb: number): number =>
  DISTANCIA_MINIMA_M * 10 ** (perdidaDb / PENDIENTE_DB_POR_DECADA);

/** La parte del polígono a `radio` metros o menos del origen, con el círculo como polígono. */
const dentroDelCirculo = (
  poligono: ReadonlyArray<number>,
  radio: number,
): ReadonlyArray<number> => {
  let resto = poligono;
  for (let j = 0; j < LADOS_CIRCULO && resto.length > 0; j++) {
    const angulo = (2 * Math.PI * j) / LADOS_CIRCULO;
    // Lado tangente al círculo: el polígono lo rodea sin dejar fuera nada del círculo.
    resto = recortar(resto, Math.sin(angulo), Math.cos(angulo), radio);
  }
  return resto;
};

/**
 * Las bandas del degradado sobre un polígono con el emplazamiento en el origen: la primera llega
 * a la distancia mínima de las pérdidas urbanas y cada una pierde `PASO_DEGRADADO_DB` más que la
 * anterior, hasta cubrir el polígono entero.
 */
const bandasDe = (poligono: Poligono): ReadonlyArray<ReadonlyArray<number>> => {
  if (poligono.length < 6) return [];
  let lejos = 0;
  for (let i = 0; i < poligono.length; i += 2) {
    lejos = Math.max(lejos, Math.hypot(poligono[i] ?? 0, poligono[i + 1] ?? 0));
  }
  const base = Array.from(poligono);
  const bandas: Array<ReadonlyArray<number>> = [];
  for (let k = 0; k < BANDAS_MAXIMAS; k++) {
    const radio = radioDePerdida(k * PASO_DEGRADADO_DB);
    bandas.push(radio >= lejos ? base : dentroDelCirculo(base, radio));
    if (radio >= lejos) break;
  }
  return bandas;
};

/**
 * El sector que da servicio a cada punto de la malla, cuánto pierde respecto a su eje y a qué
 * distancia y rumbo queda, con la celda repartida entre los sectores y el degradado que pinta el
 * mapa.
 *
 * Da servicio el sector que más ganancia da hacia el punto en el diagrama de sector del 3GPP
 * (TR 38.901, tabla 7.3-1); en un empate, el primero. Con sectores iguales es el de eje más
 * cercano, el mismo reparto que `repartirEnSectores`. Solo mira la dirección: no compara con
 * otros emplazamientos, así que un punto fuera de la celda también tiene sector. Junto al
 * emplazamiento (a menos de `DISTANCIA_JUNTO_M`) no elige ninguno.
 *
 * El degradado se apaga con la distancia como las pérdidas urbanas del 3GPP (TR 36.942,
 * apartado 4.5.2): 37,6 dB más cada vez que la distancia se multiplica por diez. No depende de la
 * banda, que solo suma una constante.
 */
export const sectorServicio: Simulacion<ParamsSectorServicio, ResultadoSectorServicio> = {
  id: "sector-servicio",
  version: "1",
  params: ParamsSectorServicio,
  ejecutar: (p: ParamsSectorServicio, malla: Malla): ResultadoSectorServicio => {
    const n = puntosDe(malla);
    const sector = new Int8Array(n);
    const gananciaDb = new Float64Array(n);
    const desviacion = new Float64Array(n);
    const distancia = new Float64Array(n);
    const rumbo = new Float64Array(n);
    const enCelda = new Int8Array(n);
    const celda = Float64Array.from(p.celda);
    const hayCelda = celda.length >= 6;

    for (let i = 0; i < n; i++) {
      distancia[i] = distanciaDe(malla, i);
      rumbo[i] = rumboDe(malla, i);
      enCelda[i] = hayCelda
        ? contiene(celda, malla.este[i] ?? 0, malla.norte[i] ?? 0)
          ? 1
          : 0
        : -1;
      if ((distancia[i] ?? 0) < DISTANCIA_JUNTO_M) {
        sector[i] = -1;
        continue;
      }
      let mejor = -Infinity;
      for (const [k, azimut] of p.azimuts.entries()) {
        const desvio = diferenciaDeRumbo(rumbo[i] ?? 0, azimut);
        const g = gananciaSector(desvio, p.anchoHazGrados, p.atenuacionMaximaDb);
        if (g > mejor) {
          mejor = g;
          sector[i] = k;
          gananciaDb[i] = g;
          desviacion[i] = desvio;
        }
      }
    }

    const reparto = hayCelda
      ? repartirEnSectores(celda, { este: 0, norte: 0 }, p.azimuts)
      : p.azimuts.map(() => new Float64Array(0));
    const sectores = juntar(reparto);
    const conPoligono = reparto.filter((poligono) => poligono.length >= 6);
    const cortes = Float64Array.from(
      conPoligono.length < 2
        ? []
        : conPoligono.flatMap((poligono) => [poligono[2] ?? 0, poligono[3] ?? 0]),
    );
    const servido = n > 0 ? (sector[0] ?? -1) : -1;
    const bandas = juntar(bandasDe(servido >= 0 ? (reparto[servido] ?? celda) : celda));
    const perdidaBandas = Float64Array.from(
      { length: bandas.inicio.length - 1 },
      (_, k) => k * PASO_DEGRADADO_DB,
    );
    return {
      sector,
      gananciaDb,
      desviacion,
      distancia,
      rumbo,
      enCelda,
      sectores: sectores.vertices,
      inicioSectores: sectores.inicio,
      cortes,
      bandas: bandas.vertices,
      inicioBandas: bandas.inicio,
      perdidaBandas,
    };
  },
};
