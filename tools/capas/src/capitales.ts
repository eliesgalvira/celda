import type { Coordenada } from "@celda/dominio/area";
import {
  type CapitalesDeMunicipios,
  type IndiceDeMunicipios,
  municipioDelPunto,
  type Territorio,
} from "@celda/dominio/municipio";
import { clienteDeFuente, type OpcionesCliente } from "@celda/ingesta/cliente";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  FuenteDeMunicipiosCambiada,
  LICENCIA,
  leerMunicipios,
  pedirBien,
  USER_AGENT,
} from "./descargaDeMunicipios.ts";
import { GmlIlegible, sinEntidades } from "./gml.ts";

/**
 * La capital de cada municipio: el punto oficial de su núcleo principal en el Nomenclátor
 * Geográfico Básico de España (NGBE) del IGN, por su servicio WFS INSPIRE. El hexágono de cada
 * municipio va junto a ella (`puntoDeMunicipio`). El NGMEP del CNIG trae lo mismo en CSV, pero se
 * descarga tras un captcha.
 */

/** El servicio WFS INSPIRE del NGBE. */
export const SERVICIO_NGBE = "https://www.ign.es/wfs-inspire/ngbe";

/** Las capacidades del servicio, que dicen su título y su licencia. */
export const CAPACIDADES_NGBE = `${SERVICIO_NGBE}?service=WFS&request=GetCapabilities`;

/** Lugares por petición. Son unas 8.100 capitales: nueve peticiones. */
export const POR_PAGINA = 1000;

/** Solo los lugares que el NGBE marca como capital de municipio. */
const FILTRO =
  '<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gn="http://inspire.ec.europa.eu/schemas/gn/4.0" xmlns:gmd="http://www.isotc211.org/2005/gmd">' +
  "<fes:PropertyIsEqualTo><fes:ValueReference>gn:localType/gmd:LocalisedCharacterString</fes:ValueReference>" +
  "<fes:Literal>Capital de municipio</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>";

/** La página de capitales que empieza en `inicio`. */
export const paginaDeCapitales = (inicio: number): string =>
  `${SERVICIO_NGBE}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "GN:NamedPlace",
    count: String(POR_PAGINA),
    startIndex: String(inicio),
    filter: FILTRO,
  })}`;

/** Lo que se usa de las capacidades del servicio. */
export interface CapacidadesDelNgbe {
  readonly producto: string;
  readonly licencia: string;
}

/** Lee de las capacidades del servicio su título y sus condiciones de acceso. */
export const leerCapacidades = (
  xml: string,
): Result.Result<CapacidadesDelNgbe, FuenteDeMunicipiosCambiada> => {
  const servicio = /<ows:ServiceIdentification>([\s\S]*?)<\/ows:ServiceIdentification>/u.exec(
    xml,
  )?.[1];
  const producto = /<ows:Title>([^<]+)<\/ows:Title>/u.exec(servicio ?? "")?.[1]?.trim();
  const licencia = /<ows:AccessConstraints>([^<]+)<\/ows:AccessConstraints>/u
    .exec(servicio ?? "")?.[1]
    ?.trim();
  if (producto === undefined || licencia === undefined) {
    return Result.fail(
      new FuenteDeMunicipiosCambiada({ motivo: "las capacidades no traen título o licencia" }),
    );
  }
  return Result.succeed({ producto: sinEntidades(producto), licencia });
};

/** Una capital tal como la da el servicio. */
export interface CapitalDelNgbe {
  /** Sus nombres: uno, o dos en las zonas bilingües («Donostia» y «San Sebastián»). */
  readonly nombres: ReadonlyArray<string>;
  readonly posicion: Coordenada;
  /** Desde cuándo vale lo que dice el NGBE de ella, `AAAA-MM-DD`. */
  readonly desde: string;
}

const SISTEMA = "http://www.opengis.net/def/crs/EPSG/0/4258";

/** Una capital de un `wfs:member`. */
const leerMiembro = (miembro: string): CapitalDelNgbe => {
  const id = /<base:localId>([^<]+)<\/base:localId>/u.exec(miembro)?.[1] ?? "sin identificador";
  if (!miembro.includes(">Capital de municipio</")) throw new Error(`${id} no es una capital`);
  const sistema = /<gml:Point [^>]*srsName="([^"]+)"/u.exec(miembro)?.[1];
  if (sistema !== SISTEMA) throw new Error(`${id}: el sistema de referencia es ${sistema}`);
  const [, latitud, longitud] =
    /<gml:pos>\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*<\/gml:pos>/u.exec(miembro) ?? [];
  if (latitud === undefined || longitud === undefined) {
    throw new Error(`${id} no tiene un punto válido`);
  }
  const desde = /<gn:beginLifespanVersion>(\d{4}-\d{2}-\d{2})T/u.exec(miembro)?.[1];
  if (desde === undefined) throw new Error(`${id} no dice desde cuándo vale`);
  const nombres = [...miembro.matchAll(/<gn:text>([^<]*)<\/gn:text>/gu)].map((m) =>
    sinEntidades((m[1] ?? "").trim()),
  );
  if (nombres.length === 0 || nombres.includes("")) throw new Error(`${id} no tiene nombre`);
  return { nombres, posicion: { longitud: Number(longitud), latitud: Number(latitud) }, desde };
};

const leerCapitales = (texto: string): ReadonlyArray<CapitalDelNgbe> => {
  const capitales: Array<CapitalDelNgbe> = [];
  let k = texto.indexOf("<wfs:member>");
  while (k !== -1) {
    const fin = texto.indexOf("</wfs:member>", k);
    if (fin === -1) throw new Error("un miembro sin cerrar");
    capitales.push(leerMiembro(texto.slice(k, fin)));
    k = texto.indexOf("<wfs:member>", fin);
  }
  const anunciadas = /numberReturned="(\d+)"/u.exec(texto.slice(0, 5000))?.[1];
  if (anunciadas === undefined) throw new Error("no dice cuántos lugares trae");
  if (Number(anunciadas) !== capitales.length) {
    throw new Error(`anuncia ${anunciadas} lugares y trae ${capitales.length}`);
  }
  return capitales;
};

/**
 * Las capitales de una página del servicio. Falla con `GmlIlegible` si alguna no es capital, no
 * tiene nombre, fecha o un punto en ETRS89, o si no trae tantas como anuncia.
 */
export const capitalesDelWfs = (
  texto: string,
): Result.Result<ReadonlyArray<CapitalDelNgbe>, GmlIlegible> =>
  Result.try({
    try: () => leerCapitales(texto),
    catch: (causa) =>
      new GmlIlegible({ motivo: causa instanceof Error ? causa.message : String(causa) }),
  });

/** Las capitales no cuadran con los municipios: no se escribe nada. */
export class CapitalesDescuadradas extends Schema.TaggedError<CapitalesDescuadradas>()(
  "CapitalesDescuadradas",
  { motivo: Schema.String },
) {
  override get message() {
    return `Las capitales del NGBE no cuadran con los municipios: ${this.motivo}.`;
  }
}

/** Un nombre sin tildes ni mayúsculas, para comparar el del NGBE con el de los límites. */
const forma = (nombre: string): string =>
  nombre.normalize("NFD").replaceAll(/\p{M}/gu, "").trim().toLowerCase();

/** Si alguno de los nombres de la capital es el del municipio o una de sus dos formas. */
const seLlamaComo = (capital: CapitalDelNgbe, municipio: Territorio): boolean => {
  const formas = new Set(municipio.nombre.split("/").map(forma));
  return capital.nombres.some((nombre) => formas.has(forma(nombre)));
};

/** Una capital que fue a otro municipio que el de su punto, porque se llama como él. */
export interface CapitalPorNombre {
  readonly capital: string;
  readonly delPunto: string;
  readonly municipio: string;
}

/** Las capitales asignadas, listas para guardar, y las que fueron por su nombre. */
export interface CapitalesAsignadas {
  readonly capitales: CapitalesDeMunicipios["capitales"];
  readonly porNombre: ReadonlyArray<CapitalPorNombre>;
}

/** El nombre que se guarda de una capital: los suyos, separados por « / ». */
const nombreDe = (capital: CapitalDelNgbe): string => capital.nombres.join(" / ");

/** Hasta cuántos casos se nombran en un error. */
const NOMBRADOS = 10;

const lista = (casos: ReadonlyArray<string>) =>
  `${casos.slice(0, NOMBRADOS).join(", ")}${casos.length > NOMBRADOS ? "…" : ""}`;

/**
 * El municipio de cada capital: el de su punto (`municipioDelPunto`) o, si su nombre no es el de
 * ese municipio y sí el de otro de la misma provincia sin ninguna capital en su recinto, ese otro.
 * Así van a su sitio las capitales de los enclaves que los límites simplificados pierden, como
 * Llocnou de la Corona dentro de Alfafar, y las que caen justo al otro lado del límite, como Encío
 * en Pancorbo. La capital de Gatika se llama Garai, como otro municipio de Bizkaia, pero Garai
 * tiene la suya en su recinto. Falla si una capital no cae en ningún municipio, si un municipio se
 * queda sin capital o si tiene más de una. Es una función pura.
 */
export const asignarCapitales = (
  capitales: ReadonlyArray<CapitalDelNgbe>,
  indice: IndiceDeMunicipios,
): Result.Result<CapitalesAsignadas, CapitalesDescuadradas> => {
  const municipios = indice.territorios.filter((t) => t.tipo === "municipio");
  const delPunto = capitales.map(
    (capital) => municipioDelPunto(capital.posicion, indice).municipio,
  );
  const conCapital = new Set(delPunto.map((municipio) => municipio?.codigo));
  const suyas = new Map<string, Array<CapitalDelNgbe>>();
  const fuera: Array<string> = [];
  const porNombre: Array<CapitalPorNombre> = [];
  for (const [i, capital] of capitales.entries()) {
    const suyo = delPunto[i];
    if (suyo === undefined) {
      fuera.push(nombreDe(capital));
      continue;
    }
    const municipio = seLlamaComo(capital, suyo)
      ? suyo
      : (municipios.find(
          (m) =>
            m.provincia === suyo.provincia && !conCapital.has(m.codigo) && seLlamaComo(capital, m),
        ) ?? suyo);
    if (municipio !== suyo) {
      porNombre.push({
        capital: nombreDe(capital),
        delPunto: suyo.codigo,
        municipio: municipio.codigo,
      });
    }
    suyas.set(municipio.codigo, [...(suyas.get(municipio.codigo) ?? []), capital]);
  }
  const problemas: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["capitales fuera de todo municipio", fuera],
    [
      "municipios sin capital",
      municipios.filter((m) => !suyas.has(m.codigo)).map((m) => `${m.codigo} ${m.nombre}`),
    ],
    [
      "municipios con varias",
      [...suyas]
        .filter(([, deUno]) => deUno.length > 1)
        .map(([codigo, deUno]) => `${codigo}: ${deUno.map(nombreDe).join(", ")}`),
    ],
  ];
  const motivo = problemas
    .filter(([, casos]) => casos.length > 0)
    .map(([que, casos]) => `${casos.length} ${que} (${lista(casos)})`)
    .join(" y ");
  if (motivo !== "") return Result.fail(new CapitalesDescuadradas({ motivo }));
  return Result.succeed({
    capitales: municipios.flatMap((m) =>
      (suyas.get(m.codigo) ?? []).map((capital) => ({
        codigo: m.codigo,
        nombre: nombreDe(capital),
        posicion: capital.posicion,
      })),
    ),
    porNombre,
  });
};

/** El fichero de las capitales que se guarda en el repositorio, con una por línea. */
export const ficheroDeCapitales = (capitales: CapitalesDeMunicipios): string =>
  `{"fuente":${JSON.stringify(capitales.fuente)},"capitales":[\n` +
  `${capitales.capitales.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`;

/** Dónde lee la orden los municipios y dónde escribe las capitales, y cómo pide. */
export interface OpcionesDeCapitales {
  readonly municipios: string;
  readonly capitales: string;
  /** Espera entre el final de una respuesta y la siguiente petición. */
  readonly pausa: Duration.Duration;
}

/**
 * Más que el `robots.txt`, las capacidades y las nueve páginas de hoy, por si el NGBE crece. Si
 * el servicio no deja de dar páginas llenas, la orden se para aquí.
 */
const MAXIMO_DE_PETICIONES = 20;

/**
 * La orden `capitales`: pide las capacidades del NGBE, comprueba la licencia, descarga las
 * capitales por páginas de `POR_PAGINA`, asigna cada una a su municipio de `municipios.json` y las
 * guarda. Si la licencia deja de ser CC BY 4.0 o las capitales no cuadran con los municipios,
 * falla sin escribir nada. La lanza una persona después de `municipios`.
 */
export const descargarCapitales = Effect.fn("Capas.descargarCapitales")(function* (
  opciones: OpcionesDeCapitales,
) {
  const fs = yield* FileSystem.FileSystem;
  const indice = yield* leerMunicipios(opciones.municipios);
  const deCliente: OpcionesCliente = {
    userAgent: USER_AGENT,
    pausa: opciones.pausa,
    maxPeticiones: MAXIMO_DE_PETICIONES,
    espera: Duration.minutes(5),
    reintentos: 2,
  };
  const ign = yield* clienteDeFuente(new URL(SERVICIO_NGBE).origin, deCliente);
  const pedirTexto = (url: string) =>
    Effect.map(pedirBien(ign, url), (respuesta) => new TextDecoder().decode(respuesta.cuerpo));
  const capacidades = yield* Effect.fromResult(
    leerCapacidades(yield* pedirTexto(CAPACIDADES_NGBE)),
  );
  if (capacidades.licencia !== LICENCIA && !capacidades.licencia.startsWith(`${LICENCIA} `)) {
    return yield* new FuenteDeMunicipiosCambiada({
      motivo: `las condiciones del NGBE son «${capacidades.licencia}»`,
    });
  }
  const descargadas: Array<CapitalDelNgbe> = [];
  for (let inicio = 0; ; inicio += POR_PAGINA) {
    const pagina = yield* Effect.fromResult(
      capitalesDelWfs(yield* pedirTexto(paginaDeCapitales(inicio))),
    );
    descargadas.push(...pagina);
    if (pagina.length < POR_PAGINA) break;
  }
  const asignadas = yield* Effect.fromResult(asignarCapitales(descargadas, indice));
  const capitales: CapitalesDeMunicipios = {
    fuente: {
      atribucion: "Instituto Geográfico Nacional",
      producto: capacidades.producto,
      licencia: LICENCIA,
      enlace: CAPACIDADES_NGBE,
      fecha: descargadas.reduce((ultima, c) => (c.desde > ultima ? c.desde : ultima), ""),
    },
    capitales: asignadas.capitales,
  };
  yield* fs.writeFileString(opciones.capitales, ficheroDeCapitales(capitales));
  return { capitales, porNombre: asignadas.porNombre };
});
