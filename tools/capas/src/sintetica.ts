import { cajaDeCuadro, ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import type { Estado } from "@celda/dominio/emplazamiento";
import type { Ficha } from "@celda/dominio/ficha";
import { DatosPublicables } from "@celda/publicacion/publicar";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Una España sintética para medir la capa por provincias (ADR 0016): `n` emplazamientos repartidos
 * como en la investigación de la ampliación (`docs/investigacion/muestras/espana/generar-espana.mjs`,
 * con la misma semilla), la mayoría alrededor de las ciudades y el resto al azar por la península.
 * Todas las zonas de barrido están barridas, así que todas las provincias están cubiertas.
 */

/** Las ciudades de la investigación: longitud, latitud y peso. */
const CIUDADES: ReadonlyArray<readonly [number, number, number]> = [
  [-3.7, 40.42, 14],
  [2.17, 41.39, 10],
  [-0.38, 39.47, 5],
  [-5.98, 37.39, 5],
  [-0.88, 41.65, 4],
  [-4.42, 36.72, 4],
  [-1.13, 37.99, 3],
  [2.65, 39.57, 3],
  [-15.43, 28.12, 3],
  [-2.93, 43.26, 4],
  [-4.72, 41.65, 2],
  [-8.72, 42.24, 3],
  [-5.66, 43.54, 2],
  [-8.41, 43.36, 2],
  [-3.6, 37.18, 2],
  [-0.48, 38.35, 3],
  [-6.97, 38.88, 1],
  [-1.64, 42.81, 2],
  [-3.81, 43.46, 2],
  [-2.45, 36.84, 2],
  [2.82, 41.98, 1],
  [1.25, 41.12, 2],
  [0.62, 41.62, 1],
  [-16.25, 28.46, 2],
  [-4.78, 37.88, 2],
  [-6.29, 36.53, 2],
  [-2.67, 42.85, 1],
  [-5.57, 42.6, 1],
  [-8.55, 42.88, 1],
  [-3.92, 38.99, 1],
  [-4.03, 39.86, 1],
  [-3.17, 41.84, 0.5],
  [-1.86, 38.99, 1],
  [-2.13, 40.07, 0.5],
  [-6.37, 39.47, 0.7],
  [-7.86, 42.34, 0.7],
  [-7.55, 43.01, 0.7],
  [-2.46, 42.47, 1],
  [-0.04, 39.99, 1.5],
  [2.01, 41.56, 2],
  [2.11, 41.54, 2],
  [2.1, 41.36, 3],
  [-3.72, 40.3, 3],
  [-3.88, 40.34, 2],
  [-3.36, 40.48, 2],
];

/** Compañías por bit, como en la investigación: Movistar, Vodafone, Orange y Digi. */
const COMPANIAS: ReadonlyArray<Compania> = ["movistar", "vodafone", "orange", "digi"];
const ESTADOS: ReadonlyArray<Estado> = ["verificado", "corregido", "nuevo"];

/** Los emplazamientos sintéticos, siempre los mismos para el mismo `n`. */
export const emplazamientosSinteticos = (n: number): ReadonlyArray<EmplazamientoDeCapa> => {
  let semilla = 11;
  const azar = () => {
    semilla = (semilla * 1_664_525 + 1_013_904_223) >>> 0;
    return semilla / 2 ** 32;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(azar() + 1e-12)) * Math.cos(2 * Math.PI * azar());
  const companias = (): ReadonlyArray<Compania> => {
    const r = azar();
    const cuantas = r < 0.68 ? 1 : r < 0.9 ? 2 : r < 0.98 ? 3 : 4;
    const pesos = [0.34, 0.24, 0.3, 0.12];
    const elegidas = new Set<Compania>();
    while (elegidas.size < cuantas) {
      let t = azar();
      let k = 0;
      while (t > (pesos[k] ?? 1) && k < 3) t -= pesos[k++] ?? 0;
      elegidas.add(COMPANIAS[k] ?? "movistar");
    }
    return COMPANIAS.filter((c) => elegidas.has(c));
  };
  const estado = (): Estado => {
    const r = azar();
    return ESTADOS[r < 0.86 ? 0 : r < 0.94 ? 1 : 2] ?? "verificado";
  };
  const puntos: Array<readonly [number, number]> = [];
  const total = CIUDADES.reduce((a, [, , peso]) => a + peso, 0) + 20;
  for (const [x, y, peso] of CIUDADES) {
    const cuantos = Math.round((n * peso) / total);
    const s = 0.03 + 0.012 * peso;
    for (let j = 0; j < cuantos; j++) puntos.push([x + gauss() * s * 1.3, y + gauss() * s]);
  }
  while (puntos.length < n) puntos.push([-9.2 + azar() * 12.4, 36.1 + azar() * 7.6]);
  return puntos.slice(0, n).map(([longitud, latitud], i) => {
    const suyas = companias();
    return {
      clave: `${suyas[0] ?? "movistar"}-s${String(i).padStart(6, "0")}`,
      posicion: { longitud, latitud },
      estado: estado(),
      companias: suyas,
    };
  });
};

const fichaDe = (emplazamiento: EmplazamientoDeCapa, fecha: number): Ficha => ({
  clave: emplazamiento.clave,
  posicion: emplazamiento.posicion,
  direccion: "CL SINTÉTICA, 1. ESPAÑA",
  municipio: "SINTÉTICO",
  estado: emplazamiento.estado,
  confianza: "media",
  conflictos: [],
  estaciones: emplazamiento.companias.map((compania) => ({
    compania,
    codigos: [emplazamiento.clave],
    bandas: [],
    origenes: [],
  })),
  datosDel: fecha,
  version: fecha,
});

/** Los datos de la publicación: los emplazamientos sintéticos, con toda España barrida. */
export const datosSinteticos = (n: number, fecha: number) => {
  const emplazamientos = emplazamientosSinteticos(n);
  const porClave = new Map(emplazamientos.map((e) => [e.clave, e]));
  return Layer.succeed(
    DatosPublicables,
    DatosPublicables.of({
      version: Effect.succeed(fecha),
      emplazamientos: Effect.succeed(emplazamientos),
      fichas: (claves) =>
        Effect.succeed(
          claves.flatMap((clave) => {
            const emplazamiento = porClave.get(clave);
            return emplazamiento === undefined ? [] : [fichaDe(emplazamiento, fecha)];
          }),
        ),
      cobertura: Effect.succeed(
        ZONAS_DE_BARRIDO.map((zona) => ({
          nombre: zona.nombre,
          titulo: zona.titulo,
          cajas: zona.cuadros.map(cajaDeCuadro),
          barrido: fecha,
        })),
      ),
      registrar: () => Effect.void,
    }),
  );
};

/** La fecha de la capa sintética, siempre la misma. */
export const FECHA_SINTETICA = Date.UTC(2026, 8, 28, 2, 15);
