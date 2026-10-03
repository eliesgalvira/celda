import {
  AportacionDesconocida,
  AportacionEnCola,
  AportacionYaModerada,
  ContextoEnElBuzon,
  PaginaDeCola,
  type TipoDeVeto,
} from "@celda/dominio/moderacion";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

/**
 * El buzón de Convex visto desde fuera, con la clave de administración (ADR 0020): lo usan la
 * herramienta de moderación y la ingesta nocturna. Habla con las funciones internas
 * `moderacion:*` por la API HTTP de Convex, la misma que usa su cliente, sin el paquete de Convex:
 * así la ingesta nocturna no lo carga.
 */

/** Convex no contesta, o contesta algo que no se entiende. */
export class BuzonNoDisponible extends Schema.TaggedError<BuzonNoDisponible>()(
  "BuzonNoDisponible",
  { motivo: Schema.String },
) {
  override get message() {
    return `El buzón de Convex no está disponible: ${this.motivo}`;
  }
}

/** Convex no acepta la clave: no es de este despliegue, o se ha revocado. */
export class ClaveNoValida extends Schema.TaggedError<ClaveNoValida>()("ClaveNoValida", {
  estado: Schema.Int,
}) {
  override get message() {
    return `Convex no acepta la clave de CELDA_CONVEX_CLAVE (HTTP ${this.estado}): no es de este despliegue o se ha revocado.`;
  }
}

/** Lo que puede pasar al hablar con el buzón, sea cual sea la función. */
export type FalloDelBuzon = BuzonNoDisponible | ClaveNoValida;

/**
 * El buzón con la clave de administración: las funciones internas `moderacion:*`
 * (`convex/confect/moderacion.spec.ts`).
 */
export class BuzonAdministrado extends Context.Service<
  BuzonAdministrado,
  {
    /** Las pendientes después de `despuesDe` (`recibidaEl`), de la más antigua a la más reciente. */
    readonly pendientes: (
      despuesDe: number | null,
      limite: number,
    ) => Effect.Effect<PaginaDeCola, FalloDelBuzon>;
    /** Lo que sabe el buzón de cada aportación, en el mismo orden (`CONTEXTOS_POR_LLAMADA` como mucho). */
    readonly contexto: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<ContextoEnElBuzon>, FalloDelBuzon | AportacionDesconocida>;
    /** Las aceptadas después de `despuesDe` (`moderadaEl`), en el orden en que se aceptaron. */
    readonly aceptadas: (
      despuesDe: number | null,
      limite: number,
    ) => Effect.Effect<PaginaDeCola, FalloDelBuzon>;
    readonly aceptar: (
      id: string,
      motivo: string,
    ) => Effect.Effect<
      AportacionEnCola,
      FalloDelBuzon | AportacionDesconocida | AportacionYaModerada
    >;
    readonly rechazar: (
      id: string,
      motivo: string,
    ) => Effect.Effect<
      AportacionEnCola,
      FalloDelBuzon | AportacionDesconocida | AportacionYaModerada
    >;
    /** Veta una identidad o una huella de IP; `nuevo` es `false` si ya estaba vetada. */
    readonly vetar: (
      tipo: TipoDeVeto,
      valor: string,
      motivo: string,
    ) => Effect.Effect<{ readonly nuevo: boolean }, FalloDelBuzon>;
  }
>()("@celda/moderacion/buzon/BuzonAdministrado") {}

/** Dónde está el despliegue de Convex y con qué clave se le habla. */
export interface ConexionDelBuzon {
  /** `https://<nombre>.convex.cloud`, o `http://127.0.0.1:3240` con el backend local. */
  readonly url: string;
  /** La clave de despliegue (deploy key) o de administración. Da acceso a todo el despliegue. */
  readonly clave: Redacted.Redacted<string>;
}

/**
 * La conexión de la configuración, o `None` si falta alguna de las dos variables:
 *
 * - `CELDA_CONVEX_URL`: la URL del despliegue, la misma que `VITE_CELDA_CONVEX_URL` de la web;
 * - `CELDA_CONVEX_CLAVE`: su clave de despliegue (deploy key) o de administración.
 */
export const conexionDesdeConfig: Config.Config<Option.Option<ConexionDelBuzon>> = Config.all({
  url: Config.option(Config.String("CELDA_CONVEX_URL")),
  clave: Config.option(Config.Redacted("CELDA_CONVEX_CLAVE")),
}).pipe(
  Config.map(({ url, clave }) =>
    Option.isSome(url) && Option.isSome(clave)
      ? Option.some({ url: url.value.replace(/\/+$/u, ""), clave: clave.value })
      : Option.none(),
  ),
);

/** Un argumento de una función de `moderacion:*`, tal como va en la API HTTP de Convex. */
type ArgumentoDeConvex = string | number | boolean | null | ReadonlyArray<string>;

/** Los argumentos de una llamada, por nombre. */
type ArgumentosDeConvex = Readonly<Record<string, ArgumentoDeConvex>>;

/** Lo que se espera a Convex en cada llamada antes de darlo por caído. */
const ESPERA = Duration.seconds(30);

/** El estado con que Convex contesta a una función que ha fallado. */
const FUNCION_FALLIDA = 560;

/** La respuesta de la API HTTP de Convex (`/api/query` y `/api/mutation`). */
const Respuesta = Schema.Union([
  Schema.Struct({ status: Schema.Literal("success"), value: Schema.Unknown }),
  Schema.Struct({
    status: Schema.Literal("error"),
    errorMessage: Schema.String,
    errorData: Schema.optionalKey(Schema.Unknown),
  }),
]);
const decodificarRespuesta = Schema.decodeUnknownEffect(Schema.fromJsonString(Respuesta));

const VetoNuevo = Schema.Struct({ nuevo: Schema.Boolean });
const Contextos = Schema.Array(ContextoEnElBuzon);
const ErrorDeVeredicto = Schema.Union([AportacionDesconocida, AportacionYaModerada]);

/**
 * El buzón de `conexion`, sobre el `HttpClient` del contexto. Cada llamada envía la clave en la
 * cabecera `Authorization: Convex <clave>`, como el cliente de Convex con `setAdminAuth`, y nunca
 * la escribe en un mensaje. Todas las funciones se pueden repetir sin efectos de más (repetir un
 * veredicto o un veto no cambia nada), así que un fallo de red o un 5xx se reintenta dos veces.
 */
export const buzonAdministrado = (conexion: ConexionDelBuzon) =>
  Layer.effect(
    BuzonAdministrado,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          schedule: Schedule.exponential("500 millis"),
          times: 2,
        }),
      );
      const noDisponible = (motivo: string) => new BuzonNoDisponible({ motivo });

      /** Llama a una función de Convex y da su respuesta, haya ido bien o haya fallado. */
      const enviar = (
        tipo: "query" | "mutation",
        funcion: string,
        args: ArgumentosDeConvex,
      ): Effect.Effect<typeof Respuesta.Type, FalloDelBuzon> =>
        Effect.gen(function* () {
          const peticion = HttpClientRequest.post(`${conexion.url}/api/${tipo}`).pipe(
            HttpClientRequest.setHeader(
              "authorization",
              `Convex ${Redacted.value(conexion.clave)}`,
            ),
            HttpClientRequest.bodyJsonUnsafe({
              path: funcion,
              format: "convex_encoded_json",
              args: [args],
            }),
          );
          const respuesta = yield* http.execute(peticion);
          if (respuesta.status === 401 || respuesta.status === 403) {
            return yield* new ClaveNoValida({ estado: respuesta.status });
          }
          const texto = yield* respuesta.text;
          if (respuesta.status !== 200 && respuesta.status !== FUNCION_FALLIDA) {
            return yield* noDisponible(
              `${funcion}: HTTP ${respuesta.status} ${texto.slice(0, 200)}`,
            );
          }
          return yield* decodificarRespuesta(texto).pipe(
            Effect.mapError((error) => noDisponible(`${funcion}: ${error.message}`)),
          );
        }).pipe(
          Effect.timeout(ESPERA),
          Effect.catchTags({
            HttpClientError: (error) => Effect.fail(noDisponible(`${funcion}: ${error.message}`)),
            TimeoutError: () =>
              Effect.fail(noDisponible(`${funcion}: sin respuesta en ${Duration.format(ESPERA)}`)),
          }),
        );

      /**
       * Llama a una función de Convex y decodifica lo que devuelve con `devuelve`. Si la función
       * falla con un error declarado, lo decodifica con `falla`; si no, es que el buzón no está
       * disponible.
       */
      const llamar = <A, I, E, EI>(
        tipo: "query" | "mutation",
        funcion: string,
        args: ArgumentosDeConvex,
        devuelve: Schema.Codec<A, I>,
        falla: Option.Option<Schema.Codec<E, EI>>,
      ): Effect.Effect<A, FalloDelBuzon | E> =>
        Effect.gen(function* () {
          const cuerpo = yield* enviar(tipo, funcion, args);
          if (cuerpo.status === "success") {
            return yield* Schema.decodeUnknownEffect(devuelve)(cuerpo.value).pipe(
              Effect.mapError((error) =>
                noDisponible(`${funcion} devuelve otra cosa: ${error.message}`),
              ),
            );
          }
          const declarado = Option.flatMap(falla, (esquema) =>
            Schema.decodeUnknownOption(esquema)(cuerpo.errorData),
          );
          if (Option.isSome(declarado)) return yield* Effect.fail(declarado.value);
          return yield* noDisponible(`${funcion}: ${cuerpo.errorMessage}`);
        }).pipe(Effect.withSpan(`BuzonAdministrado.${funcion}`));

      const sinError = Option.none<Schema.Codec<never, never>>();

      return BuzonAdministrado.of({
        pendientes: (despuesDe, limite) =>
          llamar("query", "moderacion:pendientes", { despuesDe, limite }, PaginaDeCola, sinError),
        contexto: (ids) =>
          llamar(
            "query",
            "moderacion:contexto",
            { ids },
            Contextos,
            Option.some(AportacionDesconocida),
          ),
        aceptadas: (despuesDe, limite) =>
          llamar("query", "moderacion:aceptadas", { despuesDe, limite }, PaginaDeCola, sinError),
        aceptar: (id, motivo) =>
          llamar(
            "mutation",
            "moderacion:aceptar",
            { id, motivo },
            AportacionEnCola,
            Option.some(ErrorDeVeredicto),
          ),
        rechazar: (id, motivo) =>
          llamar(
            "mutation",
            "moderacion:rechazar",
            { id, motivo },
            AportacionEnCola,
            Option.some(ErrorDeVeredicto),
          ),
        vetar: (tipo, valor, motivo) =>
          llamar("mutation", "moderacion:vetar", { tipo, valor, motivo }, VetoNuevo, sinError),
      });
    }),
  );
