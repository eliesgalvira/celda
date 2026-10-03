// La orden es su propio punto de entrada y monta aquí sus capas, una vez.
// @effect-diagnostics strictEffectProvide:off
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import {
  BuzonAdministrado,
  buzonAdministrado,
  BuzonNoDisponible,
  conexionDesdeConfig,
} from "./buzon.ts";
import { lanzarModerar, Salida } from "./ordenes.ts";
import { loPublicadoEn, origenPublicadoDesdeConfig } from "./publicado.ts";

/**
 * La herramienta de moderación del buzón (ADR 0020, #57). Desde la raíz de Celda:
 *
 *     pnpm -s moderar pendientes [--tipo …] [--limite N] [--json]
 *     pnpm -s moderar proponer [<id>…] [--json]
 *     pnpm -s moderar aceptar <id>… --motivo "…" [--json]
 *
 * y `ver`, `rechazar`, `vetar` y `aceptadas`; `--help` en cada una dice cómo se usa. Lee
 * `CELDA_CONVEX_URL` y `CELDA_CONVEX_CLAVE` (la clave de despliegue o de administración, que no se
 * guarda en ningún fichero del repositorio) y lo publicado de `CELDA_MODERACION_CAPAS`.
 *
 * Lo que se pide sale por la salida estándar, y los errores por la de errores, con código 1.
 */

/** La salida y la salida de errores del proceso. */
const salidaDelProceso = Layer.succeed(
  Salida,
  Salida.of({
    escribir: (texto) =>
      Effect.sync(() => {
        process.stdout.write(`${texto}\n`);
      }),
    avisar: (texto) =>
      Effect.sync(() => {
        process.stderr.write(`${texto}\n`);
      }),
  }),
);

/** Sin conexión configurada, cada llamada al buzón dice qué falta. */
const sinConexion = Layer.succeed(
  BuzonAdministrado,
  (() => {
    const falta = Effect.fail(
      new BuzonNoDisponible({
        motivo: "faltan CELDA_CONVEX_URL y CELDA_CONVEX_CLAVE (docs/patterns/convex.md, «Moderar»)",
      }),
    );
    return BuzonAdministrado.of({
      pendientes: () => falta,
      contexto: () => falta,
      aceptadas: () => falta,
      aceptar: () => falta,
      rechazar: () => falta,
      vetar: () => falta,
    });
  })(),
);

const buzon = Layer.unwrap(
  Effect.gen(function* () {
    const conexion = yield* conexionDesdeConfig;
    return Option.match(conexion, {
      onNone: () => sinConexion,
      onSome: (c) => buzonAdministrado(c).pipe(Layer.provide(FetchHttpClient.layer)),
    });
  }),
);

const publicado = Layer.unwrap(
  Effect.gen(function* () {
    const origen = yield* origenPublicadoDesdeConfig;
    return loPublicadoEn(origen).pipe(Layer.provide(FetchHttpClient.layer));
  }),
);

const programa = lanzarModerar(process.argv.slice(2)).pipe(
  Effect.provide(Layer.mergeAll(buzon, publicado, salidaDelProceso)),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(programa, { disableErrorReporting: true });
