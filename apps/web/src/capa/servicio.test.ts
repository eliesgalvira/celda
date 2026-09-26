// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type CapaLeida,
  type CapaPublicada,
  type EmplazamientoDeCapa,
  generarCapa,
} from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { LIMITES_DE_PRUEBA } from "./pruebas.ts";
import { capaEnVivo, CapaEmplazamientos, type FalloCapa } from "./servicio.ts";

const CONVEX = "http://convex.prueba";
const ORIGEN = "http://capas.prueba";
const NOCHE = Date.UTC(2026, 8, 26, 2, 15);

const CAMPUS_NORD: EmplazamientoDeCapa = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113412, latitud: 41.389278 },
  estado: "verificado",
  companias: ["movistar", "vodafone", "orange"],
};
const PUBLICADA = generarCapa(NOCHE, [CAMPUS_NORD], LIMITES_DE_PRUEBA);
const ANTERIOR = generarCapa(NOCHE - 86_400_000, [CAMPUS_NORD], LIMITES_DE_PRUEBA);

interface Respuesta {
  readonly estado: number;
  readonly cuerpo: string;
}

const vigente = (valor: CapaPublicada | null): Respuesta => ({
  estado: 200,
  cuerpo: JSON.stringify({ status: "success", value: valor }),
});

const DE_PUBLICADA = vigente({
  version: PUBLICADA.version,
  fecha: NOCHE,
  url: `${ORIGEN}/${PUBLICADA.fichero}`,
  emplazamientos: 1,
});

/**
 * Carga la capa con el servicio real sobre un cliente HTTP de prueba que contesta por URL y
 * apunta en orden las peticiones que recibe.
 */
const cargar = (respuestas: ReadonlyMap<string, Respuesta>) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<string>>([]);
    const cliente = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Ref.update(peticiones, (p) => [...p, `${request.method} ${url.href}`]);
        const respuesta = respuestas.get(url.href) ?? { estado: 404, cuerpo: "no está" };
        return HttpClientResponse.fromWeb(
          request,
          new Response(respuesta.cuerpo, { status: respuesta.estado }),
        );
      }),
    );
    const salida = yield* Effect.flatMap(CapaEmplazamientos, (s) => s.cargar).pipe(
      Effect.provide(
        capaEnVivo.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_CONVEX_URL: CONVEX })),
          ),
        ),
      ),
      Effect.exit,
    );
    return { salida, peticiones: yield* Ref.get(peticiones) };
  });

/** La etiqueta del error con el que ha fallado la carga, si ha fallado. */
const errorDe = (salida: Exit.Exit<CapaLeida, FalloCapa>) =>
  Exit.isFailure(salida)
    ? Option.getOrNull(Option.map(Cause.findErrorOption(salida.cause), (e) => e._tag))
    : null;

describe("carga de la capa de emplazamientos", () => {
  it.effect("pregunta a Convex por la versión vigente antes de descargar su fichero", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* cargar(
        new Map([
          [`${CONVEX}/api/query`, DE_PUBLICADA],
          [`${ORIGEN}/${PUBLICADA.fichero}`, { estado: 200, cuerpo: PUBLICADA.contenido }],
        ]),
      );
      assert.deepStrictEqual(peticiones, [
        `POST ${CONVEX}/api/query`,
        `GET ${ORIGEN}/${PUBLICADA.fichero}`,
      ]);
      assert.strictEqual(salida._tag, "Success");
      if (salida._tag === "Success") {
        assert.strictEqual(salida.value.version, PUBLICADA.version);
        assert.deepStrictEqual(salida.value.emplazamientos, [{ ...CAMPUS_NORD, barrio: "21" }]);
        assert.deepStrictEqual(
          salida.value.barrios.map((b) => b.nombre),
          ["Pedralbes"],
        );
      }
    }),
  );

  it.effect("no da por buena una capa de otra versión que la vigente", () =>
    Effect.gen(function* () {
      // Una caché intermedia devuelve el fichero de la noche anterior con el nombre nuevo.
      const { salida } = yield* cargar(
        new Map([
          [`${CONVEX}/api/query`, DE_PUBLICADA],
          [`${ORIGEN}/${PUBLICADA.fichero}`, { estado: 200, cuerpo: ANTERIOR.contenido }],
        ]),
      );
      assert.strictEqual(errorDe(salida), "VersionDistinta");
    }),
  );

  it.effect("sin capa publicada, o sin fichero, falla con el motivo", () =>
    Effect.gen(function* () {
      const sinPublicar = yield* cargar(new Map([[`${CONVEX}/api/query`, vigente(null)]]));
      assert.strictEqual(errorDe(sinPublicar.salida), "SinCapaPublicada");
      assert.deepStrictEqual(sinPublicar.peticiones, [`POST ${CONVEX}/api/query`]);

      const sinFichero = yield* cargar(new Map([[`${CONVEX}/api/query`, DE_PUBLICADA]]));
      assert.strictEqual(errorDe(sinFichero.salida), "CapaNoDescargada");

      const sinBackend = yield* cargar(new Map());
      assert.strictEqual(errorDe(sinBackend.salida), "BackendNoResponde");
    }),
  );
});
