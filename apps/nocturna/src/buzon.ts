import { PaginaParaPublicar } from "@celda/dominio/moderacion";
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
 * Lo que la noche lee del buzón de Convex: lo aceptado en la moderación, por la acción HTTP
 * `GET /aportaciones/aceptadas` del despliegue (`convex/confect/http.ts`), con su propia clave
 * (`CELDA_PUBLICACION_CLAVE`). Esa clave solo abre esa acción, que no da huellas de IP,
 * identidades ni nada pendiente o rechazado. La máquina de la noche nunca tiene una clave de
 * despliegue de Convex (ADR 0020, #57).
 */

/** El buzón no contesta, no acepta la clave o contesta algo que no se entiende. */
export class BuzonNoDisponible extends Schema.TaggedError<BuzonNoDisponible>()(
  "BuzonNoDisponible",
  { motivo: Schema.String },
) {
  override get message() {
    return `El buzón de Convex no está disponible: ${this.motivo}`;
  }
}

/** Lo aceptado para publicar, de página en página. */
export class AceptadasDelBuzon extends Context.Service<
  AceptadasDelBuzon,
  {
    /** Lo aceptado después de `despuesDe` (hora de aceptación), en el orden en que se aceptó. */
    readonly leer: (
      despuesDe: number | null,
    ) => Effect.Effect<PaginaParaPublicar, BuzonNoDisponible>;
  }
>()("@celda/nocturna/buzon/AceptadasDelBuzon") {}

/** De dónde y con qué clave lee la noche lo aceptado. */
export interface ConexionDePublicacion {
  /** La URL de las acciones HTTP del despliegue: `https://<nombre>.convex.site`. */
  readonly sitio: string;
  /** La clave de publicación, `CELDA_PUBLICACION_CLAVE` del despliegue. */
  readonly clave: Redacted.Redacted<string>;
}

/**
 * La conexión de la configuración, o `None` si falta alguna de las dos variables:
 *
 * - `CELDA_CONVEX_SITE_URL`: la URL de las acciones HTTP del despliegue, `https://<nombre>.convex.site`
 *   (con el backend local, `http://127.0.0.1:3241`);
 * - `CELDA_PUBLICACION_CLAVE`: la clave de publicación, la misma que la variable del despliegue.
 */
export const conexionDePublicacionDesdeConfig: Config.Config<Option.Option<ConexionDePublicacion>> =
  Config.all({
    sitio: Config.option(Config.String("CELDA_CONVEX_SITE_URL")),
    clave: Config.option(Config.Redacted("CELDA_PUBLICACION_CLAVE")),
  }).pipe(
    Config.map(({ sitio, clave }) =>
      Option.isSome(sitio) && Option.isSome(clave)
        ? Option.some({ sitio: sitio.value.replace(/\/+$/u, ""), clave: clave.value })
        : Option.none(),
    ),
  );

/** La ruta de la acción HTTP, la de `convex/confect/http.ts`. */
export const RUTA_DE_ACEPTADAS = "/aportaciones/aceptadas";

/** Lo que se espera a Convex en cada página antes de darlo por caído. */
const ESPERA = Duration.seconds(30);

const decodificarPagina = Schema.decodeUnknownEffect(Schema.fromJsonString(PaginaParaPublicar));

/**
 * Lo aceptado por HTTP, sobre el `HttpClient` del contexto. Leer no cambia nada en el buzón, así
 * que un fallo de red o un 5xx se reintenta dos veces. La clave va en `Authorization: Bearer` y
 * nunca en un mensaje.
 */
export const aceptadasPorHttp = (conexion: ConexionDePublicacion) =>
  Layer.effect(
    AceptadasDelBuzon,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({ schedule: Schedule.exponential("500 millis"), times: 2 }),
      );
      const noDisponible = (motivo: string) => new BuzonNoDisponible({ motivo });
      return AceptadasDelBuzon.of({
        leer: (despuesDe) =>
          Effect.gen(function* () {
            const respuesta = yield* http.execute(
              HttpClientRequest.get(`${conexion.sitio}${RUTA_DE_ACEPTADAS}`).pipe(
                HttpClientRequest.setUrlParams(
                  despuesDe === null ? {} : { "despues-de": String(despuesDe) },
                ),
                HttpClientRequest.bearerToken(Redacted.value(conexion.clave)),
              ),
            );
            if (respuesta.status === 401) {
              return yield* noDisponible(
                "no acepta CELDA_PUBLICACION_CLAVE (401): no es la del despliegue o no está puesta",
              );
            }
            if (respuesta.status !== 200) {
              return yield* noDisponible(`${RUTA_DE_ACEPTADAS}: HTTP ${respuesta.status}`);
            }
            return yield* decodificarPagina(yield* respuesta.text).pipe(
              Effect.mapError((error) => noDisponible(`${RUTA_DE_ACEPTADAS}: ${error.message}`)),
            );
          }).pipe(
            Effect.timeout(ESPERA),
            Effect.catchTags({
              HttpClientError: (error) => Effect.fail(noDisponible(error.message)),
              TimeoutError: () =>
                Effect.fail(noDisponible(`sin respuesta en ${Duration.format(ESPERA)}`)),
            }),
            Effect.withSpan("AceptadasDelBuzon.leer"),
          ),
      });
    }),
  );
