import {
  type FuenteDeMunicipios,
  indexarMunicipios,
  LimitesDeMunicipios,
  PadronDeMunicipios,
} from "@celda/dominio/municipio";
import {
  type ClienteDeFuente,
  clienteDeFuente,
  type OpcionesCliente,
  type Respuesta,
} from "@celda/ingesta/cliente";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { unidadesDelGml } from "./gml.ts";
import {
  CANAL_IGN,
  CSV_PADRON,
  cruzarConElPadron,
  ENLACE_PADRON_INE,
  ficheroDeMunicipios,
  ficheroDePadron,
  GML_MUNICIPIOS,
  GML_PROVINCIAS,
  limitesDelIgn,
  padronDelIne,
} from "./municipios.ts";
import { entradasDelZip, leerEntrada } from "./zip.ts";

/**
 * La orden `municipios`: descarga los límites del IGN y el padrón del INE, los cruza y los guarda
 * en el repositorio. La lanza una persona cuando el IGN publica límites nuevos o el INE un
 * padrón nuevo, hacia diciembre; no es parte de la ingesta.
 */

/** Se presenta como Celda, con un contacto; «Celda» es lo que se busca en `robots.txt`. */
export const USER_AGENT = "Celda (generador de capas; contacto en celda.elies.site)";

/** El aviso legal del INE, que dice con qué licencia se reutilizan sus datos. */
export const AVISO_LEGAL_INE = "https://www.ine.es/dyngs/AYU/index.htm?cid=125";

/** Solo se aceptan datos con esta licencia; si cambia, hay que revisar la atribución. */
export const LICENCIA = "CC BY 4.0";

/** La fuente ya no da lo que se esperaba: otra licencia, otro formato u otro fichero. */
export class FuenteDeMunicipiosCambiada extends Schema.TaggedError<FuenteDeMunicipiosCambiada>()(
  "FuenteDeMunicipiosCambiada",
  { motivo: Schema.String },
) {}

const cambiada = (motivo: string) => new FuenteDeMunicipiosCambiada({ motivo });

/** Lo que se usa del canal ATOM del IGN. */
export interface CanalDelIgn {
  readonly producto: string;
  readonly licencia: string;
  /** `AAAA-MM-DD` */
  readonly fecha: string;
  readonly zip: string;
}

/** Lee el canal ATOM del conjunto: su título, sus derechos, su fecha y el enlace del ZIP. */
export const leerCanalDelIgn = (
  xml: string,
): Result.Result<CanalDelIgn, FuenteDeMunicipiosCambiada> => {
  const cabecera = xml.slice(
    0,
    xml.indexOf("<entry>") === -1 ? xml.length : xml.indexOf("<entry>"),
  );
  const producto = /<title>([^<]+)<\/title>/u.exec(cabecera)?.[1]?.trim();
  const licencia = /<rights>([^<]+)<\/rights>/u.exec(cabecera)?.[1]?.trim();
  const fecha = /<updated>(\d{4}-\d{2}-\d{2})T[^<]*<\/updated>/u.exec(cabecera)?.[1];
  const zip = /href="(https:\/\/[^"]+\/lineas_limite_gml\.zip)"/u.exec(xml)?.[1];
  if (producto === undefined || licencia === undefined || fecha === undefined) {
    return Result.fail(cambiada("el canal no trae título, derechos o fecha"));
  }
  if (zip === undefined) return Result.fail(cambiada("el canal no enlaza lineas_limite_gml.zip"));
  return Result.succeed({ producto, licencia, fecha, zip });
};

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** La fecha `AAAA-MM-DD` de una cabecera HTTP como «Thu, 11 Dec 2025 10:00:09 GMT». */
export const fechaDeCabecera = (valor: string): string | undefined => {
  const [, dia, mes, anio] = /^\w{3}, (\d{2}) (\w{3}) (\d{4}) /u.exec(valor) ?? [];
  const numero = MESES.indexOf(mes ?? "") + 1;
  return dia === undefined || anio === undefined || numero === 0
    ? undefined
    : `${anio}-${String(numero).padStart(2, "0")}-${dia}`;
};

const hexadecimal = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

const texto = (respuesta: Respuesta): string => new TextDecoder().decode(respuesta.cuerpo);

/** Cómo se pide al IGN y dónde se guarda su ZIP. */
export interface OpcionesDelIgn {
  /** Carpeta donde se guarda el ZIP del IGN, fuera de git, para no volver a pedirlo. */
  readonly cache: string;
  /** Espera entre el final de una respuesta y la siguiente petición al mismo sitio. */
  readonly pausa: Duration.Duration;
}

/** Dónde deja la orden lo que escribe y cómo pide. */
export interface OpcionesDeMunicipios extends OpcionesDelIgn {
  /** Fichero de límites en el repositorio. */
  readonly municipios: string;
  /** Fichero del padrón en el repositorio. */
  readonly padron: string;
}

const opcionesDeCliente = (pausa: Duration.Duration): OpcionesCliente => ({
  userAgent: USER_AGENT,
  pausa,
  maxPeticiones: 3,
  espera: Duration.minutes(10),
  reintentos: 2,
});

/** Pide `url` y falla si no responde 200. */
export const pedirBien = (cliente: ClienteDeFuente, url: string) =>
  cliente.pedir(url).pipe(
    Effect.filterOrFail(
      (respuesta) => respuesta.estado === 200,
      (respuesta) => cambiada(`${url} responde ${respuesta.estado}`),
    ),
  );

/**
 * La descarga masiva de límites del IGN: lee su canal, comprueba la licencia y trae el ZIP del
 * CNIG (66 MB), salvo que ya esté en la caché con la fecha del canal. Devuelve la fuente, con la
 * huella del ZIP, y cómo leer un GML de dentro. La usan las órdenes `municipios` y `fronteras`.
 */
export const descargarDelIgn = Effect.fn("Capas.descargarDelIgn")(function* (
  opciones: OpcionesDelIgn,
) {
  const fs = yield* FileSystem.FileSystem;
  const deCliente = opcionesDeCliente(opciones.pausa);
  const ign = yield* clienteDeFuente(new URL(CANAL_IGN).origin, deCliente);
  const canal = yield* Effect.fromResult(leerCanalDelIgn(texto(yield* pedirBien(ign, CANAL_IGN))));
  if (canal.licencia !== LICENCIA && !canal.licencia.startsWith(`${LICENCIA} `)) {
    return yield* cambiada(`los derechos del canal son «${canal.licencia}»`);
  }
  const rutaZip = `${opciones.cache}/lineas_limite_gml-${canal.fecha}.zip`;
  let zip: Uint8Array;
  if (yield* fs.exists(rutaZip)) {
    zip = yield* fs.readFile(rutaZip);
  } else {
    const cnig = yield* clienteDeFuente(new URL(canal.zip).origin, deCliente);
    zip = (yield* pedirBien(cnig, canal.zip)).cuerpo;
    yield* fs.makeDirectory(opciones.cache, { recursive: true });
    yield* fs.writeFile(rutaZip, zip);
  }
  const huella = hexadecimal(
    yield* Effect.promise(() => globalThis.crypto.subtle.digest("SHA-256", zip)),
  );
  const entradas = yield* Effect.fromResult(entradasDelZip(zip));
  /** El texto de un GML del ZIP. */
  const gml = (nombre: string) =>
    Effect.gen(function* () {
      const entrada = entradas.find((e) => e.nombre === nombre);
      if (entrada === undefined) return yield* cambiada(`el ZIP no trae ${nombre}`);
      return new TextDecoder().decode(yield* leerEntrada(zip, entrada));
    });
  const fuente: FuenteDeMunicipios = {
    atribucion: "Instituto Geográfico Nacional",
    producto: canal.producto,
    licencia: LICENCIA,
    enlace: CANAL_IGN,
    fecha: canal.fecha,
    huella: `sha256:${huella}`,
  };
  return { fuente, gml };
});

/**
 * Descarga, comprueba y guarda los límites y el padrón. Antes de pedir nada a un sitio lee su
 * `robots.txt`, y entre dos peticiones al mismo sitio espera la pausa. Son, como mucho, siete
 * peticiones: el `robots.txt` y el canal del IGN, el `robots.txt` y el ZIP del CNIG (66 MB, que
 * no se pide si ya está en la caché con la fecha del canal), y el `robots.txt`, el aviso legal y
 * el CSV del INE. Si la licencia deja de ser CC BY 4.0, si falta una fecha o si los municipios
 * de un lado no están en el otro, falla sin escribir nada.
 */
export const descargarMunicipios = Effect.fn("Capas.descargarMunicipios")(function* (
  opciones: OpcionesDeMunicipios,
) {
  const fs = yield* FileSystem.FileSystem;
  const deCliente = opcionesDeCliente(opciones.pausa);

  // Límites del IGN.
  const { fuente, gml } = yield* descargarDelIgn(opciones);
  const unidades = (nombre: string) =>
    Effect.flatMap(gml(nombre), (texto) => Effect.fromResult(unidadesDelGml(texto)));
  const limites = yield* Effect.fromResult(
    limitesDelIgn(yield* unidades(GML_MUNICIPIOS), yield* unidades(GML_PROVINCIAS), fuente),
  );

  // Padrón del INE.
  const ine = yield* clienteDeFuente(new URL(CSV_PADRON).origin, deCliente);
  const aviso = texto(yield* pedirBien(ine, AVISO_LEGAL_INE));
  if (!aviso.includes("creativecommons.org/licenses/by/4.0") || !aviso.includes(`(${LICENCIA})`)) {
    return yield* cambiada(`el aviso legal del INE ya no dice ${LICENCIA}`);
  }
  const csv = yield* pedirBien(ine, CSV_PADRON);
  const publicada = fechaDeCabecera(csv.cabeceras["last-modified"] ?? "");
  if (publicada === undefined) return yield* cambiada("el CSV del padrón no dice su fecha");
  const padron = yield* Effect.fromResult(
    padronDelIne(texto(csv), {
      atribucion: "INE",
      licencia: LICENCIA,
      enlace: ENLACE_PADRON_INE,
      publicada,
    }),
  );
  yield* Effect.fromResult(cruzarConElPadron(limites, padron));

  yield* fs.writeFileString(opciones.municipios, ficheroDeMunicipios(limites));
  yield* fs.writeFileString(opciones.padron, ficheroDePadron(padron));
  return { limites, padron };
});

const decodificarMunicipios = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

/** Lee los límites de municipios guardados en el repositorio, listos para asignar. */
export const leerMunicipios = Effect.fn("Capas.leerMunicipios")(function* (ruta: string) {
  const fs = yield* FileSystem.FileSystem;
  return indexarMunicipios(yield* decodificarMunicipios(yield* fs.readFileString(ruta)));
});

const decodificarPadron = Schema.decodeEffect(Schema.fromJsonString(PadronDeMunicipios));

/** Lee el padrón de los municipios guardado en el repositorio. */
export const leerPadron = Effect.fn("Capas.leerPadron")(function* (ruta: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* decodificarPadron(yield* fs.readFileString(ruta));
});
