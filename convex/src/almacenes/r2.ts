import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { AlmacenDeFicheros, AlmacenNoDisponible, FicheroInmutable } from "../publicacion";
import { codificarRuta, firmarV4, sha256 } from "./firma";

export interface OpcionesR2 {
  /** Identificador de la cuenta de Cloudflare: el punto de entrada es `<cuenta>.r2.cloudflarestorage.com`. */
  readonly cuenta: string;
  readonly cubo: string;
  readonly idClave: string;
  readonly secreto: Redacted.Redacted<string>;
  /** URL pública desde la que la web lee los ficheros (el Worker o la Pages Function), sin barra final. */
  readonly origen: string;
  /** Otro punto de entrada compatible con S3, para las pruebas. */
  readonly puntoDeEntrada?: string;
}

/** Un año e inmutable: cada versión es un fichero distinto que no cambia nunca (ADR 0004). */
export const CACHE_INMUTABLE = "public, max-age=31536000, immutable";
/** `vigente.json` cambia en cada publicación: la CDN y el navegador lo revalidan siempre. */
export const CACHE_VIGENTE = "public, max-age=0, must-revalidate";

/** `20260926T021503Z`, la fecha que firma AWS. */
const fechaAmz = (milisegundos: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(milisegundos)).replace(/[-:]/gu, "").replace(/\.\d+/u, "");

/**
 * El almacén de ficheros en un cubo de R2, por su API compatible con S3 y firmando cada petición.
 * Es el de producción (ADR 0010): la web lee el cubo a través de un Worker o una Pages Function.
 * Un fichero inmutable se sube con `If-None-Match: *`, que R2 rechaza con 412 si ya existe; en
 * ese caso se lee y se compara, y solo se da por bueno si es igual.
 */
export const almacenEnR2 = (opciones: OpcionesR2) =>
  Layer.effect(
    AlmacenDeFicheros,
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

      const pedir = (
        metodo: "GET" | "PUT",
        fichero: string,
        contenido: string,
        extra: Readonly<Record<string, string>>,
      ) =>
        Effect.gen(function* () {
          const ruta = codificarRuta(`/${opciones.cubo}/${fichero}`);
          const hashCuerpo = yield* sha256(contenido);
          const firmadas = {
            host,
            "x-amz-content-sha256": hashCuerpo,
            "x-amz-date": fechaAmz(yield* Clock.currentTimeMillis),
          };
          const autorizacion = yield* firmarV4(
            { metodo, ruta, cabeceras: firmadas, hashCuerpo },
            credenciales,
          );
          const cabeceras = { ...firmadas, ...extra, authorization: autorizacion };
          const peticion =
            metodo === "PUT"
              ? HttpClientRequest.put(`${base}${ruta}`).pipe(
                  HttpClientRequest.setHeaders(cabeceras),
                  HttpClientRequest.bodyText(contenido, "application/json"),
                )
              : HttpClientRequest.get(`${base}${ruta}`).pipe(
                  HttpClientRequest.setHeaders(cabeceras),
                );
          const respuesta = yield* http.execute(peticion);
          return { estado: respuesta.status, texto: yield* respuesta.text };
        }).pipe(
          Effect.catchTags({
            FirmaFallida: (error) => Effect.fail(new AlmacenNoDisponible({ motivo: error.motivo })),
            HttpClientError: (error) =>
              Effect.fail(new AlmacenNoDisponible({ motivo: error.message })),
          }),
        );

      const fallo = (metodo: string, fichero: string, estado: number, texto: string) =>
        new AlmacenNoDisponible({
          motivo: `${metodo} ${fichero}: ${estado} ${texto.slice(0, 200)}`,
        });

      const leer = Effect.fn("AlmacenEnR2.leer")(function* (fichero: string) {
        const { estado, texto } = yield* pedir("GET", fichero, "", {});
        if (estado === 404) return Option.none<string>();
        if (estado !== 200) return yield* fallo("GET", fichero, estado, texto);
        return Option.some(texto);
      });

      const guardar = Effect.fn("AlmacenEnR2.guardar")(function* (
        fichero: string,
        contenido: string,
      ) {
        const { estado, texto } = yield* pedir("PUT", fichero, contenido, {
          "if-none-match": "*",
          "cache-control": CACHE_INMUTABLE,
        });
        if (estado === 200) return true;
        if (estado !== 412) return yield* fallo("PUT", fichero, estado, texto);
        const guardado = yield* leer(fichero);
        if (Option.isSome(guardado) && guardado.value === contenido) return false;
        return yield* new FicheroInmutable({ fichero });
      });

      const cambiarVigente = Effect.fn("AlmacenEnR2.cambiarVigente")(function* (contenido: string) {
        const { estado, texto } = yield* pedir("PUT", FICHERO_VIGENTE, contenido, {
          "cache-control": CACHE_VIGENTE,
        });
        if (estado !== 200) return yield* fallo("PUT", FICHERO_VIGENTE, estado, texto);
      });

      return AlmacenDeFicheros.of({
        guardar,
        leer,
        cambiarVigente,
        url: (fichero) => `${opciones.origen}/${fichero}`,
      });
    }),
  );
