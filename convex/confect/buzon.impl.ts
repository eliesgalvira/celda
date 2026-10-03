import { AportacionCompartible, type TipoCompartible } from "@celda/dominio/aportacion";
import { motivoNoAceptable } from "@celda/dominio/buzon";
import { emplazamientoDe } from "@celda/dominio/moderacion";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { claveDelBuzon } from "../src/claves";
import { apuntarHuella, huellaDeLaPeticion } from "../src/huella";
import { comprobarVetos, identidadDelToken, tokenDe } from "../src/identidad";
import { gastar, type NombreDeLimite } from "../src/limites";
import databaseSchema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter, MutationCtx } from "./_generated/services";
import buzon, {
  AportacionNoValida,
  ErrorDeEnvio,
  ErrorDeIdentidad,
  type FormaCorreccion,
  type FormaCorroboracion,
  type FormaMedida,
} from "./buzon.spec";

/** Lo que llega en un envío: una aportación con la forma que acepta Convex, sin comprobar. */
type FormaDeAportacion =
  | typeof FormaMedida.Type
  | typeof FormaCorreccion.Type
  | typeof FormaCorroboracion.Type;

/** Comprueba lo que llega con los esquemas del dominio: los rangos, los UUID y los largos. */
const leerAportacion = Schema.decodeUnknownEffect(AportacionCompartible);

/** Lo más largo que se devuelve del motivo de un rechazo, para no reenviar un argumento enorme. */
const LARGO_MAXIMO_MOTIVO = 300;

const noValida = (motivo: string) =>
  new AportacionNoValida({
    motivo:
      motivo.length > LARGO_MAXIMO_MOTIVO ? `${motivo.slice(0, LARGO_MAXIMO_MOTIVO)}…` : motivo,
  });

/** Los límites que gasta cada tipo de aportación: el del dispositivo, el de la IP y el total. */
const LIMITES_DE: Readonly<
  Record<TipoCompartible, readonly [NombreDeLimite, NombreDeLimite, NombreDeLimite | undefined]>
> = {
  propia: ["medidasPorDispositivo", "medidasPorIp", "medidasEnTotal"],
  "correccion-propuesta": [
    "correccionesPorDispositivo",
    "correccionesPorIp",
    "correccionesEnTotal",
  ],
  corroboracion: ["corroboracionesPorDispositivo", "corroboracionesPorIp", undefined],
};

/**
 * Deja pasar los errores que la función declara y convierte en defecto cualquier otro (un
 * documento que no se puede leer): Convex lo devuelve como error de servidor sin detalle.
 */
const soloDeclarados =
  <E>(declarados: Schema.Codec<E, unknown>) =>
  <A, Otro, R>(efecto: Effect.Effect<A, E | Otro, R>): Effect.Effect<A, E, R> =>
    Effect.catch(efecto, (error) =>
      Schema.is(declarados)(error) ? Effect.fail(error) : Effect.die(error),
    );

/**
 * Recibe una aportación compartida. En este orden: la clave del buzón, el token de identidad, la
 * huella de la IP, los vetos, el esquema del dominio, si ya estaba (entonces no gasta nada), si
 * es verosímil y los tres límites. Cualquier rechazo deshace todo lo anterior, también las fichas
 * gastadas. Solo devuelve si es nueva: nunca una aportación.
 */
const recibir = Effect.fn("Buzon.recibir")(function* (token: string, forma: FormaDeAportacion) {
  const clave = yield* claveDelBuzon;
  const ctx = yield* MutationCtx;
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const ahora = yield* Clock.currentTimeMillis;

  const identidad = yield* identidadDelToken(clave, token);
  const huellaIp = yield* huellaDeLaPeticion(clave);
  yield* comprobarVetos({ identidad: identidad._id, huellaIp });

  const aportacion = yield* leerAportacion(forma).pipe(
    Effect.mapError((error) => noValida(error.message)),
  );
  const previa = yield* reader
    .table("aportaciones")
    .index("por_id", (q) => q.eq("id", aportacion.id))
    .first();
  if (Option.isSome(previa)) return { nueva: false };

  const motivo = motivoNoAceptable(aportacion, ahora);
  if (motivo !== undefined) return yield* noValida(motivo);

  const [porDispositivo, porIp, enTotal] = LIMITES_DE[aportacion.tipo];
  yield* gastar(ctx, porDispositivo, "dispositivo", identidad._id);
  yield* gastar(ctx, porIp, "ip", huellaIp);
  if (enTotal !== undefined) yield* gastar(ctx, enTotal, "total");

  yield* writer.table("aportaciones").insert({
    id: aportacion.id,
    tipo: aportacion.tipo,
    identidad: identidad._id,
    huellaIp,
    recibidaEl: ahora,
    contenido: aportacion,
    emplazamiento: emplazamientoDe(aportacion),
    estado: "pendiente",
    moderadaEl: null,
    motivo: null,
  });
  yield* apuntarHuella(huellaIp);
  return { nueva: true };
});

const pedirIdentidad = FunctionImpl.make(databaseSchema, buzon, "pedirIdentidad", () =>
  Effect.gen(function* () {
    const clave = yield* claveDelBuzon;
    const ctx = yield* MutationCtx;
    const writer = yield* DatabaseWriter;
    const huellaIp = yield* huellaDeLaPeticion(clave);
    yield* comprobarVetos({ huellaIp });
    yield* gastar(ctx, "identidadesPorIp", "ip", huellaIp);
    const id = yield* writer
      .table("identidades")
      .insert({ creadaEl: yield* Clock.currentTimeMillis, huellaIp });
    yield* apuntarHuella(huellaIp);
    return { identidad: yield* tokenDe(clave, id) };
  }).pipe(soloDeclarados(ErrorDeIdentidad)),
);

const enviarMedida = FunctionImpl.make(databaseSchema, buzon, "enviarMedida", (args) =>
  recibir(args.identidad, args.medida).pipe(soloDeclarados(ErrorDeEnvio)),
);

const enviarCorreccion = FunctionImpl.make(databaseSchema, buzon, "enviarCorreccion", (args) =>
  recibir(args.identidad, args.correccion).pipe(soloDeclarados(ErrorDeEnvio)),
);

const enviarCorroboracion = FunctionImpl.make(
  databaseSchema,
  buzon,
  "enviarCorroboracion",
  (args) => recibir(args.identidad, args.corroboracion).pipe(soloDeclarados(ErrorDeEnvio)),
);

export default GroupImpl.make(databaseSchema, buzon).pipe(
  Layer.provide(pedirIdentidad),
  Layer.provide(enviarMedida),
  Layer.provide(enviarCorreccion),
  Layer.provide(enviarCorroboracion),
  GroupImpl.finalize,
);
