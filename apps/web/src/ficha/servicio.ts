import { refsPublicas } from "@celda/convex/publica";
import type { Ficha } from "@celda/dominio/ficha";
import * as WebSocketClient from "@confect/js/WebSocketClient";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/** La ficha no se ha podido leer: no hay conexión con el backend o ha respondido con un error. */
export class FichaNoLeida extends Schema.TaggedError<FichaNoLeida>()("FichaNoLeida", {
  motivo: Schema.String,
}) {}

/**
 * Las fichas de los emplazamientos, en vivo. `seguir` da la ficha actual y después cada versión
 * nueva que llegue; `None` si no hay ningún emplazamiento con esa clave. Dejar de consumir el
 * flujo libera la lectura.
 *
 * Cómo se lee es cosa de este servicio: hoy es una consulta de Convex con suscripción. Si la
 * ficha pasa a leerse con una mutación limitada o desde la CDN (exploración 04), cambia la
 * implementación y no quien la usa.
 */
export class FichasEnVivo extends Context.Service<
  FichasEnVivo,
  {
    readonly seguir: (clave: string) => Stream.Stream<Option.Option<Ficha>, FichaNoLeida>;
  }
>()("@celda/web/ficha/servicio/FichasEnVivo") {}

/**
 * Las fichas con la consulta `datos:ficha` del cliente WebSocket de Confect. El cliente no se
 * conecta hasta la primera ficha: quien solo mira el mapa no abre ninguna conexión con Convex,
 * que tiene un máximo de sesiones simultáneas en el plan gratuito.
 */
export const fichasDesdeCliente = (
  cliente: Layer.Layer<WebSocketClient.WebSocketClient>,
): Layer.Layer<FichasEnVivo> =>
  Layer.effect(
    FichasEnVivo,
    Effect.gen(function* () {
      const alcance = yield* Effect.scope;
      const conectado = yield* Effect.cached(
        Layer.buildWithScope(cliente, alcance).pipe(
          Effect.map(Context.get(WebSocketClient.WebSocketClient)),
        ),
      );
      return FichasEnVivo.of({
        seguir: (clave) =>
          Stream.unwrap(
            Effect.map(conectado, (c) =>
              c.reactiveQuery(refsPublicas.public.datos.ficha, { clave }),
            ),
          ).pipe(Stream.mapError((error) => new FichaNoLeida({ motivo: error.message }))),
      });
    }),
  );

/** Las fichas del backend de `VITE_CONVEX_URL`. Sin la variable, cada lectura lo dice. */
export const fichasEnVivo: Layer.Layer<FichasEnVivo> = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.String("VITE_CONVEX_URL").pipe(Config.withDefault(""), Effect.orDie);
    if (url === "") {
      return Layer.succeed(
        FichasEnVivo,
        FichasEnVivo.of({
          seguir: () =>
            Stream.fail(new FichaNoLeida({ motivo: "Celda no sabe dónde está su backend" })),
        }),
      );
    }
    return fichasDesdeCliente(WebSocketClient.layer(url));
  }),
);
