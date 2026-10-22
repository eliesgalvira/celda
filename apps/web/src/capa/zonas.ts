import type { Coordenada } from "@celda/dominio/area";
import { MUNDO, mercatorY } from "../lib/mercator.ts";

/**
 * Qué municipios se ven como zona en cada nivel de municipios (ADR 0017, #44 y su corrección, y
 * ADR 0024 en los niveles 9 y 10). Lo usan el Worker, que indexa aparte los emplazamientos que no
 * van en zona, y el agrupador, que dibuja las zonas: los dos tienen que decir lo mismo.
 */

/**
 * Nivel en que los emplazamientos de Barcelona se agrupan por barrio: del zoom 13 al 14. Más
 * lejos, los 73 barrios no caben en la pantalla, y las agrupaciones del nivel 12 ya son más
 * grandes que un barrio. Más cerca, las del nivel 14 son más pequeñas. Así, al alejar, cada paso
 * recoge lo del anterior.
 */
export const NIVEL_DE_BARRIOS = 13;

/**
 * Primer nivel en que un municipio es zona por lo que mide en la pantalla, del zoom 11 al 13,
 * justo antes del de barrios. En el 10, con los datos de Cataluña, se verían unas 180 zonas en la
 * pantalla de un móvil alrededor de Barcelona; en el 11, unas 60, como los barrios en el suyo.
 */
export const NIVEL_DE_MUNICIPIOS = 11;

/**
 * Primer nivel con zonas de municipio: el 9, el primero con el detalle de las provincias (ADR
 * 0024). En el 9 y el 10 solo son zona los municipios grandes (`HABITANTES_DE_ZONA`).
 */
export const NIVEL_DE_MUNICIPIOS_GRANDES = 9;

/**
 * Los habitantes del padrón que necesita un municipio para ser zona en los niveles 9 y 10: los
 * datos van discretos de lejos, y solo las ciudades grandes recogen sus emplazamientos en un
 * hexágono con su nombre (ADR 0024, prototipo 9d47710).
 */
export const HABITANTES_DE_ZONA: ReadonlyMap<number, number> = new Map([
  [9, 50_000],
  [10, 20_000],
]);

/**
 * El radio de las agrupaciones de los niveles de municipios grandes, el doble del de siempre
 * (`RADIO`): de lejos hay menos hexágonos y caben más nombres de ciudad.
 */
export const RADIO_DE_MUNICIPIOS_GRANDES = 120;

/** Los niveles con zonas de municipio, del más lejano al más cercano: del 9 al 12. */
export const NIVELES_DE_MUNICIPIOS: ReadonlyArray<number> = Array.from(
  { length: NIVEL_DE_BARRIOS - NIVEL_DE_MUNICIPIOS_GRANDES },
  (_, i) => NIVEL_DE_MUNICIPIOS_GRANDES + i,
);

/** Si un nivel es de municipios: del `NIVEL_DE_MUNICIPIOS_GRANDES` al de barrios, sin él. */
export const esNivelDeMunicipios = (nivel: number): boolean =>
  nivel >= NIVEL_DE_MUNICIPIOS_GRANDES && nivel < NIVEL_DE_BARRIOS;

/**
 * Si en un nivel solo los municipios grandes son zona, y el resto va en agrupaciones de
 * `RADIO_DE_MUNICIPIOS_GRANDES`, haya zonas o no.
 */
export const esNivelDeMunicipiosGrandes = (nivel: number): boolean => HABITANTES_DE_ZONA.has(nivel);

/**
 * Emplazamientos que necesita un municipio para verse como zona. Con 1 a 3, que son tres de cada
 * cuatro municipios con alguno, la zona taparía sus logos con un hexágono de «1» a «3» en el
 * centro del pueblo, y al acercar saltarían hasta sus sitios. Sus emplazamientos siguen sueltos o
 * en hexágonos, y el mapa base rotula el pueblo. Medido con la publicación de toda España del
 * 30/09/2026 (ADR 0017).
 */
export const MINIMO_DE_ZONA = 4;

/**
 * Lo más que puede medir en la pantalla, de lado, lo que ocupan los emplazamientos de un municipio
 * con su etiqueta para verse como zona en un nivel. Son 240 px: en el nivel de antes, la mitad,
 * lo que mide como mucho una agrupación (dos veces `RADIO`). Así, al acercar, una zona nunca junta
 * lo que el nivel de antes enseñaba separado. Un municipio más grande (Zaragoza, Madrid,
 * Barcelona) recogería en un solo hexágono lo que el nivel 10 enseña en decenas: en ese nivel sus
 * emplazamientos van en hexágonos.
 */
export const LADO_MAXIMO_DE_ZONA = 240;

/** Lo que el criterio necesita de cada emplazamiento. */
export interface ConMunicipio {
  readonly posicion: Coordenada;
  /** `null` sin municipio; sin la clave, una capa de antes del formato 5. */
  readonly municipio?: string | null;
}

/** Lo que el criterio necesita de cada municipio: dónde va su etiqueta y sus habitantes. */
export interface EtiquetaDeMunicipio {
  readonly codigo: string;
  readonly etiqueta: Coordenada;
  /** Del padrón; `null` o sin ellos, no es zona en los niveles de municipios grandes. */
  readonly habitantes?: number | null;
}

interface Extension {
  cuantos: number;
  oeste: number;
  este: number;
  /** En la proyección de Mercator, de 0 (arriba) a 1 (abajo). */
  arriba: number;
  abajo: number;
}

/**
 * Los municipios que se ven como zona en cada nivel de municipios, en el orden de
 * `NIVELES_DE_MUNICIPIOS`. Todos tienen `MINIMO_DE_ZONA` emplazamientos o más. En los niveles de
 * municipios grandes, además, los habitantes de `HABITANTES_DE_ZONA`, midan lo que midan: la lista
 * del 9 está dentro de la del 10. En los demás, con su etiqueta, no miden más de
 * `LADO_MAXIMO_DE_ZONA` en ese nivel; al acercar un nivel todo mide el doble, así que la lista del
 * 12 está dentro de la del 11. Es una función pura.
 */
export const zonasDeMunicipios = (
  emplazamientos: ReadonlyArray<ConMunicipio>,
  municipios: ReadonlyArray<EtiquetaDeMunicipio>,
): ReadonlyArray<ReadonlySet<string>> => {
  const etiquetas = new Map(municipios.map((m) => [m.codigo, m.etiqueta]));
  const habitantes = new Map(municipios.map((m) => [m.codigo, m.habitantes ?? 0]));
  const extensiones = new Map<string, Extension>();
  const anadir = (codigo: string, { longitud, latitud }: Coordenada, cuenta: boolean) => {
    const y = mercatorY(latitud);
    const e = extensiones.get(codigo);
    if (e === undefined) {
      extensiones.set(codigo, {
        cuantos: cuenta ? 1 : 0,
        oeste: longitud,
        este: longitud,
        arriba: y,
        abajo: y,
      });
      return;
    }
    if (cuenta) e.cuantos += 1;
    e.oeste = Math.min(e.oeste, longitud);
    e.este = Math.max(e.este, longitud);
    e.arriba = Math.min(e.arriba, y);
    e.abajo = Math.max(e.abajo, y);
  };
  for (const { municipio, posicion } of emplazamientos) {
    if (municipio === null || municipio === undefined || !etiquetas.has(municipio)) continue;
    anadir(municipio, posicion, true);
  }
  for (const [codigo, extension] of extensiones) {
    const etiqueta = etiquetas.get(codigo);
    if (etiqueta !== undefined && extension.cuantos >= MINIMO_DE_ZONA) {
      anadir(codigo, etiqueta, false);
    }
  }
  return NIVELES_DE_MUNICIPIOS.map((nivel) => {
    const minimo = HABITANTES_DE_ZONA.get(nivel);
    const escala = MUNDO * 2 ** nivel;
    const zonas = new Set<string>();
    for (const [codigo, e] of extensiones) {
      if (e.cuantos < MINIMO_DE_ZONA) continue;
      if (minimo !== undefined) {
        if ((habitantes.get(codigo) ?? 0) >= minimo) zonas.add(codigo);
        continue;
      }
      const ancho = ((e.este - e.oeste) / 360) * escala;
      const alto = (e.abajo - e.arriba) * escala;
      if (Math.max(ancho, alto) <= LADO_MAXIMO_DE_ZONA) zonas.add(codigo);
    }
    return zonas;
  });
};
