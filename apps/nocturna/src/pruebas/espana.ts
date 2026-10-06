import type { Coordenada } from "@celda/dominio/area";
import type { Banda } from "@celda/dominio/banda";
import { type Cuadro, cajaDeCuadro, cuadroDe } from "@celda/dominio/barrido";
import type { Compania } from "@celda/dominio/compania";
import { cuadrosDelRegistro } from "@celda/dominio/cuadrosDelRegistro";
import { type MunicipioConHabitantes, municipiosConHabitantes } from "@celda/dominio/municipio";
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
 * Cada cuadro de 1° lleva los registros que tiene en el listado propio del registro oficial de
 * toda España (`cuadrosDelRegistro`, 69.612 el 29/09/2026), así que cada zona de barrido lleva los
 * suyos. Dentro de cada cuadro se reparten por los municipios cuya etiqueta cae en él, con un peso
 * que crece con los habitantes del padrón más despacio que ellos: las ciudades tienen más
 * emplazamientos pero menos por habitante, como en el registro. Un cuadro sin ninguna etiqueta,
 * como el del norte de Menorca, usa los municipios más cercanos de sus provincias y pone sus
 * emplazamientos en su borde. Cada ficha da las bandas de una ficha grabada del Campus Nord de su
 * compañía.
 */

/** Cómo crece el peso de un municipio con sus habitantes (ver arriba). */
const EXPONENTE = 0.8;

/** Kilómetros en un grado de latitud. */
const KM_POR_GRADO = 111.195;

/** Municipios que usa un cuadro sin ninguna etiqueta: los más cercanos de sus provincias. */
const CERCANOS = 3;

/** Grados que se aparta del borde un punto que se mete en un cuadro desde fuera. */
const MARGEN = 0.01;

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
      zonas.capitales,
    );
    const nombreDeProvincia = (codigo: string) =>
      zonas.municipios.provincias.get(codigo)?.nombre.toUpperCase() ?? "";

    const porEtiqueta = new Map<Cuadro, Array<MunicipioConHabitantes>>();
    for (const municipio of habitantes) {
      const cuadro = cuadroDe(municipio.etiqueta);
      const suyos = porEtiqueta.get(cuadro) ?? [];
      suyos.push(municipio);
      porEtiqueta.set(cuadro, suyos);
    }

    const elementos: Array<ElementoCrudo> = [];
    const porZona = new Map<string, number>();
    let sitio = 0;
    for (const cuadro of (yield* cuadrosDelRegistro).cuadros) {
      const [oeste, sur, este, norte] = cajaDeCuadro(cuadro.cuadro);
      // Dentro del cuadro, a `MARGEN` de su borde.
      const meter = ({ longitud, latitud }: Coordenada): Coordenada => ({
        longitud: Math.min(Math.max(longitud, oeste + MARGEN), este - MARGEN),
        latitud: Math.min(Math.max(latitud, sur + MARGEN), norte - MARGEN),
      });
      const distancia = (m: MunicipioConHabitantes) => {
        const dentro = meter(m.etiqueta);
        return Math.hypot(
          dentro.longitud - m.etiqueta.longitud,
          dentro.latitud - m.etiqueta.latitud,
        );
      };
      const municipios =
        porEtiqueta.get(cuadro.cuadro) ??
        habitantes
          .filter((m) => m.provincia in cuadro.porProvincia)
          .toSorted((a, b) => distancia(a) - distancia(b))
          .slice(0, CERCANOS);
      const elegir = eleccionPonderada(municipios.map((m) => (m.habitantes ?? 50) ** EXPONENTE));
      const objetivo = Math.round(cuadro.registros * escala);
      let cuantos = 0;
      while (cuantos < objetivo) {
        const municipio = municipios[elegir(azar())];
        const plantilla = plantillas[Math.floor(azar() * plantillas.length)];
        if (municipio === undefined || plantilla === undefined) break;
        // Alrededor del centro del municipio, más lejos cuanto más grande es.
        const km = Math.max(0.3, Math.sqrt(municipio.areaKm2) / 4);
        const centro = meter(municipio.etiqueta);
        let posicion: Coordenada = centro;
        for (let intento = 0; intento < 5; intento++) {
          const candidata = {
            longitud:
              centro.longitud +
              (gauss() * km) / (KM_POR_GRADO * Math.cos((centro.latitud * Math.PI) / 180)),
            latitud: centro.latitud + (gauss() * km) / KM_POR_GRADO,
          };
          if (cuadroDe(candidata) === cuadro.cuadro) {
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
      porZona.set(cuadro.zona, (porZona.get(cuadro.zona) ?? 0) + cuantos);
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
