import type { Coordenada, Rectangulo } from "./area.ts";
import { Compania } from "./compania.ts";
import type { MunicipioDeCapa, ProvinciaDelResumen } from "./provincias.ts";

/**
 * Zonas del mapa: provincias, municipios y barrios, cada una con su número de emplazamientos y sus
 * ausencias (ADR 0017). Los barrios se resumen en `barrio.ts`; aquí van los municipios, las
 * provincias y la regla común de las ausencias.
 */

/**
 * Emplazamientos que necesita un municipio para enseñar sus ausencias. Uno con menos «no tiene»
 * casi todas las compañías, y eso no es un hueco de cobertura: solo se enseña su número. Lo
 * decidió el usuario el 28/09/2026 (ADR 0017).
 */
export const UMBRAL_DE_AUSENCIAS = 10;

/**
 * Las compañías de `enLaCapa` que no están en `presentes`, en el orden de `orden`. De una compañía
 * que no tiene ningún emplazamiento en la capa no se dice que falte en ninguna zona.
 */
export const ausentesEntre = (
  presentes: ReadonlyArray<Compania>,
  enLaCapa: ReadonlySet<Compania>,
  orden: ReadonlyArray<Compania> = Compania.literals,
): ReadonlyArray<Compania> => orden.filter((c) => enLaCapa.has(c) && !presentes.includes(c));

/**
 * Las ausencias de una provincia del resumen nacional. Solo en una provincia cubierta: de una a
 * medias no se sabe si falta alguien en la parte que Celda aún no tiene.
 */
export const ausentesDeProvincia = (
  provincia: ProvinciaDelResumen,
  enLaCapa: ReadonlySet<Compania>,
  orden: ReadonlyArray<Compania> = Compania.literals,
): ReadonlyArray<Compania> =>
  provincia.cubierta ? ausentesEntre(provincia.companias, enLaCapa, orden) : [];

/** Las compañías con algún emplazamiento en alguna provincia del resumen. */
export const companiasDelResumen = (
  provincias: ReadonlyArray<ProvinciaDelResumen>,
): ReadonlySet<Compania> => new Set(provincias.flatMap((p) => p.companias));

/** Lo que se cuenta de un municipio a partir de la capa de su provincia. */
export interface ResumenDeMunicipio {
  readonly municipio: MunicipioDeCapa;
  /** Cuántos emplazamientos de la capa caen en el municipio. */
  readonly emplazamientos: number;
  /**
   * Compañías sin ningún emplazamiento en el municipio. Vacía si tiene menos de
   * `UMBRAL_DE_AUSENCIAS`.
   */
  readonly ausentes: ReadonlyArray<Compania>;
  /** La caja de sus emplazamientos, o `undefined` si no tiene ninguno. */
  readonly caja: Rectangulo | undefined;
}

/** Lo que el resumen necesita de cada emplazamiento. */
export interface EmplazamientoConMunicipio {
  /** Código INE de su municipio, o `null` en un territorio compartido o sin provincia. */
  readonly municipio: string | null;
  readonly companias: ReadonlyArray<Compania>;
  readonly posicion: Coordenada;
}

/**
 * Cuántos emplazamientos tiene cada municipio y, si llega a `UMBRAL_DE_AUSENCIAS`, qué compañías
 * de `enLaCapa` no tienen ninguno allí. Los números salen de los emplazamientos de la capa, los
 * mismos que dibuja el mapa, no de la tabla de municipios. Es una función pura.
 */
export const resumirMunicipios = (
  municipios: ReadonlyArray<MunicipioDeCapa>,
  emplazamientos: ReadonlyArray<EmplazamientoConMunicipio>,
  enLaCapa: ReadonlySet<Compania>,
  orden: ReadonlyArray<Compania> = Compania.literals,
): ReadonlyArray<ResumenDeMunicipio> => {
  const porMunicipio = new Map<
    string,
    { cuantos: number; presentes: Set<Compania>; caja: [number, number, number, number] }
  >();
  for (const { municipio, companias, posicion } of emplazamientos) {
    if (municipio === null) continue;
    const { longitud: x, latitud: y } = posicion;
    const cuenta = porMunicipio.get(municipio);
    if (cuenta === undefined) {
      porMunicipio.set(municipio, {
        cuantos: 1,
        presentes: new Set(companias),
        caja: [x, y, x, y],
      });
      continue;
    }
    cuenta.cuantos += 1;
    for (const compania of companias) cuenta.presentes.add(compania);
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
      ausentes:
        emplazamientos < UMBRAL_DE_AUSENCIAS
          ? []
          : ausentesEntre([...(cuenta?.presentes ?? [])], enLaCapa, orden),
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
