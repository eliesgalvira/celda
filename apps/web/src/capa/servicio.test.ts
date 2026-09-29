// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { codificarVigente, versionDeCapa } from "@celda/dominio/capa";
import { parteDeClave } from "@celda/dominio/provincias";
import type { Ficha } from "@celda/dominio/ficha";
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

import {
  atenderIndice,
  IndexadorDeProvincias,
  indexadorEnHilo,
  indexadorEnWorker,
  type PuertoIndexador,
  type RespuestaDeIndice,
  type SolicitudDeIndice,
} from "./indexador.ts";
import { type PublicacionDePrueba, publicacionDePrueba } from "./pruebas.ts";
import { capaDelOrigen, CapaEmplazamientos, type FalloCapa } from "./servicio.ts";

const ORIGEN = "http://capas.prueba";
const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

const ficha = (clave: string, longitud: number): Ficha => ({
  clave,
  posicion: { longitud, latitud: 41.39 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: NOCHE,
  version: NOCHE,
});

const FICHAS = [ficha("movistar-a", 2.1134), ficha("orange-b", 2.19), ficha("digi-c", 2.2)];
const HOY = publicacionDePrueba(versionDeCapa(NOCHE), NOCHE, FICHAS);

interface Respuesta {
  readonly estado: number;
  readonly cuerpo: string;
}

/** Las respuestas del origen con los ficheros de una publicación. */
const origenCon = (...publicaciones: ReadonlyArray<PublicacionDePrueba>) =>
  new Map<string, Respuesta>(
    publicaciones.flatMap((p) =>
      [...p.ficheros].map(([fichero, cuerpo]) => [`${ORIGEN}/${fichero}`, { estado: 200, cuerpo }]),
    ),
  );

/**
 * El servicio real sobre un cliente HTTP de prueba que contesta por URL y apunta en orden las
 * peticiones que recibe, con el indexador que se le pase.
 */
const conCapa = <A, E>(
  respuestas: ReadonlyMap<string, Respuesta>,
  prueba: (capa: CapaEmplazamientos["Service"]) => Effect.Effect<A, E>,
  indexador: Layer.Layer<IndexadorDeProvincias> = indexadorEnHilo,
) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<string>>([]);
    const cliente = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Ref.update(peticiones, (p) => [...p, url.href.slice(ORIGEN.length + 1)]);
        const respuesta = respuestas.get(url.href) ?? { estado: 404, cuerpo: "no está" };
        return HttpClientResponse.fromWeb(
          request,
          new Response(respuesta.cuerpo, { status: respuesta.estado }),
        );
      }),
    );
    const resultado = yield* Effect.flatMap(CapaEmplazamientos, prueba).pipe(
      Effect.provide(
        capaDelOrigen.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
          Layer.provide(indexador),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_CAPAS_ORIGEN: `${ORIGEN}/` })),
          ),
        ),
      ),
    );
    return { resultado, peticiones: yield* Ref.get(peticiones) };
  });

/** La etiqueta del error con el que ha fallado una carga, si ha fallado. */
const errorDe = <A>(salida: Exit.Exit<A, FalloCapa>) =>
  Exit.isFailure(salida)
    ? Option.getOrNull(Option.map(Cause.findErrorOption(salida.cause), (e) => e._tag))
    : null;

describe("carga del resumen nacional", () => {
  it.effect("lee en el origen la versión vigente antes de descargar su resumen, sin Convex", () =>
    Effect.gen(function* () {
      const { resultado, peticiones } = yield* conCapa(origenCon(HOY), (capa) => capa.resumen);
      assert.strictEqual(resultado.version, HOY.version);
      assert.deepStrictEqual(
        resultado.provincias.map((p) => [p.codigo, p.emplazamientos]),
        [["08", 3]],
      );
      assert.deepStrictEqual(peticiones, [
        "vigente.json",
        [...HOY.ficheros.keys()].find((f) => f.startsWith("resumen@")) ?? "",
      ]);
    }),
  );

  it.effect("el resumen que llega se queda para la visita; uno que falla se vuelve a pedir", () =>
    Effect.gen(function* () {
      const bien = yield* conCapa(origenCon(HOY), (capa) =>
        Effect.all([capa.resumen, capa.resumen, capa.resumen]),
      );
      assert.lengthOf(bien.peticiones, 2);

      const soloVigente = new Map([
        [`${ORIGEN}/vigente.json`, { estado: 200, cuerpo: HOY.ficheros.get("vigente.json") ?? "" }],
      ]);
      const mal = yield* conCapa(soloVigente, (capa) =>
        Effect.all([Effect.exit(capa.resumen), Effect.exit(capa.resumen)]),
      );
      assert.deepStrictEqual(mal.resultado.map(errorDe), ["CapaNoDescargada", "CapaNoDescargada"]);
      assert.lengthOf(mal.peticiones, 4);
    }),
  );

  it.effect("no da por bueno un resumen de otra versión que la vigente", () =>
    Effect.gen(function* () {
      // Una caché intermedia devuelve el resumen de la noche anterior con el nombre nuevo.
      const ayer = publicacionDePrueba(versionDeCapa(NOCHE - DIA), NOCHE - DIA, FICHAS);
      const respuestas = origenCon(HOY);
      const resumenDeHoy = [...HOY.ficheros.keys()].find((f) => f.startsWith("resumen@")) ?? "";
      const resumenDeAyer = [...ayer.ficheros].find(([f]) => f.startsWith("resumen@"))?.[1] ?? "";
      respuestas.set(`${ORIGEN}/${resumenDeHoy}`, { estado: 200, cuerpo: resumenDeAyer });
      const { resultado } = yield* conCapa(respuestas, (capa) => Effect.exit(capa.resumen));
      assert.strictEqual(errorDe(resultado), "VersionDistinta");
    }),
  );

  it.effect(
    "sin capa publicada, sin origen o con un vigente.json del formato 4, falla con el motivo",
    () =>
      Effect.gen(function* () {
        const sinPublicar = yield* conCapa(new Map(), (capa) => Effect.exit(capa.resumen));
        assert.strictEqual(errorDe(sinPublicar.resultado), "SinCapaPublicada");
        assert.deepStrictEqual(sinPublicar.peticiones, ["vigente.json"]);

        const caido = yield* conCapa(
          new Map([[`${ORIGEN}/vigente.json`, { estado: 503, cuerpo: "" }]]),
          (capa) => Effect.exit(capa.resumen),
        );
        assert.strictEqual(errorDe(caido.resultado), "OrigenNoResponde");

        // Un servidor que contesta a todo con la página de la web.
        const html = yield* conCapa(
          new Map([[`${ORIGEN}/vigente.json`, { estado: 200, cuerpo: "<!doctype html>" }]]),
          (capa) => Effect.exit(capa.resumen),
        );
        assert.strictEqual(errorDe(html.resultado), "OrigenNoResponde");

        const formato4 = yield* conCapa(
          new Map([
            [
              `${ORIGEN}/vigente.json`,
              {
                estado: 200,
                cuerpo: codificarVigente({
                  version: HOY.version,
                  fecha: NOCHE,
                  emplazamientos: 3,
                  lotes: 2,
                }),
              },
            ],
          ]),
          (capa) => Effect.exit(capa.resumen),
        );
        assert.strictEqual(errorDe(formato4.resultado), "CapaIlegible");
      }),
  );
});

describe("carga de una provincia", () => {
  it.effect("descarga su capa, la indexa y agrupa, y la segunda vez no pide nada", () =>
    Effect.gen(function* () {
      const { resultado, peticiones } = yield* conCapa(origenCon(HOY), (capa) =>
        Effect.all([capa.provincia("08"), capa.provincia("08")]),
      );
      const [barcelona, otraVez] = resultado;
      assert.strictEqual(barcelona, otraVez);
      assert.strictEqual(barcelona.version, HOY.version);
      assert.deepStrictEqual(
        barcelona.capa.emplazamientos.map((e) => [e.clave, e.provincia]),
        [
          ["digi-c", "08"],
          ["movistar-a", "08"],
          ["orange-b", "08"],
        ],
      );
      // De lejos, una sola agrupación con los tres; de cerca, sueltos.
      const mundo = {
        suroeste: { longitud: -180, latitud: -85 },
        noreste: { longitud: 180, latitud: 85 },
      };
      assert.strictEqual(barcelona.agrupador.escena(17, mundo).elementos.size, 3);
      assert.isTrue(
        [...barcelona.agrupador.escena(8, mundo).elementos.keys()].every((k) =>
          k.startsWith("a:08:"),
        ),
      );
      assert.lengthOf(peticiones, 3);
    }),
  );

  it.effect("si el origen ya no tiene su capa, lee la de la versión vigente y lo dice", () =>
    Effect.gen(function* () {
      const manana = publicacionDePrueba(versionDeCapa(NOCHE + DIA), NOCHE + DIA, [
        ...FICHAS,
        ficha("yoigo-d", 2.21),
      ]);
      const respuestas = origenCon(manana);
      // El resumen de hoy, que el mapa ya había leído, sigue; su capa de Barcelona, no.
      const resumenDeHoy = [...HOY.ficheros].find(([f]) => f.startsWith("resumen@"));
      if (resumenDeHoy !== undefined) {
        respuestas.set(`${ORIGEN}/${resumenDeHoy[0]}`, { estado: 200, cuerpo: resumenDeHoy[1] });
      }
      const vigenteDeHoy = HOY.ficheros.get("vigente.json") ?? "";
      let vigentes = 0;
      const { resultado } = yield* conCapa(respuestas, (capa) =>
        Effect.gen(function* () {
          // La visita empezó con la vigente de hoy.
          respuestas.set(`${ORIGEN}/vigente.json`, { estado: 200, cuerpo: vigenteDeHoy });
          yield* capa.resumen;
          vigentes += 1;
          respuestas.set(`${ORIGEN}/vigente.json`, {
            estado: 200,
            cuerpo: manana.ficheros.get("vigente.json") ?? "",
          });
          return yield* capa.provincia("08");
        }),
      );
      assert.strictEqual(vigentes, 1);
      assert.strictEqual(resultado.version, manana.version);
      assert.strictEqual(resultado.fecha, NOCHE + DIA);
      assert.lengthOf(resultado.capa.emplazamientos, 4);
    }),
  );

  it.effect("una provincia sin capa en el resumen no se pide", () =>
    Effect.gen(function* () {
      const { resultado, peticiones } = yield* conCapa(origenCon(HOY), (capa) =>
        Effect.exit(capa.provincia("17")),
      );
      assert.strictEqual(errorDe(resultado), "CapaIlegible");
      assert.lengthOf(peticiones, 2);
    }),
  );
});

/**
 * Un Worker de prueba para el indexador: recibe una copia de cada solicitud, la atiende como el de
 * verdad y contesta en otra tarea, pasando la respuesta por `structuredClone` con sus búferes.
 */
const workerDePrueba = (opciones: { readonly fallar?: boolean } = {}) => {
  let creados = 0;
  let recibidas = 0;
  const crear = (): PuertoIndexador => {
    creados += 1;
    let alResponder: (respuesta: RespuestaDeIndice) => void = () => undefined;
    let alFallar: (motivo: string) => void = () => undefined;
    return {
      enviar: (solicitud: SolicitudDeIndice) => {
        recibidas += 1;
        const copia = structuredClone(solicitud);
        // @effect-diagnostics-next-line globalTimers:off
        setTimeout(() => {
          if (opciones.fallar === true) {
            alFallar("se ha caído");
            return;
          }
          const { respuesta, transferibles } = atenderIndice(copia);
          alResponder(structuredClone(respuesta, { transfer: [...transferibles] }));
        }, 0);
      },
      escuchar: (responder, fallar) => {
        alResponder = responder;
        alFallar = fallar;
      },
      terminar: () => undefined,
    };
  };
  return { crear, creados: () => creados, recibidas: () => recibidas };
};

describe("índice de una provincia en un Worker", () => {
  it.effect("llega rehidratado y da las mismas escenas que el hecho en el hilo", () =>
    Effect.gen(function* () {
      const worker = workerDePrueba();
      const enWorker = yield* conCapa(
        origenCon(HOY),
        (capa) => capa.provincia("08"),
        indexadorEnWorker(worker.crear),
      );
      const enHilo = yield* conCapa(origenCon(HOY), (capa) => capa.provincia("08"));
      const mundo = {
        suroeste: { longitud: -180, latitud: -85 },
        noreste: { longitud: 180, latitud: 85 },
      };
      for (let nivel = 0; nivel <= 17; nivel++) {
        assert.deepStrictEqual(
          enWorker.resultado.agrupador.escena(nivel, mundo).elementos,
          enHilo.resultado.agrupador.escena(nivel, mundo).elementos,
          `nivel ${nivel}`,
        );
      }
      assert.strictEqual(worker.creados(), 1);
      assert.strictEqual(worker.recibidas(), 1);
    }),
  );

  it.effect("si el Worker falla, la provincia falla y se puede volver a pedir", () =>
    Effect.gen(function* () {
      const worker = workerDePrueba({ fallar: true });
      const { resultado } = yield* conCapa(
        origenCon(HOY),
        (capa) =>
          Effect.all([Effect.exit(capa.provincia("08")), Effect.exit(capa.provincia("08"))]),
        indexadorEnWorker(worker.crear),
      );
      assert.deepStrictEqual(resultado.map(errorDe), ["IndiceFallido", "IndiceFallido"]);
      assert.strictEqual(worker.creados(), 2);
    }),
  );
});

describe("provincia de una clave", () => {
  const parteDe = (publicacion: PublicacionDePrueba, clave: string) => {
    const partes = publicacion.resumen.claves ?? [];
    return partes[parteDeClave(clave, partes.length)] ?? "";
  };

  it.effect("la busca en la parte del índice que le toca, sin descargar ninguna capa", () =>
    Effect.gen(function* () {
      const { resultado, peticiones } = yield* conCapa(origenCon(HOY), (capa) =>
        Effect.all([capa.provinciaDeClave("movistar-a"), capa.provinciaDeClave("movistar-a")]),
      );
      assert.deepStrictEqual(resultado, [Option.some("08"), Option.some("08")]);
      // El resumen y una sola vez la parte: ni la capa de la provincia ni las otras partes.
      assert.deepStrictEqual(peticiones.slice(2), [parteDe(HOY, "movistar-a")]);
    }),
  );

  it.effect("una clave que ninguna provincia tiene no está", () =>
    Effect.gen(function* () {
      const { resultado } = yield* conCapa(origenCon(HOY), (capa) =>
        capa.provinciaDeClave("vodafone-nadie"),
      );
      assert.isTrue(Option.isNone(resultado));
    }),
  );

  it.effect("con un resumen de antes del índice, un enlace sin provincia es de Barcelona", () =>
    Effect.gen(function* () {
      const antes = publicacionDePrueba(versionDeCapa(NOCHE), NOCHE, FICHAS, 2, null);
      const { resultado, peticiones } = yield* conCapa(origenCon(antes), (capa) =>
        capa.provinciaDeClave("vodafone-nadie"),
      );
      assert.deepStrictEqual(resultado, Option.some("08"));
      assert.lengthOf(peticiones, 2);
    }),
  );

  it.effect("si la parte no llega, falla, y la siguiente vez la vuelve a pedir", () =>
    Effect.gen(function* () {
      const sinParte = origenCon(HOY);
      sinParte.delete(`${ORIGEN}/${parteDe(HOY, "movistar-a")}`);
      const { resultado, peticiones } = yield* conCapa(sinParte, (capa) =>
        Effect.all([
          Effect.exit(capa.provinciaDeClave("movistar-a")),
          Effect.exit(capa.provinciaDeClave("movistar-a")),
        ]),
      );
      assert.deepStrictEqual(resultado.map(errorDe), ["CapaNoDescargada", "CapaNoDescargada"]);
      assert.lengthOf(peticiones, 4);
    }),
  );
});
