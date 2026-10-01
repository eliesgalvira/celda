import type { Coordenada } from "@celda/dominio/area";

/**
 * Qué municipios se ven como zona en cada nivel de municipios (ADR 0017, #44 y su corrección). Lo
 * usan el Worker, que indexa aparte los emplazamientos que no van en zona, y el agrupador, que
 * dibuja las zonas: los dos tienen que decir lo mismo.
 */

/**
 * Nivel en que los emplazamientos de Barcelona se agrupan por barrio: del zoom 13 al 14. Más
 * lejos, los 73 barrios no caben en la pantalla, y las agrupaciones del nivel 12 ya son más
 * grandes que un barrio. Más cerca, las del nivel 14 son más pequeñas. Así, al alejar, cada paso
 * recoge lo del anterior.
 */
export const NIVEL_DE_BARRIOS = 13;

/**
 * Primer nivel en que los emplazamientos se pueden recoger por municipio: los del zoom 11 al 13,
 * justo antes del de barrios. En el 10, con los datos de Cataluña, se verían unas 180 zonas en la
 * pantalla de un móvil alrededor de Barcelona; en el 11, unas 60, como los barrios en el suyo.
 */
export const NIVEL_DE_MUNICIPIOS = 11;

/** Los niveles de municipios, del más lejano al más cercano. */
export const NIVELES_DE_MUNICIPIOS: ReadonlyArray<number> = Array.from(
  { length: NIVEL_DE_BARRIOS - NIVEL_DE_MUNICIPIOS },
  (_, i) => NIVEL_DE_MUNICIPIOS + i,
);

/** Si un nivel es de municipios: del `NIVEL_DE_MUNICIPIOS` al de barrios, sin él. */
export const esNivelDeMunicipios = (nivel: number): boolean =>
  nivel >= NIVEL_DE_MUNICIPIOS && nivel < NIVEL_DE_BARRIOS;

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

/** El tamaño del mundo en píxeles a zoom 0, con teselas de 512 como MapLibre y supercluster. */
const MUNDO = 512;

const yMercator = (latitud: number): number => {
  const seno = Math.sin((latitud * Math.PI) / 180);
  return 0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI);
};

/** Lo que el criterio necesita de cada emplazamiento. */
export interface ConMunicipio {
  readonly posicion: Coordenada;
  /** `null` sin municipio; sin la clave, una capa de antes del formato 5. */
  readonly municipio?: string | null;
}

/** Lo que el criterio necesita de cada municipio: dónde va su etiqueta. */
export interface EtiquetaDeMunicipio {
  readonly codigo: string;
  readonly etiqueta: Coordenada;
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
 * `NIVELES_DE_MUNICIPIOS`: los que tienen `MINIMO_DE_ZONA` emplazamientos o más y, con su etiqueta,
 * no miden más de `LADO_MAXIMO_DE_ZONA` en ese nivel. Al acercar un nivel todo mide el doble, así
 * que la lista del 12 está dentro de la del 11. Es una función pura.
 */
export const zonasDeMunicipios = (
  emplazamientos: ReadonlyArray<ConMunicipio>,
  municipios: ReadonlyArray<EtiquetaDeMunicipio>,
): ReadonlyArray<ReadonlySet<string>> => {
  const etiquetas = new Map(municipios.map((m) => [m.codigo, m.etiqueta]));
  const extensiones = new Map<string, Extension>();
  const anadir = (codigo: string, { longitud, latitud }: Coordenada, cuenta: boolean) => {
    const y = yMercator(latitud);
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
    const escala = MUNDO * 2 ** nivel;
    const zonas = new Set<string>();
    for (const [codigo, e] of extensiones) {
      if (e.cuantos < MINIMO_DE_ZONA) continue;
      const ancho = ((e.este - e.oeste) / 360) * escala;
      const alto = (e.abajo - e.arriba) * escala;
      if (Math.max(ancho, alto) <= LADO_MAXIMO_DE_ZONA) zonas.add(codigo);
    }
    return zonas;
  });
};
