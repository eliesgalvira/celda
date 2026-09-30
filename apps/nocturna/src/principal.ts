import * as AntenasMoviles from "@celda/ingesta/antenasmoviles/extractor";
import { enLosCuadros } from "@celda/ingesta/antenasmoviles/normalizar";
import { Provincias } from "@celda/ingesta/fichas";
import * as RegistroOficial from "@celda/ingesta/registro-oficial/extractor";
import { zonasDePublicacion } from "@celda/publicacion/zonas";
import { almacenEnCarpeta } from "@celda/publicacion/almacenes/carpeta";
import { almacenDesdeConfig, reservaDesdeConfig } from "@celda/publicacion/configuracion";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { baseNocturna } from "./base.ts";
import { clienteHttpDelRegistro } from "./conexionDelRegistro.ts";
import { configuracion } from "./configuracion.ts";
import { credencialesDeSystemd } from "./credenciales.ts";
import {
  copiarBase,
  estado,
  Extractores,
  noche,
  provinciasDe,
  publicadorEn,
  publicarAMano,
  sinAlmacen,
} from "./programa.ts";
import { copiarReserva } from "./reserva.ts";

/**
 * La ingesta nocturna fuera de Convex (ADR 0015). Cuatro órdenes sobre la misma base:
 *
 * - `noche`: la noche entera, ingesta, publicación, copia de reserva y copia de seguridad.
 * - `estado`: la última ejecución de cada fuente, las fichas pendientes, los errores y lo
 *   publicado.
 * - `publicar`: publica a mano lo que haya en la base, sin pedir nada a las fuentes, y pone al
 *   día la copia de reserva.
 * - `copia`: copia la base a la carpeta de copias.
 *
 * Y una que no abre la base: `reserva <origen> <carpeta>`, que copia la versión vigente de lo
 * publicado a una carpeta. La lanza el build de Vercel para montar la copia de reserva.
 *
 * La configuración va en variables de entorno (`configuracion.ts`). Los secretos pueden llegar
 * también como credenciales de systemd (`credenciales.ts`).
 */

class OrdenDesconocida extends Schema.TaggedError<OrdenDesconocida>()("OrdenDesconocida", {
  orden: Schema.String,
}) {
  override get message() {
    return `Orden desconocida «${this.orden}». Usa «noche», «estado», «publicar», «copia» o «reserva».`;
  }
}

/** `reserva` sin su origen o su carpeta. */
class FaltanArgumentos extends Schema.TaggedError<FaltanArgumentos>()("FaltanArgumentos", {}) {
  override get message() {
    return "Uso: reserva <origen> <carpeta>. El origen es la URL pública de lo publicado o una carpeta.";
  }
}

const principal = Effect.gen(function* () {
  const [orden = "", ...argumentos] = process.argv.slice(2);
  if (orden === "reserva") {
    const path = yield* Path.Path;
    const [origen, carpeta] = argumentos;
    if (origen === undefined || carpeta === undefined) return yield* new FaltanArgumentos();
    const destino = path.resolve(carpeta);
    const copia = copiarReserva(origen.startsWith("http") ? origen : path.resolve(origen), destino);
    const capas = Layer.merge(
      almacenEnCarpeta({ carpeta: destino, origen: "/capas" }),
      FetchHttpClient.layer,
    );
    // El punto de entrada de la orden monta aquí sus capas, una vez.
    // @effect-diagnostics-next-line strictEffectProvide:off
    yield* copia.pipe(Effect.provide(capas));
    return;
  }
  const c = yield* configuracion;
  const base = baseNocturna({ fichero: c.base, interruptores: c.interruptores });
  const almacen = yield* almacenDesdeConfig;
  const zonas = yield* zonasDePublicacion;
  const reserva = yield* reservaDesdeConfig;
  const publicador = Option.match(almacen, {
    onNone: () => sinAlmacen,
    onSome: (capa) =>
      publicadorEn(zonas).pipe(
        Layer.provide(
          Option.match(reserva, {
            onNone: () => capa,
            onSome: (copia) => Layer.merge(capa, copia),
          }),
        ),
      ),
  });
  const extractores = Layer.succeed(
    Extractores,
    Extractores.of({
      registroOficial: RegistroOficial.capaPorCajas(c.registroOficial, c.fichasDelRegistro).pipe(
        Layer.provide(clienteHttpDelRegistro()),
      ),
      antenasMoviles: AntenasMoviles.capa({
        ...c.antenasMoviles,
        dentro: enLosCuadros(c.noche.puntos.zonas.flatMap((zona) => zona.cuadros)),
      }).pipe(Layer.provide(FetchHttpClient.layer)),
    }),
  );
  const entorno = Layer.mergeAll(
    publicador,
    extractores,
    Layer.succeed(Provincias, provinciasDe(zonas.municipios)),
  ).pipe(Layer.provideMerge(base));

  const efecto = Effect.gen(function* () {
    switch (orden) {
      case "noche":
        yield* noche(c.noche);
        return;
      case "estado":
        yield* estado(c.noche.proceso);
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
