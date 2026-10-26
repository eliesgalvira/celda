/**
 * Los emplazamientos más cercanos a un punto, sacados de la publicación vigente (ADR 0032). Es
 * una función pura: recibe el resumen y las capas de provincia ya leídas y no pide nada.
 */
import * as DateTime from "effect/DateTime";

import {
  distanciaAlRectangulo,
  distanciaMetros,
  type Coordenada,
} from "../../../../packages/dominio/src/area.ts";
import { LICENCIAS, type Licencias } from "../../../../packages/dominio/src/licencias.ts";
import type {
  CapaDeProvincia,
  ProvinciaDelResumen,
  ResumenLeido,
} from "../../../../packages/dominio/src/provincias.ts";
import type { Consulta } from "./consulta.ts";
import type { EmplazamientoCercano, RespuestaDeCercanos } from "./respuesta.ts";

/**
 * Las provincias del resumen que pueden tener emplazamientos a `radioMetros` metros del punto o
 * menos.
 */
export const provinciasDelCirculo = (
  resumen: ResumenLeido,
  punto: Coordenada,
  radioMetros: number,
): ReadonlyArray<ProvinciaDelResumen & { readonly fichero: string }> =>
  resumen.provincias.flatMap((provincia) =>
    provincia.fichero !== undefined &&
    provincia.caja !== undefined &&
    distanciaAlRectangulo(punto, provincia.caja) <= radioMetros
      ? [{ ...provincia, fichero: provincia.fichero }]
      : [],
  );

/** Por debajo de este radio sin unidad, la consulta pudo pensar en kilómetros. */
export const RADIO_QUE_PARECE_KM = 100;

/**
 * El aviso de un radio sin unidad tan pequeño que parece de kilómetros, si no ha encontrado nada:
 * `radio=15` son 15 m, y un agente que quería 15 km recibía 0 emplazamientos sin saber por qué.
 */
const avisoDelRadio = (consulta: Consulta, total: number): string | undefined =>
  consulta.radioSinUnidad && consulta.radioMetros < RADIO_QUE_PARECE_KM && total === 0
    ? `El radio va en metros: radio=${consulta.radioMetros} busca a ${consulta.radioMetros} m. Para kilómetros, escribe la unidad, como radio=${consulta.radioMetros}km.`
    : undefined;

const porCercania = (a: EmplazamientoCercano, b: EmplazamientoCercano): number =>
  a.distanciaMetros - b.distanciaMetros || (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0);

/**
 * Los emplazamientos de las capas a `consulta.radioMetros` metros o menos, con alguna compañía del
 * filtro, del más cercano al más lejano y hasta `consulta.limite`. `capas` son las de
 * `provinciasDelCirculo`, todas de la versión del resumen; `origen` es el de la web, sin barra
 * final, para los enlaces.
 */
export const cercanos = (
  consulta: Consulta,
  resumen: ResumenLeido,
  capas: ReadonlyArray<CapaDeProvincia>,
  origen: string,
  licencias: Licencias = LICENCIAS,
): RespuestaDeCercanos => {
  const punto: Coordenada = { longitud: consulta.longitud, latitud: consulta.latitud };
  const nombreDeProvincia = new Map(resumen.provincias.map((p) => [p.codigo, p.nombre]));
  const dentro: Array<EmplazamientoCercano> = [];
  for (const capa of capas) {
    const municipios = new Map(capa.municipios.map((m) => [m.codigo, m.nombre]));
    const provincia = {
      codigo: capa.provincia,
      nombre: nombreDeProvincia.get(capa.provincia) ?? "",
    };
    for (const emplazamiento of capa.emplazamientos) {
      const distancia = distanciaMetros(punto, emplazamiento.posicion);
      if (distancia > consulta.radioMetros) continue;
      if (
        consulta.companias.length > 0 &&
        !emplazamiento.companias.some((c) => consulta.companias.includes(c))
      ) {
        continue;
      }
      const lote = capa.lotes[emplazamiento.lote ?? -1] ?? "";
      const codigoMunicipio = emplazamiento.municipio ?? null;
      dentro.push({
        clave: emplazamiento.clave,
        posicion: emplazamiento.posicion,
        distanciaMetros: Math.round(distancia),
        estado: emplazamiento.estado,
        companias: emplazamiento.companias,
        bandas: emplazamiento.bandas ?? [],
        municipio:
          codigoMunicipio === null
            ? null
            : { codigo: codigoMunicipio, nombre: municipios.get(codigoMunicipio) ?? "" },
        provincia,
        ficha: `${origen}/capas/${lote}`,
        // La dirección de `ruta.emplazamiento` (`src/lib/rutas.ts`), que no se puede importar
        // aquí: lee `window` al cargarse.
        enlace: `${origen}/?emplazamiento=${encodeURIComponent(emplazamiento.clave)}&provincia=${capa.provincia}`,
      });
    }
  }
  dentro.sort(porCercania);
  const respuesta: RespuestaDeCercanos = {
    version: resumen.version,
    fecha: DateTime.formatIso(DateTime.makeUnsafe(resumen.fecha)),
    consulta: {
      lat: consulta.latitud,
      lon: consulta.longitud,
      radioMetros: consulta.radioMetros,
      companias: consulta.companias,
      limite: consulta.limite,
    },
    total: dentro.length,
    hayMas: dentro.length > consulta.limite,
    emplazamientos: dentro.slice(0, consulta.limite),
    licencias,
  };
  const aviso = avisoDelRadio(consulta, dentro.length);
  return aviso === undefined ? respuesta : { ...respuesta, aviso };
};
