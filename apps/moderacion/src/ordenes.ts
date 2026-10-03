import type { TipoCompartible } from "@celda/dominio/aportacion";
import {
  AportacionConContexto,
  AportacionEnCola,
  Motivo,
  proponerVeredicto,
  TipoDeVeto,
  Veredicto,
} from "@celda/dominio/moderacion";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Argument from "effect/unstable/cli/Argument";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { BuzonAdministrado } from "./buzon.ts";
import { aceptadasDesde, contextosDe, pendientesConContexto } from "./contexto.ts";
import { fecha, textoContexto, textoVeredicto } from "./textos.ts";

/**
 * Las órdenes de la herramienta de moderación (ADR 0020). Están hechas para que las lance un
 * agente sin preguntar nada: todo va en los argumentos, y con `--json` cada una escribe un solo
 * objeto JSON en la salida, con `formato: 1` y los esquemas del dominio. Solo `aceptar`,
 * `rechazar` y `vetar` cambian algo en el buzón; `proponer` nunca.
 */

/** Dónde escribe la herramienta: lo que se pide, por la salida, y los avisos, por la de errores. */
export class Salida extends Context.Service<
  Salida,
  {
    readonly escribir: (texto: string) => Effect.Effect<void>;
    readonly avisar: (texto: string) => Effect.Effect<void>;
  }
>()("@celda/moderacion/ordenes/Salida") {}

/** El motivo de un veredicto o de un veto no vale: falta, está en blanco o es demasiado largo. */
export class MotivoNoValido extends Schema.TaggedError<MotivoNoValido>()("MotivoNoValido", {
  motivo: Schema.String,
}) {
  override get message() {
    return "Hace falta un motivo con texto, de 500 caracteres como mucho (--motivo).";
  }
}

/** Alguna de las aportaciones de una orden no se ha podido moderar. */
export class ModeracionIncompleta extends Schema.TaggedError<ModeracionIncompleta>()(
  "ModeracionIncompleta",
  { fallidas: Schema.Int },
) {
  override get message() {
    return `${this.fallidas} ${this.fallidas === 1 ? "aportación no se ha podido moderar" : "aportaciones no se han podido moderar"}.`;
  }
}

/** La versión de la salida en JSON. Cambia solo si cambia su forma de un modo incompatible. */
const FORMATO = Schema.Literal(1);

const SalidaDeContextos = Schema.Struct({
  formato: FORMATO,
  aportaciones: Schema.Array(AportacionConContexto),
});

const SalidaDePropuestas = Schema.Struct({
  formato: FORMATO,
  propuestas: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      veredicto: Veredicto,
      razones: Schema.Array(Schema.String),
      contexto: AportacionConContexto,
    }),
  ),
});

const ErrorEnJson = Schema.Struct({ tipo: Schema.String, mensaje: Schema.String });

const SalidaDeVeredictos = Schema.Struct({
  formato: FORMATO,
  resultados: Schema.Array(
    Schema.Union([
      Schema.Struct({
        id: Schema.String,
        hecho: Schema.Literal(true),
        aportacion: AportacionEnCola,
      }),
      Schema.Struct({ id: Schema.String, hecho: Schema.Literal(false), error: ErrorEnJson }),
    ]),
  ),
});

const SalidaDeVeto = Schema.Struct({
  formato: FORMATO,
  tipo: TipoDeVeto,
  valor: Schema.String,
  nuevo: Schema.Boolean,
});

const SalidaDeAceptadas = Schema.Struct({
  formato: FORMATO,
  aportaciones: Schema.Array(AportacionEnCola),
  /** La hora de aceptación de la última: desde ella sigue la siguiente exportación. */
  ultima: Schema.NullOr(Schema.Finite),
});

/** Escribe `valor` como una línea de JSON con su esquema. */
const escribirJson = <A, I>(esquema: Schema.Codec<A, I>, valor: A) =>
  Effect.gen(function* () {
    const salida = yield* Salida;
    const texto = yield* Schema.encodeEffect(Schema.fromJsonString(esquema))(valor).pipe(
      Effect.orDie,
    );
    yield* salida.escribir(texto);
  });

const escribir = (texto: string) => Effect.flatMap(Salida, (salida) => salida.escribir(texto));

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Escribe un solo objeto JSON (formato 1) en lugar del texto."),
  Flag.withDefault(false),
);

const TIPOS = [
  "correccion-propuesta",
  "corroboracion",
  "propia",
] as const satisfies ReadonlyArray<TipoCompartible>;

const tipo = Flag.Literals("tipo", TIPOS).pipe(
  Flag.withDescription("Solo las de este tipo. Sin él, todas."),
  Flag.optional,
);

const limite = Flag.Int("limite").pipe(
  Flag.withDescription("Cuántas, como mucho, de la más antigua a la más reciente."),
  Flag.withDefault(50),
);

const motivo = Flag.String("motivo").pipe(
  Flag.withDescription("Por qué. Obligatorio: queda en el buzón con el veredicto o el veto."),
);

const ids = Argument.String("id").pipe(
  Argument.withDescription("El identificador de la aportación (el UUID que puso el dispositivo)."),
);

const decodificarMotivo = Schema.decodeUnknownEffect(Motivo);

const motivoValido = (texto: string) =>
  decodificarMotivo(texto).pipe(
    Effect.mapError((error) => new MotivoNoValido({ motivo: error.message })),
  );

const filtro = (opciones: {
  readonly tipo: Option.Option<TipoCompartible>;
  readonly limite: number;
}) => ({
  tipos: Option.toArray(opciones.tipo),
  limite: Math.max(1, opciones.limite),
});

const escribirContextos = (
  contextos: ReadonlyArray<AportacionConContexto>,
  enJson: boolean,
  vacio: string,
) =>
  enJson
    ? escribirJson(SalidaDeContextos, { formato: 1, aportaciones: contextos })
    : escribir(
        contextos.length === 0
          ? vacio
          : contextos.map((c, i) => textoContexto(c, `${i + 1}/${contextos.length}`)).join("\n\n"),
      );

const pendientes = Command.make(
  "pendientes",
  { json, tipo, limite },
  Effect.fn("Moderacion.pendientes")(function* (opciones) {
    const contextos = yield* pendientesConContexto(filtro(opciones));
    yield* escribirContextos(contextos, opciones.json, "No hay nada pendiente.");
  }),
).pipe(
  Command.withDescription(
    "Las aportaciones pendientes con su contexto: lo publicado del emplazamiento, la distancia, el historial de quien las envía y lo demás del mismo emplazamiento. No cambia nada.",
  ),
);

const ver = Command.make(
  "ver",
  { json, ids: ids.pipe(Argument.atLeast(1)) },
  Effect.fn("Moderacion.ver")(function* (opciones) {
    const contextos = yield* contextosDe(opciones.ids);
    yield* escribirContextos(contextos, opciones.json, "");
  }),
).pipe(
  Command.withDescription(
    "Unas aportaciones concretas con su contexto, estén como estén. No cambia nada.",
  ),
);

const proponer = Command.make(
  "proponer",
  { json, tipo, limite, ids: ids.pipe(Argument.variadic()) },
  Effect.fn("Moderacion.proponer")(function* (opciones) {
    const contextos =
      opciones.ids.length > 0
        ? yield* contextosDe(opciones.ids)
        : yield* pendientesConContexto(filtro(opciones));
    const propuestas = contextos.map((contexto) => ({ ...proponerVeredicto(contexto), contexto }));
    if (opciones.json) {
      yield* escribirJson(SalidaDePropuestas, { formato: 1, propuestas });
      return;
    }
    yield* escribir(
      propuestas.length === 0
        ? "No hay nada pendiente."
        : propuestas
            .map(
              (p, i) =>
                `${textoContexto(p.contexto, `${i + 1}/${propuestas.length}`)}\n${textoVeredicto(p)}`,
            )
            .join("\n\n"),
    );
  }),
).pipe(
  Command.withDescription(
    "Un veredicto propuesto con su razonamiento para las pendientes, o para las que se digan. No cambia nada: aceptar o rechazar lo hace solo la orden explícita.",
  ),
);

/** Acepta o rechaza cada aportación con el motivo, y sigue con las demás si una falla. */
const moderarCada = (veredicto: "aceptar" | "rechazar") =>
  Effect.fn(`Moderacion.${veredicto}`)(function* (opciones: {
    readonly json: boolean;
    readonly motivo: string;
    readonly ids: ReadonlyArray<string>;
  }) {
    const buzon = yield* BuzonAdministrado;
    const motivo = yield* motivoValido(opciones.motivo);
    const resultados = yield* Effect.forEach(opciones.ids, (id) =>
      buzon[veredicto](id, motivo).pipe(
        Effect.map((aportacion) => ({ id, hecho: true as const, aportacion })),
        Effect.catch((error) =>
          Effect.succeed({
            id,
            hecho: false as const,
            error: { tipo: error._tag, mensaje: error.message },
          }),
        ),
      ),
    );
    if (opciones.json) {
      yield* escribirJson(SalidaDeVeredictos, { formato: 1, resultados });
    } else {
      yield* escribir(
        resultados
          .map((r) =>
            r.hecho
              ? `${r.aportacion.estado === "aceptada" ? "Aceptada" : "Rechazada"} ${r.id} el ${fecha(r.aportacion.moderadaEl ?? 0)}: ${r.aportacion.motivo ?? ""}`
              : `No se ha podido ${veredicto} ${r.id}: ${r.error.mensaje}`,
          )
          .join("\n"),
      );
    }
    const fallidas = resultados.filter((r) => !r.hecho).length;
    if (fallidas > 0) return yield* new ModeracionIncompleta({ fallidas });
  });

const aceptar = Command.make(
  "aceptar",
  { json, motivo, ids: ids.pipe(Argument.atLeast(1)) },
  moderarCada("aceptar"),
).pipe(
  Command.withDescription(
    "Acepta las aportaciones pendientes, con un motivo. La publicación nocturna las lleva a la ficha. Aceptar otra vez una aceptada no cambia nada; una rechazada no se puede aceptar.",
  ),
);

const rechazar = Command.make(
  "rechazar",
  { json, motivo, ids: ids.pipe(Argument.atLeast(1)) },
  moderarCada("rechazar"),
).pipe(
  Command.withDescription(
    "Rechaza las aportaciones pendientes, con un motivo. Nunca se publican. Una aceptada no se puede rechazar.",
  ),
);

const vetar = Command.make(
  "vetar",
  {
    json,
    motivo,
    tipo: Argument.Literals("tipo", TipoDeVeto.literals).pipe(
      Argument.withDescription("identidad (el _id de la identidad) o ip (la huella de la IP)."),
    ),
    valor: Argument.String("valor").pipe(
      Argument.withDescription("El valor que da la lista en «identidad» o «huella IP»."),
    ),
  },
  Effect.fn("Moderacion.vetar")(function* (opciones) {
    const buzon = yield* BuzonAdministrado;
    const motivo = yield* motivoValido(opciones.motivo);
    const { nuevo } = yield* buzon.vetar(opciones.tipo, opciones.valor, motivo);
    if (opciones.json) {
      yield* escribirJson(SalidaDeVeto, {
        formato: 1,
        tipo: opciones.tipo,
        valor: opciones.valor,
        nuevo,
      });
      return;
    }
    yield* escribir(
      nuevo
        ? `Vetada ${opciones.tipo === "ip" ? "la huella de IP" : "la identidad"} ${opciones.valor}: ya no puede enviar nada.`
        : `${opciones.valor} ya estaba vetada.`,
    );
  }),
).pipe(
  Command.withDescription(
    "Veta una identidad o una huella de IP: ya no puede enviar nada, y lo que tenga pendiente sale marcado. El veto de una huella dura lo que ella, 24 horas.",
  ),
);

const aceptadas = Command.make(
  "aceptadas",
  {
    json,
    despuesDe: Flag.Finite("despues-de").pipe(
      Flag.withDescription(
        "Solo las aceptadas después de esta hora (milisegundos desde 1970, el «ultima» de la exportación anterior).",
      ),
      Flag.optional,
    ),
  },
  Effect.fn("Moderacion.aceptadas")(function* (opciones) {
    const { aceptadas: todas, ultima } = yield* aceptadasDesde(
      Option.getOrNull(opciones.despuesDe),
    );
    if (opciones.json) {
      yield* escribirJson(SalidaDeAceptadas, { formato: 1, aportaciones: todas, ultima });
      return;
    }
    yield* escribir(
      [
        ...todas.map(
          (a) => `${fecha(a.moderadaEl ?? 0)} · ${a.id} · ${a.contenido.tipo} · ${a.motivo ?? ""}`,
        ),
        `${todas.length} aceptadas${ultima === null ? "" : `; la última, a las ${ultima} (--despues-de ${ultima})`}`,
      ].join("\n"),
    );
  }),
).pipe(
  Command.withDescription(
    "Exporta lo aceptado, en el orden en que se aceptó: lo mismo que lee la publicación nocturna. No cambia nada.",
  ),
);

/** `moderar`, con sus órdenes. */
export const moderar = Command.make("moderar").pipe(
  Command.withDescription(
    "La moderación de las aportaciones compartidas del buzón de Celda (ADR 0020). Lee CELDA_CONVEX_URL y CELDA_CONVEX_CLAVE, y lo publicado de CELDA_MODERACION_CAPAS.",
  ),
  Command.withSubcommands([pendientes, ver, proponer, aceptar, rechazar, vetar, aceptadas]),
);

/**
 * Lanza `moderar` con unos argumentos. Un error de las órdenes sale por la salida de errores con
 * su mensaje; los de los argumentos los escribe la propia línea de órdenes, con su ayuda, salvo
 * con `renderErrors: false`.
 */
export const lanzarModerar = (argumentos: ReadonlyArray<string>, renderErrors = true) =>
  Command.runWith(moderar, { version: "1", renderErrors })(argumentos).pipe(
    Effect.tapError((error) =>
      CliError.isCliError(error)
        ? Effect.void
        : Effect.flatMap(Salida, (salida) => salida.avisar(error.message)),
    ),
  );
