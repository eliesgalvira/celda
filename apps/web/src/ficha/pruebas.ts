import type { Ficha } from "@celda/dominio/ficha";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { FichaNoLeida, FichasEnVivo } from "./servicio.ts";

/** Lo que el backend de prueba contesta: una ficha, que no existe o un fallo. */
export type RespuestaDePrueba = Ficha | "no-existe" | FichaNoLeida;

export interface FichasDePrueba {
  readonly capa: Layer.Layer<FichasEnVivo>;
  /**
   * Entrega `respuesta` a las lecturas abiertas de `clave`, cuando la prueba quiera: así se
   * simulan respuestas lentas o que llegan en otro orden. Sin lecturas abiertas no llega a nadie.
   */
  readonly responder: (clave: string, respuesta: RespuestaDePrueba) => void;
  /** Las claves con una lectura abierta ahora, en el orden en que se abrieron. */
  readonly abiertas: () => ReadonlyArray<string>;
}

const esFallo = Schema.is(FichaNoLeida);

/** Un servicio de fichas de prueba que no contesta nada hasta que la prueba se lo pide. */
export const fichasDePrueba = (): FichasDePrueba => {
  const lecturas: Array<{
    readonly clave: string;
    readonly cola: Queue.Queue<Option.Option<Ficha>, FichaNoLeida | Cause.Done>;
  }> = [];

  const seguir = (clave: string) =>
    Stream.callback<Option.Option<Ficha>, FichaNoLeida>((cola) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const lectura = { clave, cola };
          lecturas.push(lectura);
          return lectura;
        }),
        (lectura) =>
          Effect.sync(() => {
            lecturas.splice(lecturas.indexOf(lectura), 1);
          }),
      ),
    );

  return {
    capa: Layer.succeed(FichasEnVivo, FichasEnVivo.of({ seguir })),
    responder: (clave, respuesta) => {
      for (const lectura of lecturas.filter((l) => l.clave === clave)) {
        if (esFallo(respuesta)) {
          Queue.failCauseUnsafe(lectura.cola, Cause.fail(respuesta));
        } else {
          Queue.offerUnsafe(
            lectura.cola,
            respuesta === "no-existe" ? Option.none() : Option.some(respuesta),
          );
        }
      }
    },
    abiertas: () => lecturas.map((l) => l.clave),
  };
};
