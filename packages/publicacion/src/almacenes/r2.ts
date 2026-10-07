import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import {
  AlmacenDeCopias,
  AlmacenDelArchivo,
  AlmacenDeFicheros,
  AlmacenNoDisponible,
  FicheroInmutable,
} from "../almacen.ts";
import { codificarConsulta, codificarRuta, firmarV4, sha256DeBytes } from "./firma.ts";

/** Un cubo de R2 y la clave con la que se firma cada petición. */
export interface OpcionesCubo {
  /** Identificador de la cuenta de Cloudflare: el punto de entrada es `<cuenta>.r2.cloudflarestorage.com`. */
  readonly cuenta: string;
  readonly cubo: string;
  readonly idClave: string;
  readonly secreto: Redacted.Redacted<string>;
  /** Otro punto de entrada compatible con S3, para las pruebas. */
  readonly puntoDeEntrada?: string;
  /** Cuánto se espera a cada petición y cuántas veces se repite. Por defecto, `PLAZOS_DE_R2`. */
  readonly plazos?: PlazosDelCubo;
}

/** Cuánto se espera a cada petición al cubo y cuántas veces se repite la que no llega. */
export interface PlazosDelCubo {
  /** Lo más que dura una petición, desde que sale hasta que se lee la respuesta entera. */
  readonly porPeticion: Duration.Input;
  /** Las veces que se repite una petición sin respuesta a tiempo, sin conexión o con 429 o 5xx. */
  readonly reintentos: number;
  /** La espera antes del primer reintento. Cada uno espera el doble que el anterior. */
  readonly pausa: Duration.Input;
}

/**
 * Cinco minutos por petición, el mismo límite que ya pone el `fetch` de Node. undici da por perdida
 * la petición que no recibe las cabeceras de la respuesta 300 s después de enviarla, y con el
 * cuerpo en memoria esos 300 s cuentan también la subida. Un paquete del archivo, de 8 MiB como
 * mucho, sube en ese tiempo con algo más de 0,2 Mbit/s, y lo publicado son ficheros pequeños. El
 * plazo propio cubre además lo que undici no cuenta, como una respuesta que llega a gotas. Con dos
 * reintentos, a los 2 y a los 4 s, una petición parada del todo cuesta unos quince minutos.
 */
export const PLAZOS_DE_R2: PlazosDelCubo = {
  porPeticion: "5 minutes",
  reintentos: 2,
  pausa: "2 seconds",
};

export interface OpcionesR2 extends OpcionesCubo {
  /** URL pública desde la que la web lee los ficheros, la de Vercel (`…/capas`), sin barra final. */
  readonly origen: string;
}

/** Un año e inmutable: cada versión es un fichero distinto que no cambia nunca (ADR 0004). */
export const CACHE_INMUTABLE = "public, max-age=31536000, immutable";
/** `vigente.json` cambia en cada publicación: la CDN y el navegador lo revalidan siempre. */
export const CACHE_VIGENTE = "public, max-age=0, must-revalidate";

/** `20260926T021503Z`, la fecha que firma AWS. */
const fechaAmz = (milisegundos: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).replace(/[-:]/gu, "").replace(/\.\d+/u, "");

const ENTIDADES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
]);
const sinEntidades = (texto: string): string =>
  texto.replace(/&(?:amp|lt|gt|quot|apos);/gu, (entidad) => ENTIDADES.get(entidad) ?? entidad);

/** Una página del listado del cubo. */
export interface PaginaDeListado {
  readonly claves: ReadonlyArray<string>;
  /** El testigo para pedir la página siguiente, o `undefined` si esta es la última. */
  readonly siguiente: string | undefined;
}

/**
 * Las claves de una página de ListObjectsV2 y, si hay más, el testigo para pedir la siguiente. El
 * XML de S3 es plano y conocido: basta con sacar los elementos `Key` y `NextContinuationToken`.
 */
export const leerListado = (xml: string): PaginaDeListado => {
  const claves = [...xml.matchAll(/<Key>([^<]*)<\/Key>/gu)].map(([, clave]) =>
    sinEntidades(clave ?? ""),
  );
  const truncada = /<IsTruncated>true<\/IsTruncated>/u.test(xml);
  const siguiente = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/u.exec(xml)?.[1];
  return {
    claves,
    siguiente: truncada && siguiente !== undefined ? sinEntidades(siguiente) : undefined,
  };
};

type Metodo = "GET" | "PUT" | "DELETE";

/** Respuestas que R2 da cuando conviene volver a pedir lo mismo un poco después. */
const esPasajero = (estado: number): boolean => estado === 429 || estado >= 500;

/** Una petición que no ha llegado o que R2 ha rechazado por un momento, para reintentarla. */
class PeticionFallida extends Schema.TaggedError<PeticionFallida>()("PeticionFallida", {
  motivo: Schema.String,
  /** La respuesta pasajera de R2 (429 o 5xx), si la hubo. */
  estado: Schema.optional(Schema.Int),
  texto: Schema.optional(Schema.String),
}) {}

/**
 * Lo que dice un fallo de transporte, con la causa más honda. `fetch` envuelve en un «fetch failed»
 * el fallo de la conexión, y el mensaje de Effect no la lleva.
 */
const motivoDelTransporte = (error: HttpClientError.HttpClientError): string => {
  let causa: unknown = error.reason.cause;
  for (let paso = 0; paso < 5 && Predicate.hasProperty(causa, "cause"); paso++) {
    if (causa.cause === undefined) break;
    causa = causa.cause;
  }
  const codigo =
    Predicate.hasProperty(causa, "code") && Predicate.isString(causa.code) ? causa.code : undefined;
  const mensaje =
    causa instanceof Error ? causa.message.replaceAll(/\s+/gu, " ").slice(0, 200) : "";
  const detalle = [codigo, mensaje].filter((parte) => parte !== undefined && parte !== "");
  return detalle.length === 0 ? error.message : `${error.message}: ${detalle.join(": ")}`;
};

const SIN_CUERPO = new Uint8Array(0);
const codificador = new TextEncoder();

/**
 * Las peticiones firmadas a un cubo de R2, por su API compatible con S3. Lo comparten el almacén
 * de lo publicado y el de las copias de la base.
 */
const cuboEnR2 = (opciones: OpcionesCubo) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const base = opciones.puntoDeEntrada ?? `https://${opciones.cuenta}.r2.cloudflarestorage.com`;
    const host = new URL(base).host;
    const credenciales = {
      idClave: opciones.idClave,
      secreto: Redacted.value(opciones.secreto),
      region: "auto",
      servicio: "s3",
    };

    const plazos = opciones.plazos ?? PLAZOS_DE_R2;
    const plazo = Duration.fromInputUnsafe(plazos.porPeticion);

    /**
     * Una petición firmada al cubo. `clave` vacía es el propio cubo (para listarlo), y `consulta`,
     * sus parámetros. El cuerpo va entero en la firma, que se calcula una vez; cada intento se
     * firma con su hora. Cada intento tiene `plazos.porPeticion` para acabar, y uno que no
     * llega o que R2 contesta con 429 o 5xx se repite `plazos.reintentos` veces. Tras el último, un
     * 429 o un 5xx se devuelve como cualquier otra respuesta.
     */
    const pedir = (
      metodo: Metodo,
      clave: string,
      extra: Readonly<Record<string, string>> = {},
      cuerpo: { readonly bytes: Uint8Array<ArrayBuffer>; readonly tipo: string } = {
        bytes: SIN_CUERPO,
        tipo: "application/octet-stream",
      },
      consulta: ReadonlyArray<readonly [string, string]> = [],
    ) =>
      Effect.gen(function* () {
        const ruta = codificarRuta(
          clave === "" ? `/${opciones.cubo}` : `/${opciones.cubo}/${clave}`,
        );
        const cadena = codificarConsulta(consulta);
        const hashCuerpo = yield* sha256DeBytes(cuerpo.bytes);
        const url = `${base}${ruta}${cadena === "" ? "" : `?${cadena}`}`;
        const objeto = clave === "" ? opciones.cubo : clave;
        const intento = Effect.gen(function* () {
          const firmadas = {
            host,
            "x-amz-content-sha256": hashCuerpo,
            "x-amz-date": fechaAmz(yield* Clock.currentTimeMillis),
          };
          const autorizacion = yield* firmarV4(
            { metodo, ruta, consulta: cadena, cabeceras: firmadas, hashCuerpo },
            credenciales,
          );
          const cabeceras = { ...firmadas, ...extra, authorization: autorizacion };
          const peticion =
            metodo === "PUT"
              ? HttpClientRequest.put(url).pipe(
                  HttpClientRequest.setHeaders(cabeceras),
                  HttpClientRequest.bodyUint8Array(cuerpo.bytes, cuerpo.tipo),
                )
              : (metodo === "GET"
                  ? HttpClientRequest.get(url)
                  : HttpClientRequest.delete(url)
                ).pipe(HttpClientRequest.setHeaders(cabeceras));
          const respuesta = yield* http.execute(peticion);
          return { estado: respuesta.status, texto: yield* respuesta.text };
        }).pipe(
          Effect.timeoutOrElse({
            duration: plazo,
            orElse: () =>
              Effect.fail(
                new PeticionFallida({
                  motivo: `${metodo} ${objeto}: sin acabar en ${Duration.format(plazo)}`,
                }),
              ),
          }),
          Effect.catchTag("HttpClientError", (error) =>
            Effect.fail(new PeticionFallida({ motivo: motivoDelTransporte(error) })),
          ),
          Effect.filterOrFail(
            (respondida) => !esPasajero(respondida.estado),
            (respondida) =>
              new PeticionFallida({
                motivo: `${metodo} ${objeto}: ${respondida.estado}`,
                estado: respondida.estado,
                texto: respondida.texto,
              }),
          ),
        );
        const intentos = plazos.reintentos + 1;
        return yield* intento.pipe(
          Effect.retry({
            schedule: Schedule.exponential(plazos.pausa),
            times: plazos.reintentos,
            while: (error) => error._tag === "PeticionFallida",
          }),
          Effect.catchTag("PeticionFallida", (error) =>
            error.estado !== undefined && error.texto !== undefined
              ? Effect.succeed({ estado: error.estado, texto: error.texto })
              : Effect.fail(
                  new AlmacenNoDisponible({
                    motivo:
                      intentos === 1 ? error.motivo : `${error.motivo} (${intentos} intentos)`,
                  }),
                ),
          ),
        );
      }).pipe(
        Effect.catchTag("FirmaFallida", (error) =>
          Effect.fail(new AlmacenNoDisponible({ motivo: error.motivo })),
        ),
      );

    const fallo = (metodo: string, clave: string, estado: number, texto: string) =>
      new AlmacenNoDisponible({
        motivo: `${metodo} ${clave}: ${estado} ${texto.slice(0, 200)}`,
      });

    /** ListObjectsV2 de las claves que empiezan por `prefijo`, de mil en mil, hasta la última. */
    const listar = (prefijo: string) =>
      Effect.gen(function* () {
        const claves: Array<string> = [];
        let siguiente: string | undefined;
        do {
          const consulta: Array<readonly [string, string]> = [["list-type", "2"]];
          if (prefijo !== "") consulta.push(["prefix", prefijo]);
          if (siguiente !== undefined) consulta.push(["continuation-token", siguiente]);
          const { estado, texto } = yield* pedir("GET", "", {}, undefined, consulta);
          if (estado !== 200) return yield* fallo("LIST", opciones.cubo, estado, texto);
          const pagina = leerListado(texto);
          claves.push(...pagina.claves);
          siguiente = pagina.siguiente;
        } while (siguiente !== undefined);
        return claves;
      });

    const borrar = (clave: string) =>
      Effect.gen(function* () {
        const { estado, texto } = yield* pedir("DELETE", clave);
        // S3 contesta 204 aunque la clave no exista.
        if (estado !== 204 && estado !== 200 && estado !== 404) {
          return yield* fallo("DELETE", clave, estado, texto);
        }
      });

    return { pedir, fallo, listar, borrar };
  });

/**
 * El almacén de ficheros en un cubo de R2, por su API compatible con S3 y firmando cada petición.
 * Es el de producción (ADR 0018): un cubo privado, sin acceso público. La ingesta escribe con su
 * clave, y el build de Vercel lee con una de solo lectura y monta las capas en `/capas`. Un
 * fichero inmutable se sube con `If-None-Match: *`, que R2 rechaza con 412 si ya existe; en ese
 * caso se lee y se compara, y solo se da por bueno si es igual.
 */
export const almacenEnR2 = (opciones: OpcionesR2) =>
  Layer.effect(
    AlmacenDeFicheros,
    Effect.gen(function* () {
      const cubo = yield* cuboEnR2(opciones);
      const json = (contenido: string) => ({
        bytes: new Uint8Array(codificador.encode(contenido)),
        tipo: "application/json",
      });

      const leer = Effect.fn("AlmacenEnR2.leer")(function* (fichero: string) {
        const { estado, texto } = yield* cubo.pedir("GET", fichero);
        if (estado === 404) return Option.none<string>();
        if (estado !== 200) return yield* cubo.fallo("GET", fichero, estado, texto);
        return Option.some(texto);
      });

      const guardar = Effect.fn("AlmacenEnR2.guardar")(function* (
        fichero: string,
        contenido: string,
      ) {
        const { estado, texto } = yield* cubo.pedir(
          "PUT",
          fichero,
          { "if-none-match": "*", "cache-control": CACHE_INMUTABLE },
          json(contenido),
        );
        if (estado === 200) return true;
        if (estado !== 412) return yield* cubo.fallo("PUT", fichero, estado, texto);
        const guardado = yield* leer(fichero);
        if (Option.isSome(guardado) && guardado.value === contenido) return false;
        return yield* new FicheroInmutable({ fichero });
      });

      const cambiarVigente = Effect.fn("AlmacenEnR2.cambiarVigente")(function* (contenido: string) {
        const { estado, texto } = yield* cubo.pedir(
          "PUT",
          FICHERO_VIGENTE,
          { "cache-control": CACHE_VIGENTE },
          json(contenido),
        );
        if (estado !== 200) return yield* cubo.fallo("PUT", FICHERO_VIGENTE, estado, texto);
      });

      return AlmacenDeFicheros.of({
        guardar,
        leer,
        cambiarVigente,
        listar: cubo.listar("").pipe(Effect.withSpan("AlmacenEnR2.listar")),
        borrar: Effect.fn("AlmacenEnR2.borrar")(cubo.borrar),
        url: (fichero) => `${opciones.origen}/${fichero}`,
      });
    }),
  );

/** El prefijo de las copias de la base en el cubo, aparte de lo publicado. */
export const PREFIJO_COPIAS = "copias/";

/** El prefijo del archivo de páginas del registro en el cubo, aparte de lo publicado (ADR 0027). */
export const PREFIJO_ARCHIVO = "archivo/";

/**
 * Los prefijos del cubo que nunca se publican. El build de Vercel solo copia lo que listan los
 * manifiestos, y falla si un manifiesto lista algo con uno de ellos.
 */
export const PREFIJOS_PRIVADOS: ReadonlyArray<string> = [PREFIJO_COPIAS, PREFIJO_ARCHIVO];

/**
 * Las copias de la base de la ingesta en el mismo cubo de R2 que lo publicado, bajo
 * `PREFIJO_COPIAS` (ADR 0018). Cada copia se sube entera en una sola petición, firmada con su
 * contenido.
 */
export const copiasEnR2 = (opciones: OpcionesCubo) =>
  Layer.effect(
    AlmacenDeCopias,
    Effect.gen(function* () {
      const cubo = yield* cuboEnR2(opciones);

      const guardar = Effect.fn("CopiasEnR2.guardar")(function* (
        nombre: string,
        contenido: Uint8Array<ArrayBuffer>,
      ) {
        const clave = `${PREFIJO_COPIAS}${nombre}`;
        const { estado, texto } = yield* cubo.pedir(
          "PUT",
          clave,
          {},
          { bytes: contenido, tipo: "application/gzip" },
        );
        if (estado !== 200) return yield* cubo.fallo("PUT", clave, estado, texto);
      });

      return AlmacenDeCopias.of({
        guardar,
        listar: cubo.listar(PREFIJO_COPIAS).pipe(
          Effect.map((claves) => claves.map((clave) => clave.slice(PREFIJO_COPIAS.length))),
          Effect.withSpan("CopiasEnR2.listar"),
        ),
        borrar: Effect.fn("CopiasEnR2.borrar")((nombre: string) =>
          cubo.borrar(`${PREFIJO_COPIAS}${nombre}`),
        ),
      });
    }),
  );

/**
 * El archivo de páginas del registro en el mismo cubo de R2, bajo `PREFIJO_ARCHIVO` (ADR 0027).
 * Cada paquete se sube entero en una sola petición, firmada con su contenido. Nada lo borra.
 */
export const archivoEnR2 = (opciones: OpcionesCubo) =>
  Layer.effect(
    AlmacenDelArchivo,
    Effect.gen(function* () {
      const cubo = yield* cuboEnR2(opciones);

      const guardar = Effect.fn("ArchivoEnR2.guardar")(function* (
        nombre: string,
        contenido: Uint8Array<ArrayBuffer>,
      ) {
        const clave = `${PREFIJO_ARCHIVO}${nombre}`;
        const { estado, texto } = yield* cubo.pedir(
          "PUT",
          clave,
          {},
          { bytes: contenido, tipo: "application/vnd.sqlite3" },
        );
        if (estado !== 200) return yield* cubo.fallo("PUT", clave, estado, texto);
      });

      return AlmacenDelArchivo.of({
        guardar,
        listar: cubo.listar(PREFIJO_ARCHIVO).pipe(
          Effect.map((claves) => claves.map((clave) => clave.slice(PREFIJO_ARCHIVO.length))),
          Effect.withSpan("ArchivoEnR2.listar"),
        ),
      });
    }),
  );
