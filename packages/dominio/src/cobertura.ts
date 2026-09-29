import * as Schema from "effect/Schema";

import { type Coordenada, distanciaAlRectangulo, type Rectangulo } from "./area.ts";
import { Caja, type Cuadro, cajaDeCuadro, cuadroDe, ZONAS_DE_BARRIDO } from "./barrido.ts";
import { type IndiceDeMunicipios, municipioDelPunto } from "./municipio.ts";

/**
 * Hasta dónde llegan los datos de Celda (ADR 0014 y 0016). La ingesta lee entero el registro
 * oficial dentro de unas zonas de barrido: dentro de sus cajas el mapa tiene todos los
 * emplazamientos del registro, y fuera no tiene ninguno. Una provincia está cubierta cuando se han
 * barrido todos los cuadros con datos que la tocan; si solo se ha barrido una parte, sus
 * emplazamientos de esa parte están todos, pero su número no es el de la provincia.
 */

/** Una zona de barrido tal como se publica, con la fecha de su último barrido completo. */
export const ZonaBarrida = Schema.Struct({
  /** Cómo la llama la configuración de la ingesta, por ejemplo `cataluna`. */
  nombre: Schema.String,
  /** Cómo se lee, por ejemplo «Cataluña». */
  titulo: Schema.String,
  /** Lo que se barre, en cajas que no se solapan: los cuadros de la zona. */
  cajas: Schema.Array(Caja),
  /** Inicio del último barrido completo, en milisegundos, o `null` si aún no se ha acabado ninguno. */
  barrido: Schema.NullOr(Schema.Finite),
});
export type ZonaBarrida = typeof ZonaBarrida.Type;

/** Una caja como rectángulo entre dos esquinas. */
export const rectanguloDeCaja = ([oeste, sur, este, norte]: Caja): Rectangulo => ({
  suroeste: { longitud: oeste, latitud: sur },
  noreste: { longitud: este, latitud: norte },
});

/** Un rectángulo como caja. */
export const cajaDeRectangulo = (rectangulo: Rectangulo): Caja => [
  rectangulo.suroeste.longitud,
  rectangulo.suroeste.latitud,
  rectangulo.noreste.longitud,
  rectangulo.noreste.latitud,
];

/** Si dos rectángulos se tocan, bordes incluidos. */
export const seCortan = (a: Rectangulo, b: Rectangulo): boolean =>
  a.suroeste.longitud <= b.noreste.longitud &&
  b.suroeste.longitud <= a.noreste.longitud &&
  a.suroeste.latitud <= b.noreste.latitud &&
  b.suroeste.latitud <= a.noreste.latitud;

/** Si la caja `dentro` cae entera en `fuera`. */
const contieneCaja = ([o, s, e, n]: Caja, [od, sd, ed, nd]: Caja): boolean =>
  od >= o && sd >= s && ed <= e && nd <= n;

/**
 * A cuántos metros queda un punto de lo barrido: 0 si cae en alguna caja de una zona con algún
 * barrido completo. Sin ninguna, `undefined`: no se sabe hasta dónde llegan los datos.
 */
export const distanciaALoBarrido = (
  punto: Coordenada,
  cobertura: ReadonlyArray<ZonaBarrida>,
): number | undefined => {
  let minima: number | undefined;
  for (const zona of cobertura) {
    if (zona.barrido === null) continue;
    for (const caja of zona.cajas) {
      const metros = distanciaAlRectangulo(punto, rectanguloDeCaja(caja));
      minima = minima === undefined ? metros : Math.min(minima, metros);
    }
  }
  return minima;
};

/** Los cuadros con algún dato en toda España: los de las zonas de barrido del ADR 0014. */
const CUADROS_CON_DATOS: ReadonlySet<Cuadro> = new Set(ZONAS_DE_BARRIDO.flatMap((z) => z.cuadros));

/** Lo ya calculado, por la huella de los límites: publicar lo pide en cada noche. */
const cuadrosCalculados = new Map<string, ReadonlyMap<string, ReadonlySet<Cuadro>>>();

/**
 * Los cuadros con datos que toca cada provincia: los que tienen algún vértice de sus límites o
 * alguna esquina dentro de ella. Un recinto que cabe en un solo cuadro no hace falta recorrerlo.
 * Los límites están simplificados a 50 m, así que un cuadro que la provincia solo roza a menos de
 * eso puede quedar fuera. Con los límites de toda España se calcula una vez por huella.
 */
export const cuadrosDeProvincias = (
  indice: IndiceDeMunicipios,
  conDatos: ReadonlySet<Cuadro> = CUADROS_CON_DATOS,
): ReadonlyMap<string, ReadonlySet<Cuadro>> => {
  const clave = `${indice.fuente.huella}:${indice.territorios.length}`;
  const guardados = conDatos === CUADROS_CON_DATOS ? cuadrosCalculados.get(clave) : undefined;
  if (guardados !== undefined) return guardados;
  const porProvincia = new Map<string, Set<Cuadro>>();
  const anotar = (provincia: string, cuadro: Cuadro) => {
    if (!conDatos.has(cuadro)) return;
    const suyos = porProvincia.get(provincia) ?? new Set<Cuadro>();
    suyos.add(cuadro);
    porProvincia.set(provincia, suyos);
  };
  for (const [i, territorio] of indice.territorios.entries()) {
    const provincia = territorio.provincia;
    if (provincia === null) continue;
    const k = i * 4;
    const suroeste = cuadroDe({
      longitud: indice.cajas[k] ?? 0,
      latitud: indice.cajas[k + 1] ?? 0,
    });
    const noreste = cuadroDe({
      longitud: indice.cajas[k + 2] ?? 0,
      latitud: indice.cajas[k + 3] ?? 0,
    });
    if (suroeste === noreste) {
      anotar(provincia, suroeste);
      continue;
    }
    for (const poligono of indice.poligonosDe(i)) {
      for (const [longitud = 0, latitud = 0] of poligono[0] ?? []) {
        anotar(provincia, cuadroDe({ longitud, latitud }));
      }
    }
  }
  // Un cuadro entero dentro de un recinto grande no tiene vértices: se mira por sus esquinas.
  for (const cuadro of conDatos) {
    const [oeste, sur, este, norte] = cajaDeCuadro(cuadro);
    for (const [longitud, latitud] of [
      [oeste, sur],
      [este, sur],
      [oeste, norte],
      [este, norte],
    ] as const) {
      const { provincia } = municipioDelPunto({ longitud, latitud }, indice);
      if (provincia !== undefined) anotar(provincia.codigo, cuadro);
    }
  }
  if (conDatos === CUADROS_CON_DATOS) cuadrosCalculados.set(clave, porProvincia);
  return porProvincia;
};

/** Lo que el resumen dice de una provincia según la cobertura. */
export interface CoberturaDeProvincia {
  /** Si se han barrido todos los cuadros con datos que la tocan. */
  readonly cubierta: boolean;
  /**
   * El último barrido completo de lo que se sabe de ella: el más reciente de las zonas que barren
   * entero alguno de sus cuadros o que tocan la caja de sus emplazamientos. `null` si ninguna.
   */
  readonly barrido: number | null;
}

/**
 * Si una provincia está cubierta y cuándo se barrió por última vez, con los cuadros con datos que
 * la tocan (`cuadrosDeProvincias`) y la caja de sus emplazamientos. Una provincia sin ningún
 * cuadro con datos no está cubierta: no se sabe nada de ella.
 */
export const coberturaDeProvincia = (
  cuadros: ReadonlySet<Cuadro>,
  caja: Rectangulo | undefined,
  cobertura: ReadonlyArray<ZonaBarrida>,
): CoberturaDeProvincia => {
  const barridas = cobertura.filter((zona) => zona.barrido !== null);
  const barreEntero = (zona: ZonaBarrida, cuadro: Cuadro) =>
    zona.cajas.some((c) => contieneCaja(c, cajaDeCuadro(cuadro)));
  const barrido = (cuadro: Cuadro) => barridas.some((zona) => barreEntero(zona, cuadro));
  let ultimo: number | null = null;
  for (const zona of barridas) {
    const concierne =
      [...cuadros].some((cuadro) => barreEntero(zona, cuadro)) ||
      (caja !== undefined && zona.cajas.some((c) => seCortan(rectanguloDeCaja(c), caja)));
    if (concierne && zona.barrido !== null) {
      ultimo = Math.max(ultimo ?? zona.barrido, zona.barrido);
    }
  }
  return { cubierta: cuadros.size > 0 && [...cuadros].every(barrido), barrido: ultimo };
};
