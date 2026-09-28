// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type CapaLeida,
  codificarVigente,
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
import { capaDelOrigen, CapaEmplazamientos, type FalloCapa } from "./servicio.ts";

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

const VIGENTE: Respuesta = {
  estado: 200,
  cuerpo: codificarVigente({
    version: PUBLICADA.version,
    fecha: NOCHE,
    emplazamientos: 1,
    lotes: 1,
  }),
};

/**
 * El servicio real sobre un cliente HTTP de prueba que contesta por URL y apunta en orden las
 * peticiones que recibe. `cargar` hace las cargas que diga, una tras otra.
 */
const cargar = (respuestas: ReadonlyMap<string, Respuesta>, veces = 1) =>
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
    const salidas = yield* Effect.flatMap(CapaEmplazamientos, (s) =>
      Effect.forEach(Array.from({ length: veces }), () => Effect.exit(s.cargar)),
    ).pipe(
      Effect.provide(
        capaDelOrigen.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_CAPAS_ORIGEN: `${ORIGEN}/` })),
          ),
        ),
      ),
    );
    return { salidas, salida: salidas[0], peticiones: yield* Ref.get(peticiones) };
  });

/** La etiqueta del error con el que ha fallado la carga, si ha fallado. */
const errorDe = (salida: Exit.Exit<CapaLeida, FalloCapa> | undefined) =>
  salida !== undefined && Exit.isFailure(salida)
    ? Option.getOrNull(Option.map(Cause.findErrorOption(salida.cause), (e) => e._tag))
    : null;

describe("carga de la capa de emplazamientos", () => {
  it.effect("lee en el origen la versión vigente antes de descargar su fichero, sin Convex", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* cargar(
        new Map([
          [`${ORIGEN}/vigente.json`, VIGENTE],
          [`${ORIGEN}/${PUBLICADA.fichero}`, { estado: 200, cuerpo: PUBLICADA.contenido }],
        ]),
      );
      assert.deepStrictEqual(peticiones, [
        `GET ${ORIGEN}/vigente.json`,
        `GET ${ORIGEN}/${PUBLICADA.fichero}`,
      ]);
      assert.strictEqual(salida?._tag, "Success");
      if (salida?._tag === "Success") {
        assert.strictEqual(salida.value.version, PUBLICADA.version);
        assert.deepStrictEqual(salida.value.emplazamientos, [
          { ...CAMPUS_NORD, barrio: "21", lote: 0 },
        ]);
      }
    }),
  );

  it.effect("la capa que llega se queda para la visita; una que falla se vuelve a pedir", () =>
    Effect.gen(function* () {
      const bien = yield* cargar(
        new Map([
          [`${ORIGEN}/vigente.json`, VIGENTE],
          [`${ORIGEN}/${PUBLICADA.fichero}`, { estado: 200, cuerpo: PUBLICADA.contenido }],
        ]),
        3,
      );
      assert.isTrue(bien.salidas.every(Exit.isSuccess));
      assert.lengthOf(bien.peticiones, 2);

      const mal = yield* cargar(new Map([[`${ORIGEN}/vigente.json`, VIGENTE]]), 2);
      assert.deepStrictEqual(mal.salidas.map(errorDe), ["CapaNoDescargada", "CapaNoDescargada"]);
      assert.lengthOf(mal.peticiones, 4);
    }),
  );

  it.effect("no da por buena una capa de otra versión que la vigente", () =>
    Effect.gen(function* () {
      // Una caché intermedia devuelve el fichero de la noche anterior con el nombre nuevo.
      const { salida } = yield* cargar(
        new Map([
          [`${ORIGEN}/vigente.json`, VIGENTE],
          [`${ORIGEN}/${PUBLICADA.fichero}`, { estado: 200, cuerpo: ANTERIOR.contenido }],
        ]),
      );
      assert.strictEqual(errorDe(salida), "VersionDistinta");
    }),
  );

  it.effect("sin capa publicada, sin fichero o sin origen, falla con el motivo", () =>
    Effect.gen(function* () {
      const sinPublicar = yield* cargar(new Map());
      assert.strictEqual(errorDe(sinPublicar.salida), "SinCapaPublicada");
      assert.deepStrictEqual(sinPublicar.peticiones, [`GET ${ORIGEN}/vigente.json`]);

      const sinFichero = yield* cargar(new Map([[`${ORIGEN}/vigente.json`, VIGENTE]]));
      assert.strictEqual(errorDe(sinFichero.salida), "CapaNoDescargada");

      const caido = yield* cargar(
        new Map([[`${ORIGEN}/vigente.json`, { estado: 503, cuerpo: "" }]]),
      );
      assert.strictEqual(errorDe(caido.salida), "OrigenNoResponde");

      // Un servidor que contesta a todo con la página de la web.
      const html = yield* cargar(
        new Map([[`${ORIGEN}/vigente.json`, { estado: 200, cuerpo: "<!doctype html>" }]]),
      );
      assert.strictEqual(errorDe(html.salida), "OrigenNoResponde");
    }),
  );
});
