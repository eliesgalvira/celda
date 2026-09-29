import type { Coordenada } from "@celda/dominio/area";
import type { Banda } from "@celda/dominio/banda";
import { type Cuadro, cuadroDe, ZONAS_DE_BARRIDO } from "@celda/dominio/barrido";
import type { Compania } from "@celda/dominio/compania";
import { municipiosConHabitantes } from "@celda/dominio/municipio";
import {
  type FuenteGrabada,
  geoportalGrabado,
  muestraCampusNord,
} from "@celda/ingesta/pruebas/grabado";
import { listadoDeElementos } from "@celda/ingesta/registro-oficial/normalizar";
import type { ZonasDePublicacion } from "@celda/publicacion/zonas";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Una España sintética a escala del registro oficial (#50), para probar y medir la ingesta
 * nocturna con toda España sin pedir nada al geoportal.
 *
 * Los registros tienen la forma real: cada emplazamiento sintético copia un emplazamiento de los
 * listados grabados de Barcelona y de Valencia (`muestras/espana/listado-*`), con sus razones
 * sociales, sus códigos, su dirección y cuántas compañías comparten el punto. Los códigos llevan
 * un sufijo para no repetirse, y la dirección, el municipio y la provincia de su sitio nuevo.
 * Todo pasa después por el normalizador del extractor, como un listado de verdad.
 *
 * Los registros de cada zona de barrido son los previstos en la investigación 08, con la
 * corrección de su muestreo, y los de Cataluña los de su primera pasada real. Dentro de cada zona
 * se reparten por municipios, con un peso que crece con los habitantes del padrón más despacio que
 * ellos: las ciudades tienen más emplazamientos pero menos por habitante, como en el registro. Con
 * el exponente elegido, el cuadro de Barcelona (`2,41`) lleva la mitad de los de Cataluña, como en
 * la pasada real. Cada ficha da las bandas de una ficha grabada del Campus Nord de su compañía.
 */

/**
 * Registros del listado por zona de barrido: los de Cataluña salen de su primera pasada real
 * (29/09/2026); los demás, de la densidad de antenasmoviles.es con el 0,7 % de más que dio el
 * muestreo del 28/09 (investigación 08). Suman unos 69.800.
 */
export const REGISTROS_POR_ZONA = new Map([
  ["cataluna", 10_305],
  ["centro", 12_316],
  ["andalucia", 11_430],
  ["levante", 10_784],
  ["norte", 9_554],
  ["ebro-y-duero", 10_115],
  ["oeste-y-canarias", 5_266],
]);

/** Cómo crece el peso de un municipio con sus habitantes (ver arriba). */
const EXPONENTE = 0.8;

/** Kilómetros en un grado de latitud. */
const KM_POR_GRADO = 111.195;

/** Un emplazamiento de los listados grabados: sus elementos, tal como llegaron, en un punto. */
interface Plantilla {
  readonly elementos: ReadonlyArray<ElementoCrudo>;
}

/** Un elemento del listado tal como lo manda el geoportal. */
const ElementoCrudo = Schema.Struct({
  id: Schema.String,
  geometry: Schema.Struct({ coordinates: Schema.Tuple([Schema.Finite, Schema.Finite]) }),
  properties: Schema.Struct({ Gis_ID: Schema.String, Dirección: Schema.String }),
});
type ElementoCrudo = typeof ElementoCrudo.Type;
const decodificarElemento = Schema.decodeUnknownEffect(ElementoCrudo);

/** Generador congruencial: la misma semilla da siempre la misma España. */
const generador = (semilla: number) => {
  let estado = semilla >>> 0;
  const azar = () => {
    estado = (Math.imul(estado, 1_664_525) + 1_013_904_223) >>> 0;
    return estado / 2 ** 32;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(azar() + 1e-12)) * Math.cos(2 * Math.PI * azar());
  return { azar, gauss };
};

/** Índice de `pesos` elegido al azar con probabilidad proporcional a su peso. */
const eleccionPonderada = (pesos: ReadonlyArray<number>) => {
  const acumulados: Array<number> = [];
  let suma = 0;
  for (const peso of pesos) acumulados.push((suma += peso));
  return (azar: number): number => {
    const objetivo = azar * suma;
    let [bajo, alto] = [0, acumulados.length - 1];
    while (bajo < alto) {
      const medio = (bajo + alto) >> 1;
      if ((acumulados[medio] ?? 0) <= objetivo) bajo = medio + 1;
      else alto = medio;
    }
    return bajo;
  };
};

/** Los emplazamientos de un listado grabado: sus elementos agrupados por punto exacto. */
const plantillasDe = (nombre: string) =>
  Effect.gen(function* () {
    const { elementos } = yield* geoportalGrabado(nombre);
    const porPunto = new Map<string, Array<ElementoCrudo>>();
    for (const elemento of elementos) {
      const clave = `${elemento.longitud},${elemento.latitud}`;
      const suyos = porPunto.get(clave) ?? [];
      suyos.push(yield* decodificarElemento(elemento.crudo));
      porPunto.set(clave, suyos);
    }
    return [...porPunto.values()].map((suyos): Plantilla => ({ elementos: suyos }));
  });

/** Bandas de las fichas grabadas del Campus Nord, por compañía, sin las fichas vacías. */
const bandasPorCompania = Effect.map(muestraCampusNord, (grabada) => {
  const porCompania = new Map<Compania, Array<ReadonlyArray<Banda>>>();
  for (const registro of grabada.listado.registros) {
    const bandas = grabada.fichas.get(registro.clave) ?? [];
    if (bandas.length === 0) continue;
    const suyas = porCompania.get(registro.compania) ?? [];
    suyas.push(bandas);
    porCompania.set(registro.compania, suyas);
  }
  return porCompania;
});

/** Lo que da `espanaSintetica`: la fuente grabada y cuántos registros tiene cada zona. */
export interface EspanaSintetica extends FuenteGrabada {
  readonly porZona: ReadonlyMap<string, number>;
  readonly porCuadro: ReadonlyMap<Cuadro, number>;
}

/**
 * El registro oficial de una España sintética: el listado y la ficha de cada registro. Con
 * `escala` menor que 1 salen menos registros por zona, con el mismo reparto.
 */
export const espanaSintetica = (
  zonas: ZonasDePublicacion,
  opciones: { readonly escala?: number; readonly semilla?: number } = {},
) =>
  Effect.gen(function* () {
    const { azar, gauss } = generador(opciones.semilla ?? 50);
    const escala = opciones.escala ?? 1;
    const plantillas = [
      ...(yield* plantillasDe("barcelona")),
      ...(yield* plantillasDe("valencia-centro")),
    ];
    const bandas = yield* bandasPorCompania;
    const habitantes = municipiosConHabitantes(
      { territorios: zonas.municipios.territorios },
      zonas.padron,
    );
    const nombreDeProvincia = (codigo: string) =>
      zonas.municipios.provincias.get(codigo)?.nombre.toUpperCase() ?? "";

    const elementos: Array<ElementoCrudo> = [];
    const porZona = new Map<string, number>();
    let sitio = 0;
    for (const zona of ZONAS_DE_BARRIDO) {
      const suyos = new Set<Cuadro>(zona.cuadros);
      const municipios = habitantes.filter((m) => suyos.has(cuadroDe(m.etiqueta)));
      const elegir = eleccionPonderada(municipios.map((m) => (m.habitantes ?? 50) ** EXPONENTE));
      const objetivo = Math.round((REGISTROS_POR_ZONA.get(zona.nombre) ?? 0) * escala);
      let cuantos = 0;
      while (cuantos < objetivo) {
        const municipio = municipios[elegir(azar())];
        const plantilla = plantillas[Math.floor(azar() * plantillas.length)];
        if (municipio === undefined || plantilla === undefined) break;
        // Alrededor del centro del municipio, más lejos cuanto más grande es.
        const km = Math.max(0.3, Math.sqrt(municipio.areaKm2) / 4);
        let posicion: Coordenada = municipio.etiqueta;
        for (let intento = 0; intento < 5; intento++) {
          const candidata = {
            longitud:
              municipio.etiqueta.longitud +
              (gauss() * km) /
                (KM_POR_GRADO * Math.cos((municipio.etiqueta.latitud * Math.PI) / 180)),
            latitud: municipio.etiqueta.latitud + (gauss() * km) / KM_POR_GRADO,
          };
          if (suyos.has(cuadroDe(candidata))) {
            posicion = candidata;
            break;
          }
        }
        const sufijo = `S${sitio.toString(36).toUpperCase()}`;
        const lugar = `${municipio.nombre.toUpperCase()}, ${nombreDeProvincia(municipio.provincia)}`;
        for (const elemento of plantilla.elementos.slice(0, objetivo - cuantos)) {
          const separador = elemento.id.lastIndexOf(" - ");
          const titular = elemento.id.slice(0, separador);
          const codigo = `${elemento.properties.Gis_ID.trim()}${sufijo}`;
          const via = elemento.properties.Dirección.split(". ")[0] ?? "";
          elementos.push({
            id: `${titular} - ${codigo}`,
            geometry: {
              coordinates: [
                Math.round(posicion.longitud * 1e6) / 1e6,
                Math.round(posicion.latitud * 1e6) / 1e6,
              ],
            },
            properties: { Gis_ID: codigo, Dirección: `${via}. ${lugar}` },
          });
          cuantos++;
        }
        sitio++;
      }
      porZona.set(zona.nombre, cuantos);
    }

    const listado = listadoDeElementos(elementos);
    const fichas = new Map<string, ReadonlyArray<Banda>>();
    const porCuadro = new Map<Cuadro, number>();
    for (const [i, registro] of listado.registros.entries()) {
      const suyas = bandas.get(registro.compania) ?? [];
      fichas.set(registro.clave, suyas[i % Math.max(suyas.length, 1)] ?? []);
      const cuadro = cuadroDe(registro.posicion);
      porCuadro.set(cuadro, (porCuadro.get(cuadro) ?? 0) + 1);
    }
    const espana: EspanaSintetica = { listado, fichas, porZona, porCuadro };
    return espana;
  });
