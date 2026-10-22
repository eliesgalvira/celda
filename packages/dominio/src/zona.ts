import type { Coordenada, Rectangulo } from "./area.ts";
import type { MunicipioDeCapa } from "./provincias.ts";

/**
 * Zonas del mapa: provincias, municipios y barrios, cada una con su número de emplazamientos (ADR
 * 0017). Los barrios se resumen en `barrio.ts`; aquí van los municipios.
 */

/** Lo que se cuenta de un municipio a partir de la capa de su provincia. */
export interface ResumenDeMunicipio {
  readonly municipio: MunicipioDeCapa;
  /** Cuántos emplazamientos de la capa caen en el municipio. */
  readonly emplazamientos: number;
  /** La caja de sus emplazamientos, o `undefined` si no tiene ninguno. */
  readonly caja: Rectangulo | undefined;
}

/** Lo que el resumen necesita de cada emplazamiento. */
export interface EmplazamientoConMunicipio {
  /** Código INE de su municipio, o `null` en un territorio compartido o sin provincia. */
  readonly municipio: string | null;
  readonly posicion: Coordenada;
}

/**
 * Cuántos emplazamientos tiene cada municipio y la caja que ocupan. Los números salen de los
 * emplazamientos de la capa, los mismos que dibuja el mapa, y no de la tabla de municipios. Es
 * una función pura.
 */
export const resumirMunicipios = (
  municipios: ReadonlyArray<MunicipioDeCapa>,
  emplazamientos: ReadonlyArray<EmplazamientoConMunicipio>,
): ReadonlyArray<ResumenDeMunicipio> => {
  const porMunicipio = new Map<
    string,
    { cuantos: number; caja: [number, number, number, number] }
  >();
  for (const { municipio, posicion } of emplazamientos) {
    if (municipio === null) continue;
    const { longitud: x, latitud: y } = posicion;
    const cuenta = porMunicipio.get(municipio);
    if (cuenta === undefined) {
      porMunicipio.set(municipio, { cuantos: 1, caja: [x, y, x, y] });
      continue;
    }
    cuenta.cuantos += 1;
    const [oeste, sur, este, norte] = cuenta.caja;
    cuenta.caja = [Math.min(oeste, x), Math.min(sur, y), Math.max(este, x), Math.max(norte, y)];
  }
  return municipios.map((municipio) => {
    const cuenta = porMunicipio.get(municipio.codigo);
    const emplazamientos = cuenta?.cuantos ?? 0;
    const [oeste = 0, sur = 0, este = 0, norte = 0] = cuenta?.caja ?? [];
    return {
      municipio,
      emplazamientos,
      caja:
        cuenta === undefined
          ? undefined
          : {
              suroeste: { longitud: oeste, latitud: sur },
              noreste: { longitud: este, latitud: norte },
            },
    };
  });
};
