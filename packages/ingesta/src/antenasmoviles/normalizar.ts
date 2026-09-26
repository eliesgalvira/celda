import type { Coordenada } from "@celda/dominio/area";
import { compararTexto } from "@celda/dominio/banda";
import type { Compania } from "@celda/dominio/compania";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { DetalleDePunto, ListadoDePuntos, ObservacionDePunto, Punto } from "../extractor.ts";
import { huella } from "../huella.ts";
import { companiaDeTitular, municipioDeDireccion } from "../registro-oficial/normalizar.ts";
import { repararTexto } from "../texto.ts";
import { type Caja, enCaja } from "../zona.ts";

export const ORIGEN = "https://antenasmoviles.es";

/** Todos los marcadores de España, con las estaciones ER5 que añaden los usuarios. */
export const URL_LISTADO = `${ORIGEN}/v1/showf?er5`;

/** El detalle de un marcador: se pide con todos sus códigos, como hace la web. */
export const urlDeDetalle = (codigos: ReadonlyArray<string>): string =>
  `${ORIGEN}/v1/markers?id=${codigos.map(encodeURIComponent).join(",")}`;

/**
 * Enlace a un punto en el mapa de antenasmoviles.es. La web no tiene una página por
 * emplazamiento: este enlace centra su mapa ahí, y la persona pulsa el marcador.
 */
export const enlaceDelMapa = (posicion: Coordenada): string =>
  `${ORIGEN}/#19/${posicion.latitud.toFixed(6)}/${posicion.longitud.toFixed(6)}`;

/**
 * Código de red de antenasmoviles.es y su compañía, según `ispName()` de su portada. Las ER5
 * lo llevan detrás de `er5_`.
 */
const COMPANIA_DE_OPERADOR: ReadonlyMap<string, Compania> = new Map([
  ["1", "vodafone"],
  ["3", "orange"],
  ["4", "yoigo"],
  ["7", "movistar"],
  ["22", "digi"],
]);

export const companiaDeOperador = (operador: string): Compania | undefined =>
  COMPANIA_DE_OPERADOR.get(operador.trim().replace(/^er5_?/u, ""));

/** Una ER5 es una estación que el registro oficial no publica y han añadido los usuarios. */
const esEr5 = (operador: string): boolean => operador.trim().startsWith("er5");

const NUMERO = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;

/**
 * Principio de una fila del listado: `[lat,lon,[`. Las listas de dentro de una fila son de
 * textos, así que solo las filas empiezan por dos números. Hay coordenadas con exponente
 * (`-2.2e-5`).
 */
const INICIO_DE_FILA = new RegExp(String.raw`\[(${NUMERO}),(${NUMERO}),\[`, "gu");

/** `[lat, lon, [códigos], operadores, {OP: [bandas]}]`. Las ER5 llevan `""` en lugar de bandas. */
const FilaEnJson = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Finite,
    Schema.Finite,
    Schema.Array(Schema.String),
    Schema.String,
    Schema.Union([Schema.Record(Schema.String, Schema.Array(Schema.String)), Schema.String]),
  ]),
);
const decodificarFila = Schema.decodeUnknownOption(FilaEnJson);

/** Si la respuesta es una página HTML, como el desafío de Cloudflare, y no los datos. */
export const esHtml = (texto: string): boolean => texto.trimStart().startsWith("<");

/**
 * Los puntos de `zona` en el listado de toda España. Solo analiza las filas de la zona: el
 * listado ocupa unos 4 MB y el runtime de Convex tiene poca memoria. La huella de cada punto
 * es la de su fila tal como llega, así que cualquier cambio en sus códigos, compañías o bandas
 * la cambia. Salen ordenados por clave.
 */
export const puntosDeListado = (
  texto: string,
  zona: Caja,
): Result.Result<ListadoDePuntos & { readonly filas: number }, string> => {
  if (esHtml(texto)) {
    return Result.fail("la fuente ha devuelto una página HTML en lugar del listado");
  }
  if (!texto.trimStart().startsWith("[")) {
    return Result.fail("el listado no es una lista JSON");
  }
  const inicios = [...texto.matchAll(INICIO_DE_FILA)];
  const puntos = new Map<string, Punto>();
  const avisos: Array<string> = [];
  inicios.forEach((inicio, i) => {
    const latitud = Number(inicio[1]);
    const longitud = Number(inicio[2]);
    if (!enCaja(zona, longitud, latitud)) {
      return;
    }
    // La fila acaba justo antes de la coma que la separa de la siguiente, o del `]` final.
    const fin = inicios[i + 1]?.index ?? texto.trimEnd().length;
    const trozo = texto.slice(inicio.index, fin - 1);
    const fila = decodificarFila(trozo);
    if (Option.isNone(fila)) {
      avisos.push(`Fila del listado con un formato desconocido: ${trozo.slice(0, 80)}`);
      return;
    }
    const [, , todos, operadores] = fila.value;
    const codigos = [...new Set(todos.map((c) => c.trim()).filter((c) => c !== ""))].sort(
      compararTexto,
    );
    const clave = codigos.join(",");
    if (codigos.length === 0 || puntos.has(clave)) {
      avisos.push(`Fila del listado sin códigos o repetida: ${trozo.slice(0, 80)}`);
      return;
    }
    puntos.set(clave, {
      clave,
      codigos,
      posicion: { longitud, latitud },
      huella: huella(trozo),
      // Las ER5 primero: son las correcciones que más se ven en el mapa.
      prioridad: esEr5(operadores) ? 0 : 1,
    });
  });
  return Result.succeed({
    puntos: [...puntos.values()].sort((a, b) => compararTexto(a.clave, b.clave)),
    avisos,
    filas: inicios.length,
  });
};

/** `[código de banda, código de emplazamiento, MHz, inactiva, primera, última, actualizada, operador]`. */
const FilaDeBanda = Schema.TupleWithRest(
  Schema.Tuple([Schema.String, Schema.String, Schema.String, Schema.Boolean]),
  [Schema.Unknown],
);

/**
 * Bandera de una foto. En las muestras siempre es `null`; el valor con la bandera puesta no
 * se ha visto, así que cuenta cualquiera que no sea nulo, vacío, cero o falso.
 */
const Bandera = Schema.NullOr(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]));

const Foto = Schema.Struct({
  fecha_foto: Schema.NullOr(Schema.String),
  desmantelada: Schema.optionalKey(Bandera),
});

/** Una estación base del detalle. Ver la investigación de fuentes comunitarias, apartado 1. */
const Estacion = Schema.TupleWithRest(
  Schema.Tuple([
    Schema.Array(Schema.String),
    Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.String]), [Schema.Unknown]),
    Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.Finite, Schema.Finite]), [
      Schema.Unknown,
    ]),
    Schema.Array(FilaDeBanda),
    Schema.Array(Foto),
  ]),
  [Schema.Unknown],
);
type Estacion = typeof Estacion.Type;

const DetalleEnJson = Schema.fromJsonString(Schema.Array(Estacion));
const decodificarDetalle = Schema.decodeUnknownResult(DetalleEnJson);

const activa = (bandera: typeof Bandera.Type | undefined): boolean =>
  bandera !== undefined &&
  bandera !== null &&
  bandera !== false &&
  bandera !== 0 &&
  !["", "0", "false"].includes(String(bandera).trim().toLowerCase());

/**
 * Si la comunidad da la estación por desmontada: la foto más reciente lleva la bandera
 * `desmantelada`. Una foto posterior sin ella dice que sigue ahí.
 */
const desmantelada = (fotos: Estacion[4]): boolean => {
  const [ultima] = fotos
    .slice()
    .sort((a, b) => compararTexto(b.fecha_foto ?? "", a.fecha_foto ?? ""));
  return ultima !== undefined && activa(ultima.desmantelada);
};

/**
 * Municipio de una dirección del registro («…. BARCELONA, BARCELONA») o de Nominatim, que usan
 * las ER5 («…, 08014 Barcelona»). Sale en mayúsculas, como en el registro.
 */
export const municipioDeLaFuente = (direccion: string): string => {
  const deNominatim = /\b\d{5}\s+([^,.]+)$/u.exec(direccion)?.[1];
  return deNominatim === undefined
    ? municipioDeDireccion(direccion)
    : deNominatim.trim().toUpperCase();
};

type LecturaDeEstacion =
  | { readonly tipo: "observaciones"; readonly observaciones: ReadonlyArray<ObservacionDePunto> }
  | { readonly tipo: "aviso"; readonly aviso: string };

/**
 * Lo que Celda toma de una estación: solo las correcciones al registro oficial. Una ER5 es una
 * estación que el registro no tiene (`presente`), salvo que la comunidad la dé por desmontada.
 * Una estación del registro solo cuenta si la comunidad la da por desmontada, con el primer
 * código que tiene bandas activas. El resto copia el registro y no se guarda.
 */
const lecturaDeEstacion = (estacion: Estacion): LecturaDeEstacion => {
  const [todos, [titular, operador], [textoDireccion, latitud, longitud], bandas, fotos] = estacion;
  const codigos = [...new Set(todos.map((c) => c.trim()).filter((c) => c !== ""))].sort(
    compararTexto,
  );
  const compania = companiaDeTitular(titular) ?? companiaDeOperador(operador);
  if (compania === undefined) {
    return { tipo: "aviso", aviso: `Compañía desconocida: ${titular} (${codigos.join(", ")})` };
  }
  const posicion = { longitud, latitud };
  const direccion = repararTexto(textoDireccion);
  const observacion = (codigo: string, afirma: ObservacionDePunto["afirma"]) => ({
    clave: `${compania} - ${codigo}`,
    compania,
    codigo,
    posicion,
    direccion,
    municipio: municipioDeLaFuente(direccion),
    url: enlaceDelMapa(posicion),
    afirma,
  });
  const desmontada = desmantelada(fotos);
  if (esEr5(operador)) {
    return {
      tipo: "observaciones",
      observaciones: desmontada ? [] : codigos.map((c) => observacion(c, "presente")),
    };
  }
  if (!desmontada) {
    return { tipo: "observaciones", observaciones: [] };
  }
  const conBandas = codigos.find((c) =>
    bandas.some(([, codigo, , inactiva]) => !inactiva && codigo.trim() === c),
  );
  const codigo = conBandas ?? codigos[0];
  return {
    tipo: "observaciones",
    observaciones: codigo === undefined ? [] : [observacion(codigo, "desmontada")],
  };
};

/**
 * Las observaciones del detalle de un punto, ordenadas por clave, o por qué no se puede leer.
 * Una estación que no se entiende es un aviso y no para el resto.
 */
export const observacionesDeDetalle = (texto: string): Result.Result<DetalleDePunto, string> => {
  if (esHtml(texto)) {
    return Result.fail("la fuente ha devuelto una página HTML en lugar del detalle");
  }
  return decodificarDetalle(texto).pipe(
    Result.mapError((error) => `detalle ilegible: ${error.message.slice(0, 200)}`),
    Result.map((estaciones) => {
      const observaciones = new Map<string, ObservacionDePunto>();
      const avisos: Array<string> = [];
      for (const lectura of estaciones.map(lecturaDeEstacion)) {
        if (lectura.tipo === "aviso") {
          avisos.push(lectura.aviso);
          continue;
        }
        for (const o of lectura.observaciones) {
          observaciones.set(o.clave, o);
        }
      }
      return {
        observaciones: [...observaciones.values()].sort((a, b) => compararTexto(a.clave, b.clave)),
        avisos,
      };
    }),
  );
};
