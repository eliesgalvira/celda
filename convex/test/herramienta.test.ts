// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import type { Ficha } from "@celda/dominio/ficha";
import {
  AportacionConContexto,
  AportacionEnCola,
  VeredictoPropuesto,
} from "@celda/dominio/moderacion";
import { buzonAdministrado } from "@celda/moderacion/buzon";
import { LoPublicado } from "@celda/moderacion/publicado";
import { lanzar } from "@celda/moderacion/pruebas/orden";
import { assert, describe, it } from "@effect/vitest";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import refs from "../confect/_generated/refs";
import {
  correccion,
  corroboracion,
  identidadDesde,
  prepararBuzon,
  tablas,
  avanzar,
} from "./ayudas";
import * as TestConfect from "./TestConfect";

/**
 * La herramienta de moderación (`@celda/moderacion`) entera, con su cliente HTTP de verdad, contra
 * el Convex en memoria: cada petición llega a la función interna que nombra, como en la API HTTP
 * de Convex, y solo con la clave de administración de prueba.
 */

const IP = "203.0.113.7";
const URL_DE_PRUEBA = "http://convex.prueba";
const CLAVE = "clave-de-administracion-de-prueba";
const buzon = refs.public.buzon;

const Llamada = Schema.fromJsonString(
  Schema.Struct({
    path: Schema.String,
    format: Schema.Literal("convex_encoded_json"),
    args: Schema.Tuple([Schema.Record(Schema.String, Schema.Unknown)]),
  }),
);

/** Lo que contesta la API HTTP de Convex: lo que devuelve la función, su error o un rechazo. */
const RespuestaDeConvex = Schema.Union([
  Schema.Struct({ status: Schema.Literal("success"), value: Schema.Unknown }),
  Schema.Struct({
    status: Schema.Literal("error"),
    errorMessage: Schema.String,
    errorData: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({ code: Schema.String }),
]);
type RespuestaDeConvex = typeof RespuestaDeConvex.Type;
const codificarRespuesta = Schema.encodeEffect(Schema.fromJsonString(RespuestaDeConvex));
const decodificarLlamada = Schema.decodeUnknownEffect(Llamada);

/** Lo que contesta Convex a una función que ha ido bien o ha fallado. */
const respuestaDe = (
  llamada: Promise<Extract<RespuestaDeConvex, { status: "success" }>["value"]>,
) =>
  llamada.then(
    (value): RespuestaDeConvex => ({ status: "success", value }),
    (error): RespuestaDeConvex =>
      error instanceof ConvexError
        ? { status: "error", errorMessage: error.message, errorData: error.data }
        : { status: "error", errorMessage: String(error) },
  );

/** La API HTTP de Convex sobre el Convex en memoria. */
const apiDe = (convex: TestConfect.ConvexDePrueba) =>
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const responder = (estado: number, cuerpo: RespuestaDeConvex) =>
        Effect.map(codificarRespuesta(cuerpo), (texto) =>
          HttpClientResponse.fromWeb(request, new Response(texto, { status: estado })),
        );
      if (request.headers.authorization !== `Convex ${CLAVE}`) {
        return yield* responder(401, { code: "BadAdminKey" });
      }
      if (request.body._tag !== "Uint8Array") return yield* responder(400, { code: "SinCuerpo" });
      const llamada = yield* decodificarLlamada(new TextDecoder().decode(request.body.body));
      const [args] = llamada.args;
      const resultado = yield* Effect.promise(() =>
        respuestaDe(
          url.pathname === "/api/query"
            ? convex.crudo.query(makeFunctionReference<"query">(llamada.path), args)
            : convex.crudo.mutation(makeFunctionReference<"mutation">(llamada.path), args),
        ),
      );
      return yield* responder("value" in resultado ? 200 : 560, resultado);
    }).pipe(Effect.orDie),
  );

/** Campus Nord tal como está publicado: Movistar en el registro oficial. */
const FICHA: Ficha = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    {
      compania: "movistar",
      codigos: ["0802532"],
      bandas: [],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802532",
          fecha: Date.UTC(2026, 8, 26, 2, 15),
          afirma: "presente",
          historial: [],
        },
      ],
    },
  ],
  datosDel: Date.UTC(2026, 8, 26, 2, 15),
  version: Date.UTC(2026, 8, 26, 2, 15),
};

const publicado = Layer.succeed(
  LoPublicado,
  LoPublicado.of({
    version: Effect.succeed(Option.some("sitios@2026-09-26T02:15:00Z")),
    ficha: (clave) => Effect.succeed(clave === FICHA.clave ? Option.some(FICHA) : Option.none()),
    cercanos: () => Effect.succeed([]),
  }),
);

/** `moderar` con estos argumentos, contra el Convex en memoria y con la clave que se diga. */
const moderar = (argumentos: ReadonlyArray<string>, clave = CLAVE) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    const herramienta = Layer.merge(
      buzonAdministrado({ url: URL_DE_PRUEBA, clave: Redacted.make(clave) }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, apiDe(convex))),
      ),
      publicado,
    );
    return yield* lanzar(argumentos).pipe(Effect.provide(herramienta));
  });

const json = <A, I>(esquema: Schema.Codec<A, I>, texto: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(esquema))(texto).pipe(Effect.orDie);

const Contextos = Schema.Struct({
  formato: Schema.Literal(1),
  aportaciones: Schema.Array(AportacionConContexto),
});

const Propuestas = Schema.Struct({
  formato: Schema.Literal(1),
  propuestas: Schema.Array(
    Schema.Struct({ ...VeredictoPropuesto.fields, contexto: AportacionConContexto }),
  ),
});

const Veredictos = Schema.Struct({
  formato: Schema.Literal(1),
  resultados: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      hecho: Schema.Boolean,
      aportacion: Schema.optionalKey(AportacionEnCola),
      error: Schema.optionalKey(Schema.Struct({ tipo: Schema.String, mensaje: Schema.String })),
    }),
  ),
});

const Aceptadas = Schema.Struct({
  formato: Schema.Literal(1),
  aportaciones: Schema.Array(AportacionEnCola),
  ultima: Schema.NullOr(Schema.Finite),
});

prepararBuzon();

describe("herramienta de moderación contra el buzón", () => {
  it.effect(
    "la lista de pendientes da el registro, la distancia, el historial y lo demás del mismo emplazamiento",
    () =>
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const ana = yield* identidadDesde(IP);
        const otra = yield* identidadDesde(IP);
        const [aceptada, rechazada, pendiente] = [correccion(), correccion(), correccion()];
        for (const enviada of [aceptada, rechazada, pendiente]) {
          yield* convex
            .desde(IP)
            .mutation(buzon.enviarCorreccion, { identidad: ana, correccion: enviada });
          avanzar(1000);
        }
        const respaldo = corroboracion();
        yield* convex
          .desde(IP)
          .mutation(buzon.enviarCorroboracion, { identidad: otra, corroboracion: respaldo });
        yield* convex.mutation(refs.internal.moderacion.aceptar, {
          id: aceptada.id,
          motivo: "Se ve en la foto aérea",
        });
        yield* convex.mutation(refs.internal.moderacion.rechazar, {
          id: rechazada.id,
          motivo: "Repetida",
        });

        const lista = yield* moderar(["pendientes", "--tipo", "correccion-propuesta", "--json"]);
        assert.isTrue(Exit.isSuccess(lista.fin), lista.errores);
        const { aportaciones } = yield* json(Contextos, lista.salida);
        assert.deepStrictEqual(
          aportaciones.map((c) => c.aportacion.id),
          [pendiente.id],
        );
        const [contexto] = aportaciones;
        assert.isDefined(contexto);
        // El registro tal como está publicado y la distancia al punto propuesto (unos 73 m).
        assert.strictEqual(
          contexto.publicado?.estaciones[0]?.origenes[0]?.fuente,
          "registro-oficial",
        );
        assert.strictEqual(contexto.version, "sitios@2026-09-26T02:15:00Z");
        assert.closeTo(contexto.distanciaM ?? 0, 73, 2);
        assert.deepStrictEqual(contexto.historial, { aceptadas: 1, rechazadas: 1, pendientes: 0 });
        assert.deepStrictEqual(
          contexto.relacionadas.map((a) => [a.id, a.estado]),
          [
            [respaldo.id, "pendiente"],
            [rechazada.id, "rechazada"],
            [aceptada.id, "aceptada"],
          ],
        );

        // Lo mismo, para leerlo una persona.
        const texto = yield* moderar(["pendientes"]);
        assert.include(texto.salida, pendiente.id);
        assert.include(texto.salida, "registro oficial desde 2026-09-26 02:15 UTC");
        assert.include(texto.salida, "Distancia de la posición publicada al punto propuesto");
        assert.include(texto.salida, "1 aceptadas, 1 rechazadas");
        assert.include(texto.salida, "Sobre el mismo emplazamiento (3)");
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("pedir un veredicto propuesto no cambia ninguna aportación", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      const antes = yield* tablas;

      const propuestas = yield* moderar(["proponer", "--json"]);
      assert.isTrue(Exit.isSuccess(propuestas.fin), propuestas.errores);
      const [propuesta1] = (yield* json(Propuestas, propuestas.salida)).propuestas;
      assert.strictEqual(propuesta1?.id, propuesta.id);
      assert.strictEqual(propuesta1?.veredicto, "aceptar");
      assert.isAbove(propuesta1?.razones.length ?? 0, 0);
      const texto = yield* moderar(["proponer", propuesta.id]);
      assert.include(texto.salida, `pnpm -s moderar aceptar ${propuesta.id} --motivo`);

      assert.deepStrictEqual(yield* tablas, antes);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("aceptar o rechazar sin motivo da error y no cambia nada", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      const antes = yield* tablas;
      for (const orden of ["aceptar", "rechazar"]) {
        for (const motivo of ["", "   "]) {
          const lanzada = yield* moderar([orden, propuesta.id, "--motivo", motivo]);
          assert.isTrue(Exit.isFailure(lanzada.fin));
          assert.include(lanzada.errores, "Hace falta un motivo");
        }
        // Sin la opción, tampoco.
        assert.isTrue(Exit.isFailure((yield* moderar([orden, propuesta.id])).fin));
      }
      assert.deepStrictEqual(yield* tablas, antes);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "acepta y rechaza con su motivo, y exporta lo aceptado en orden y desde la última vez",
    () =>
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const identidad = yield* identidadDesde(IP);
        const enviadas = [correccion(), correccion(), correccion()];
        for (const enviada of enviadas) {
          yield* convex
            .desde(IP)
            .mutation(buzon.enviarCorreccion, { identidad, correccion: enviada });
        }
        const [primera, segunda, tercera] = enviadas.map((e) => e.id);
        assert.isDefined(primera);
        assert.isDefined(segunda);
        assert.isDefined(tercera);

        const aceptadas = yield* moderar([
          "aceptar",
          primera,
          segunda,
          "--motivo",
          "Se ve en la foto aérea",
          "--json",
        ]);
        assert.isTrue(Exit.isSuccess(aceptadas.fin), aceptadas.errores);
        const { resultados } = yield* json(Veredictos, aceptadas.salida);
        assert.deepStrictEqual(
          resultados.map((r) => [r.id, r.hecho, r.aportacion?.estado, r.aportacion?.motivo]),
          [
            [primera, true, "aceptada", "Se ve en la foto aérea"],
            [segunda, true, "aceptada", "Se ve en la foto aérea"],
          ],
        );
        const rechazo = yield* moderar(["rechazar", tercera, "--motivo", "El punto cae en el mar"]);
        assert.include(rechazo.salida, `Rechazada ${tercera}`);
        // Una aceptada no se rechaza, y la orden lo dice y acaba con error.
        const tarde = yield* moderar(["rechazar", primera, "--motivo", "Me lo pienso", "--json"]);
        assert.isTrue(Exit.isFailure(tarde.fin));
        assert.deepStrictEqual(
          (yield* json(Veredictos, tarde.salida)).resultados.map((r) => r.error?.tipo),
          ["AportacionYaModerada"],
        );

        const exportadas = yield* moderar(["aceptadas", "--json"]);
        const todas = yield* json(Aceptadas, exportadas.salida);
        assert.deepStrictEqual(
          todas.aportaciones.map((a) => a.id),
          [primera, segunda],
        );
        assert.strictEqual(todas.ultima, todas.aportaciones.at(-1)?.moderadaEl);
        const nada = yield* moderar(["aceptadas", "--despues-de", String(todas.ultima), "--json"]);
        assert.deepStrictEqual((yield* json(Aceptadas, nada.salida)).aportaciones, []);
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("una identidad vetada ya no puede enviar, y sus pendientes salen marcadas", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      const lista = yield* json(Contextos, (yield* moderar(["pendientes", "--json"])).salida);
      const quien = lista.aportaciones[0]?.aportacion.identidad ?? "";

      const veto = yield* moderar([
        "vetar",
        "identidad",
        quien,
        "--motivo",
        "Envía puntos en el mar",
      ]);
      assert.isTrue(Exit.isSuccess(veto.fin), veto.errores);
      assert.include(veto.salida, "ya no puede enviar nada");
      const otraVez = yield* moderar([
        "vetar",
        "identidad",
        quien,
        "--motivo",
        "Otra vez",
        "--json",
      ]);
      assert.include(otraVez.salida, '"nuevo":false');

      const error = yield* Effect.flip(
        convex.desde(IP).mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() }),
      );
      assert.deepInclude(error, { _tag: "Vetada", que: "identidad" });
      const marcada = yield* json(Contextos, (yield* moderar(["pendientes", "--json"])).salida);
      assert.deepStrictEqual(
        marcada.aportaciones.map((c) => [c.aportacion.id, c.aportacion.vetada]),
        [[propuesta.id, true]],
      );
      const texto = yield* moderar(["pendientes"]);
      assert.include(texto.salida, "VETADA");
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("sin la clave de administración, el buzón no contesta a la herramienta", () =>
    Effect.gen(function* () {
      const lanzada = yield* moderar(["pendientes"], "otra-clave");
      assert.isTrue(Exit.isFailure(lanzada.fin));
      assert.include(lanzada.errores, "Convex no acepta la clave");
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});
