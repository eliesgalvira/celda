import { PAGINA_MAXIMA, PaginaParaPublicar } from "@celda/dominio/moderacion";
import { HttpRouter as RouterDeConvex } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { autorizadaParaPublicar } from "../src/publicacion";
import refs from "./_generated/refs";
import { QueryRunner } from "./_generated/services";

/**
 * Las acciones HTTP del despliegue (`https://<nombre>.convex.site`). Hoy, una: lo aceptado para la
 * publicación nocturna (ADR 0020, #57).
 *
 *     GET /aportaciones/aceptadas?despues-de=<ms>
 *     Authorization: Bearer <CELDA_PUBLICACION_CLAVE>
 *
 * Da una `PaginaParaPublicar` (`moderacion:publicables`): solo lo aceptado, sin huellas de IP, sin
 * identidades y sin notas. Así la máquina de la noche no necesita una clave de despliegue, que lo
 * puede todo. Sin la clave, o con otra, contesta siempre un 401 vacío.
 */
export const RUTA_DE_ACEPTADAS = "/aportaciones/aceptadas";

const codificarPagina = Schema.encodeEffect(Schema.fromJsonString(PaginaParaPublicar));

const SIN_CACHE = { "cache-control": "no-store" };

const NO_AUTORIZADA = HttpServerResponse.empty({
  status: 401,
  headers: { ...SIN_CACHE, "www-authenticate": "Bearer" },
});

/** `despues-de`: un número, o nada para empezar por la primera. */
const despuesDe = (url: string): Option.Option<number | null> => {
  const valor = new URLSearchParams(url.split("?")[1] ?? "").get("despues-de");
  if (valor === null || valor === "") return Option.some(null);
  const numero = Number(valor);
  return Number.isFinite(numero) ? Option.some(numero) : Option.none();
};

const aceptadas = HttpRouter.add("GET", RUTA_DE_ACEPTADAS, (request) =>
  Effect.gen(function* () {
    if (!(yield* autorizadaParaPublicar(request.headers.authorization))) return NO_AUTORIZADA;
    const desde = despuesDe(request.url);
    if (Option.isNone(desde)) {
      return HttpServerResponse.text("despues-de no es un número", {
        status: 400,
        headers: SIN_CACHE,
      });
    }
    const consultar = yield* QueryRunner;
    const pagina = yield* consultar(refs.internal.moderacion.publicables, {
      despuesDe: desde.value,
      limite: PAGINA_MAXIMA,
    });
    return HttpServerResponse.text(yield* codificarPagina(pagina), {
      contentType: "application/json",
      headers: SIN_CACHE,
    });
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed(HttpServerResponse.empty({ status: 503, headers: SIN_CACHE })),
    ),
  ),
);

export default RouterDeConvex.make(aceptadas);
