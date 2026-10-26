// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import { PaginaParaPublicar } from "@celda/dominio/moderacion";
import { assert, beforeEach, describe, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { RUTA_DE_ACEPTADAS } from "../confect/http";
import refs from "../confect/_generated/refs";
import { VARIABLE_CLAVE_DE_PUBLICACION } from "../src/publicacion";
import {
  avanzar,
  correccion,
  corroboracion,
  identidadDesde,
  prepararBuzon,
  tablas,
} from "./ayudas";
import * as TestConfect from "./TestConfect";

/**
 * La acción HTTP que lee la publicación nocturna: solo con su clave, y solo lo aceptado, sin
 * huellas de IP ni identidades.
 */

const IP = "203.0.113.7";
/** Una clave de publicación de prueba, del largo mínimo. Nunca la de un despliegue. */
const CLAVE = "clave-de-publicacion-de-prueba-0123456789";
const buzon = refs.public.buzon;
const moderacion = refs.internal.moderacion;

const decodificarPagina = Schema.decodeUnknownEffect(Schema.fromJsonString(PaginaParaPublicar));

/** Pide lo aceptado a la acción HTTP, con la cabecera `Authorization` que se diga. */
const pedir = (autorizacion: string | undefined, consulta = "") =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    const respuesta = yield* convex.fetch(`${RUTA_DE_ACEPTADAS}${consulta}`, {
      method: "GET",
      headers: autorizacion === undefined ? {} : { authorization: autorizacion },
    });
    const texto = yield* Effect.promise(() => respuesta.text());
    return { estado: respuesta.status, texto, cache: respuesta.headers.get("cache-control") };
  });

prepararBuzon();
beforeEach(() => {
  vi.stubEnv(VARIABLE_CLAVE_DE_PUBLICACION, CLAVE);
});

/** Una corrección aceptada, una rechazada, una pendiente y una corroboración aceptada. */
const buzonConDeTodo = Effect.gen(function* () {
  const convex = yield* TestConfect.TestConfect;
  const identidad = yield* identidadDesde(IP);
  const [aceptada, rechazada, pendiente] = [
    correccion({ nota: "Lo veo desde mi ventana, en el 3.º 2.ª" }),
    correccion(),
    correccion(),
  ];
  for (const enviada of [aceptada, rechazada, pendiente]) {
    yield* convex.desde(IP).mutation(buzon.enviarCorreccion, { identidad, correccion: enviada });
  }
  const respaldo = corroboracion();
  yield* convex
    .desde(IP)
    .mutation(buzon.enviarCorroboracion, { identidad, corroboracion: respaldo });
  for (const id of [aceptada.id, respaldo.id]) {
    avanzar(1000);
    yield* convex.mutation(moderacion.aceptar, { id, motivo: "Bien" });
  }
  yield* convex.mutation(moderacion.rechazar, { id: rechazada.id, motivo: "No" });
  return { identidad, aceptada, respaldo, rechazada, pendiente };
});

describe("lo aceptado para la publicación nocturna, por HTTP", () => {
  it.effect("sin clave, con otra o sin la variable en el despliegue, un 401 vacío", () =>
    Effect.gen(function* () {
      yield* buzonConDeTodo;
      const sinClave = yield* pedir(undefined);
      const otra = yield* pedir(`Bearer ${CLAVE.slice(0, -1)}x`);
      const corta = yield* pedir(`Bearer ${CLAVE.slice(0, 10)}`);
      const sinBearer = yield* pedir(CLAVE);
      for (const respuesta of [sinClave, otra, corta, sinBearer]) {
        assert.deepStrictEqual(respuesta, { estado: 401, texto: "", cache: "no-store" });
      }
      // Sin la variable no pasa nadie, ni con la cabecera vacía.
      vi.stubEnv(VARIABLE_CLAVE_DE_PUBLICACION, "");
      assert.strictEqual((yield* pedir("Bearer ")).estado, 401);
      assert.strictEqual((yield* pedir(`Bearer ${CLAVE}`)).estado, 401);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("con la clave, solo lo aceptado para publicar, sin huellas, identidades ni notas", () =>
    Effect.gen(function* () {
      const { identidad, aceptada, respaldo } = yield* buzonConDeTodo;
      const respuesta = yield* pedir(`Bearer ${CLAVE}`);
      assert.strictEqual(respuesta.estado, 200);
      assert.strictEqual(respuesta.cache, "no-store");
      const pagina = yield* decodificarPagina(respuesta.texto);
      // Ni la rechazada ni la pendiente.
      assert.deepStrictEqual(
        pagina.aportaciones.map((a) => a.id),
        [aceptada.id, respaldo.id],
      );
      assert.isNull(pagina.ultima);
      assert.deepStrictEqual(pagina.aportaciones[0]?.contenido, { ...aceptada, nota: null });
      // La misma persona en las dos, y nada de lo que la identifica en el buzón.
      const [primera, segunda] = pagina.aportaciones;
      assert.strictEqual(primera?.persona, segunda?.persona);
      const { aportaciones, identidades, huellasDeIp } = yield* tablas;
      const [id = ""] = identidad.split(".");
      const prohibido = [
        id,
        identidad,
        ...identidades.map((i) => i._id),
        ...huellasDeIp.map((h) => h.huella),
        ...aportaciones.flatMap((a) => (a.huellaIp === null ? [] : [a.huellaIp])),
        "huellaIp",
        "identidad",
        "Lo veo desde mi ventana",
      ];
      for (const valor of prohibido) assert.notInclude(respuesta.texto, valor);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "sigue desde la última que se leyó, y un despues-de que no es un número es un 400",
    () =>
      Effect.gen(function* () {
        const { respaldo } = yield* buzonConDeTodo;
        const todas = yield* decodificarPagina((yield* pedir(`Bearer ${CLAVE}`)).texto);
        const ultima = todas.aportaciones.find((a) => a.id === respaldo.id)?.aceptadaEl;
        const despues = yield* pedir(`Bearer ${CLAVE}`, `?despues-de=${ultima}`);
        assert.deepStrictEqual((yield* decodificarPagina(despues.texto)).aportaciones, []);
        assert.strictEqual((yield* pedir(`Bearer ${CLAVE}`, "?despues-de=ayer")).estado, 400);
      }).pipe(Effect.provide(TestConfect.layer)),
  );
});
