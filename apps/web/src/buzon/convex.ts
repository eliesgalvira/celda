import type { AportacionCompartible } from "@celda/dominio/aportacion";
import refs from "@celda/convex/refs";
import { Ref } from "@confect/core";
import { ConvexHttpClient } from "convex/browser";
import type { DefaultFunctionArgs, FunctionReference } from "convex/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  type BuzonRemoto,
  BuzonCerrado,
  BuzonSinRespuesta,
  EnvioNoValido,
  EnvioVetado,
  IdentidadCaducada,
  LimiteDelBuzon,
} from "./sincronizacion.ts";

/**
 * El buzón de Convex (ADR 0020). Este módulo es el único de la web que importa el cliente de
 * Convex, y `sincronizacionDelNavegador` lo carga con `import()` al compartir la primera vez: va
 * en su propio trozo y una visita al mapa no lo descarga.
 *
 * Usa el cliente HTTP y no el de WebSocket: cada envío es una petición, y sin envíos no hay
 * ninguna conexión abierta ni nada que mantener vivo.
 */

/** Un límite del servidor, con la hora local en que se puede reintentar. */
const limite = (error: {
  readonly ambito: LimiteDelBuzon["ambito"];
  readonly reintentarEn: number;
}) =>
  Effect.flatMap(Clock.currentTimeMillis, (ahora) =>
    Effect.fail(
      new LimiteDelBuzon({ ambito: error.ambito, reintentarA: ahora + error.reintentarEn }),
    ),
  );

const sinRespuesta = (motivo: string) => new BuzonSinRespuesta({ motivo });

export const buzonDeConvex = (direccion: string): BuzonRemoto => {
  const cliente = new ConvexHttpClient(direccion, { logger: false });
  const buzon = refs.public.buzon;

  const llamar = <Funcion extends Ref.AnyPublicMutation>(
    funcion: Funcion,
    args: Ref.Args<Funcion>,
  ) =>
    Ref.runWithCodec(
      funcion,
      args,
      (referencia: FunctionReference<"mutation", "public">, codificados) =>
        // SAFETY: `Ref.runWithCodec` ha codificado los argumentos con el esquema de la función:
        // son un objeto de valores de Convex.
        cliente.mutation(referencia, codificados as DefaultFunctionArgs),
      // Lo que no es un error del buzón: la red, o un despliegue apagado por sus umbrales.
      (causa) => sinRespuesta(String(causa)),
    ).pipe(Effect.catchTag("SchemaError", (error) => Effect.fail(sinRespuesta(error.message))));

  const enviarSegunTipo = (identidad: string, aportacion: AportacionCompartible) => {
    switch (aportacion.tipo) {
      case "correccion-propuesta":
        return llamar(buzon.enviarCorreccion, { identidad, correccion: aportacion });
      case "corroboracion":
        return llamar(buzon.enviarCorroboracion, { identidad, corroboracion: aportacion });
    }
  };

  return {
    pedirIdentidad: llamar(buzon.pedirIdentidad, {}).pipe(
      Effect.map(({ identidad }) => identidad),
      Effect.catchTags({
        LimiteAlcanzado: limite,
        BuzonCerrado: () => Effect.fail(new BuzonCerrado()),
        Vetada: (error) => Effect.fail(new EnvioVetado({ que: error.que })),
      }),
    ),
    enviar: (identidad, aportacion) =>
      enviarSegunTipo(identidad, aportacion).pipe(
        Effect.catchTags({
          LimiteAlcanzado: limite,
          BuzonCerrado: () => Effect.fail(new BuzonCerrado()),
          Vetada: (error) => Effect.fail(new EnvioVetado({ que: error.que })),
          AportacionNoValida: (error) => Effect.fail(new EnvioNoValido({ motivo: error.motivo })),
          IdentidadNoValida: () => Effect.fail(new IdentidadCaducada()),
        }),
      ),
  };
};
