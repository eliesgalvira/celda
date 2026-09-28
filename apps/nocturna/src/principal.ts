import * as RegistroOficial from "@celda/ingesta/registro-oficial/extractor";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { almacenDesdeConfig } from "@celda/publicacion/configuracion";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { baseNocturna } from "./base.ts";
import { configuracion } from "./configuracion.ts";
import { credencialesDeSystemd } from "./credenciales.ts";
import {
  copiarBase,
  estado,
  Extractores,
  noche,
  publicadorEn,
  publicarAMano,
  sinAlmacen,
} from "./programa.ts";

/**
 * La ingesta nocturna fuera de Convex (ADR 0015). Cuatro órdenes, todas sobre la misma base:
 *
 * - `noche`: la noche entera, ingesta, publicación y copia de seguridad.
 * - `estado`: la última ejecución de cada fuente, las fichas pendientes, los errores y lo
 *   publicado.
 * - `publicar`: publica a mano lo que haya en la base, sin pedir nada a las fuentes.
 * - `copia`: copia la base a la carpeta de copias.
 *
 * La configuración va en variables de entorno (`configuracion.ts`). Los secretos pueden llegar
 * también como credenciales de systemd (`credenciales.ts`).
 */

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «noche», «estado», «publicar» o «copia».`;
  }
}

const principal = Effect.gen(function* () {
  const orden = process.argv[2] ?? "";
  const c = yield* configuracion;
  const base = baseNocturna({ fichero: c.base, interruptores: c.interruptores });
  const almacen = yield* almacenDesdeConfig;
  const zonas = yield* zonasDePublicacion;
  const publicador = Option.match(almacen, {
    onNone: () => sinAlmacen,
    onSome: (capa) => publicadorEn(zonas).pipe(Layer.provide(capa)),
  });
  const extractores = Layer.succeed(
    Extractores,
    Extractores.of({
      registroOficial: RegistroOficial.capaPorCajas(c.registroOficial).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    }),
  );
  const entorno = Layer.mergeAll(publicador, extractores).pipe(Layer.provideMerge(base));

  const efecto = Effect.gen(function* () {
    switch (orden) {
      case "noche":
        yield* noche(c.noche);
        return;
      case "estado":
        yield* estado(c.noche.proceso.rotacion);
        return;
      case "publicar":
        yield* publicarAMano;
        return;
      case "copia":
        yield* Effect.logInfo(`Copia de la base en ${yield* copiarBase(c.noche.copias)}`);
        return;
      default:
        return yield* new OrdenDesconocida({ orden });
    }
  });
  // El punto de entrada de la orden monta aquí sus capas, una vez.
  // @effect-diagnostics-next-line strictEffectProvide:off
  return yield* efecto.pipe(Effect.provide(entorno));
});

/** Node y, detrás de las variables de entorno, las credenciales de systemd. */
const programa = ConfigProvider.layerAdd(credencialesDeSystemd).pipe(
  Layer.provideMerge(NodeServices.layer),
);

// El punto de entrada del programa monta aquí sus capas, una vez.
// @effect-diagnostics-next-line strictEffectProvide:off
NodeRuntime.runMain(principal.pipe(Effect.provide(programa)));
