import * as Ref from "@confect/core/Ref";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

export interface OpcionesConvex {
  /** URL del despliegue, como `http://127.0.0.1:3240`. */
  readonly url: string;
  /** Clave de administración: deja llamar a las funciones internas. */
  readonly claveAdmin: Redacted.Redacted<string>;
}

/** Respuesta de la API HTTP de Convex (`/api/query`, `/api/mutation`) con `format: "json"`. */
const RespuestaConvex = Schema.Union([
  Schema.Struct({ status: Schema.Literal("success"), value: Schema.Unknown }),
  Schema.Struct({ status: Schema.Literal("error"), errorMessage: Schema.String }),
]);
const decodificarRespuesta = HttpClientResponse.schemaBodyJson(RespuestaConvex);

/** Convex ha respondido con un error o no ha respondido. */
export class ConvexNoDisponible extends Schema.TaggedError<ConvexNoDisponible>()(
  "ConvexNoDisponible",
  { funcion: Schema.String, motivo: Schema.String },
) {}

/**
 * Las consultas y mutaciones de Confect por la API HTTP de un despliegue de Convex, con la clave
 * de administración, que también deja llamar a las funciones internas. Así el generador usa la
 * misma API que las pruebas en memoria. Un fallo de red o de Convex termina el proceso: los
 * servicios de Confect no tienen sitio en su canal de errores para él.
 */
export const convexPorHttp = (opciones: OpcionesConvex) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest((peticion) =>
          peticion.pipe(
            HttpClientRequest.prependUrl(opciones.url),
            HttpClientRequest.setHeader(
              "Authorization",
              `Convex ${Redacted.value(opciones.claveAdmin)}`,
            ),
          ),
        ),
      );

      const llamar = <Funcion extends Ref.AnyQuery | Ref.AnyMutation>(
        tipo: "query" | "mutation",
        funcion: Funcion,
        args: Ref.Args<Funcion>,
      ) =>
        Effect.gen(function* () {
          const nombre = Ref.getConvexFunctionName(funcion);
          const codificados = yield* Ref.encodeArgs(funcion, args);
          const valor = yield* http
            .execute(
              HttpClientRequest.post(`/api/${tipo}`).pipe(
                HttpClientRequest.bodyJsonUnsafe({
                  path: nombre,
                  args: codificados,
                  format: "json",
                }),
              ),
            )
            .pipe(
              Effect.flatMap(decodificarRespuesta),
              Effect.flatMap((respuesta) =>
                respuesta.status === "error"
                  ? Effect.fail(
                      new ConvexNoDisponible({ funcion: nombre, motivo: respuesta.errorMessage }),
                    )
                  : Effect.succeed(respuesta.value),
              ),
              Effect.orDie,
            );
          return yield* Ref.decodeReturns(funcion, valor);
        });

      // Confect llama sin argumentos a las funciones que no los declaran; Convex espera `{}`.
      const sinArgumentos = <Funcion extends Ref.Any>(args: Ref.OptionalArgs<Funcion>) =>
        // SAFETY: `OptionalArgs` solo deja omitir los argumentos cuando `Args` no tiene claves,
        // y entonces `{}` es exactamente `Args`.
        (args[0] ?? {}) as Ref.Args<Funcion>;

      return Context.empty().pipe(
        Context.add(QueryRunner.QueryRunner, (consulta, ...args) =>
          llamar("query", consulta, sinArgumentos(args)),
        ),
        Context.add(MutationRunner.MutationRunner, (mutacion, ...args) =>
          llamar("mutation", mutacion, sinArgumentos(args)),
        ),
      );
    }),
  );
