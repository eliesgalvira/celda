// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { codificarVigente, versionDeCapa } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import { SIN_FILTRO } from "@celda/dominio/filtro";
import { parteDeClave } from "@celda/dominio/provincias";
import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import type { Agrupador } from "./agrupacion.ts";
import {
  atenderIndice,
  IndexadorDeProvincias,
  IndiceFallido,
  indexadorEnHilo,
  indexadorEnWorker,
  type PuertoIndexador,
  type RespuestaDeIndice,
  type SolicitudDeIndice,
} from "./indexador.ts";
import { type PublicacionDePrueba, publicacionDePrueba } from "./pruebas.ts";
import { capaDelOrigen, CapaEmplazamientos, type FalloCapa, origenDeCapas } from "./servicio.ts";

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

describe("origen de las capas", () => {
  it.effect("sin VITE_CAPAS_ORIGEN es /capas, en el mismo origen que la web (ADR 0018)", () =>
    Effect.gen(function* () {
      const origen = yield* origenDeCapas.pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
      );
      assert.strictEqual(origen, `${globalThis.location.origin}/capas`);
    }),
  );
});

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

describe("agrupación de una provincia con un filtro de compañías (ADR 0026)", () => {
  const conCompanias = (
    clave: string,
    longitud: number,
    companias: ReadonlyArray<Compania>,
  ): Ficha => ({
    ...ficha(clave, longitud),
    estaciones: companias.map((compania) => ({
      compania,
      codigos: [clave],
      bandas: [],
      bandasSinLeer: true,
      origenes: [],
    })),
  });
  const COMPANIAS = publicacionDePrueba(versionDeCapa(NOCHE), NOCHE, [
    conCompanias("m", 2.1134, ["movistar"]),
    conCompanias("mv", 2.15, ["movistar", "vodafone"]),
    conCompanias("o", 2.19, ["orange"]),
    conCompanias("d", 2.2, ["digi"]),
    conCompanias("y", 2.21, ["yoigo"]),
  ]);
  const MUNDO = {
    suroeste: { longitud: -180, latitud: -85 },
    noreste: { longitud: 180, latitud: 85 },
  };
  /** Las claves de los emplazamientos sueltos de una escena, con su papel. */
  const sueltos = (agrupador: Agrupador | undefined) =>
    [...(agrupador?.escena(17, MUNDO).elementos.values() ?? [])].flatMap((e) =>
      e.tipo === "emplazamiento"
        ? [`${e.emplazamiento.clave}${e.redUsada === true ? "·red" : ""}`]
        : [],
    );

  it.effect(
    "el Worker indexa una vez por provincia y filtro, sin descargar nada; volver a uno no le pide nada",
    () =>
      Effect.gen(function* () {
        const worker = workerDePrueba();
        const { resultado, peticiones } = yield* conCapa(
          origenCon(COMPANIAS),
          (capa) =>
            Effect.gen(function* () {
              yield* capa.provincia("08");
              const digi = yield* capa.agrupacion("08", ["digi"]);
              const otraVez = yield* capa.agrupacion("08", ["digi"]);
              const todas = yield* capa.agrupacion("08", SIN_FILTRO);
              const movistar = yield* capa.agrupacion("08", ["movistar"]);
              const digiDeNuevo = yield* capa.agrupacion("08", ["digi"]);
              return { digi, otraVez, todas, movistar, digiDeNuevo };
            }),
          indexadorEnWorker(worker.crear),
        );
        // La capa, Digi y Movistar: sin filtro es el agrupador de la provincia.
        assert.strictEqual(worker.recibidas(), 3);
        assert.strictEqual(resultado.otraVez, resultado.digi);
        assert.strictEqual(resultado.digiDeNuevo, resultado.digi);
        assert.strictEqual(resultado.todas.filtro, "todas");
        // El resumen, vigente.json y la capa: el filtro no descarga nada.
        assert.lengthOf(
          peticiones.filter((p) => p.startsWith("provincias/")),
          1,
        );
        assert.deepStrictEqual(sueltos(resultado.digi.propios), ["d"]);
        assert.deepStrictEqual(sueltos(resultado.digi.redUsada), ["m·red", "mv·red"]);
        assert.deepStrictEqual(sueltos(resultado.movistar.propios), ["m", "mv"]);
        assert.isUndefined(resultado.movistar.redUsada);
        assert.deepStrictEqual(sueltos(resultado.todas.propios), ["d", "m", "mv", "o", "y"]);
      }),
  );

  it.effect(
    "las del Worker dan las mismas escenas que las hechas en el hilo, a todos los zooms",
    () =>
      Effect.gen(function* () {
        const worker = workerDePrueba();
        const filtros: ReadonlyArray<ReadonlyArray<Compania>> = [
          ["digi"],
          ["yoigo"],
          ["movistar", "orange"],
        ];
        const enWorker = yield* conCapa(
          origenCon(COMPANIAS),
          (capa) => Effect.forEach(filtros, (f) => capa.agrupacion("08", f)),
          indexadorEnWorker(worker.crear),
        );
        const enHilo = yield* conCapa(origenCon(COMPANIAS), (capa) =>
          Effect.forEach(filtros, (f) => capa.agrupacion("08", f)),
        );
        for (const [i, deWorker] of enWorker.resultado.entries()) {
          const deHilo = enHilo.resultado[i];
          for (let nivel = 0; nivel <= 17; nivel++) {
            for (const parte of ["propios", "redUsada"] as const) {
              assert.deepStrictEqual(
                deWorker[parte]?.escena(nivel, MUNDO).elementos,
                deHilo?.[parte]?.escena(nivel, MUNDO).elementos,
                `${deWorker.filtro} ${parte} nivel ${nivel}`,
              );
            }
          }
        }
      }),
  );

  it.effect("dos peticiones a la vez del mismo filtro mandan una sola al Worker", () =>
    Effect.gen(function* () {
      const worker = workerDePrueba();
      const { resultado } = yield* conCapa(
        origenCon(COMPANIAS),
        (capa) =>
          Effect.all([capa.agrupacion("08", ["orange"]), capa.agrupacion("08", ["orange"])], {
            concurrency: 2,
          }),
        indexadorEnWorker(worker.crear),
      );
      assert.strictEqual(resultado[0], resultado[1]);
      assert.strictEqual(worker.recibidas(), 2);
    }),
  );

  it.effect("una petición cortada cuando el Worker ya la tiene se termina y se guarda", () =>
    Effect.gen(function* () {
      const worker = workerDePrueba();
      yield* conCapa(
        origenCon(COMPANIAS),
        (capa) =>
          Effect.gen(function* () {
            yield* capa.provincia("08");
            // Se corta antes de que conteste el Worker, que contesta en otra tarea.
            const fibra = yield* Effect.forkChild(capa.agrupacion("08", ["vodafone"]));
            yield* Effect.yieldNow;
            yield* Fiber.interrupt(fibra);
            yield* capa.agrupacion("08", ["vodafone"]);
          }),
        indexadorEnWorker(worker.crear),
      );
      assert.strictEqual(worker.recibidas(), 2);
    }),
  );

  it.effect("si el Worker falla, la agrupación se hace en el hilo", () =>
    Effect.gen(function* () {
      // La capa se lee en el hilo y el filtro va a un Worker que se cae.
      const seCae = Layer.effect(
        IndexadorDeProvincias,
        Effect.gen(function* () {
          const enHilo = yield* IndexadorDeProvincias;
          return IndexadorDeProvincias.of({
            indexar: enHilo.indexar,
            indexarFiltro: (provincia) =>
              Effect.fail(new IndiceFallido({ provincia, motivo: "se ha caído" })),
            leerPuntos: enHilo.leerPuntos,
          });
        }),
      ).pipe(Layer.provide(indexadorEnHilo));
      const { resultado } = yield* conCapa(
        origenCon(COMPANIAS),
        (capa) => capa.agrupacion("08", ["digi"]),
        seCae,
      );
      assert.deepStrictEqual(sueltos(resultado.propios), ["d"]);
      assert.deepStrictEqual(sueltos(resultado.redUsada), ["m·red", "mv·red"]);
    }),
  );
});

describe("dónde está una clave", () => {
  const parteDe = (publicacion: PublicacionDePrueba, clave: string) => {
    const partes = publicacion.resumen.claves ?? [];
    return partes[parteDeClave(clave, partes.length)] ?? "";
  };

  it.effect("la busca en la parte del índice que le toca, sin descargar ninguna capa", () =>
    Effect.gen(function* () {
      const { resultado, peticiones } = yield* conCapa(origenCon(HOY), (capa) =>
        Effect.all([capa.situarClave("movistar-a"), capa.situarClave("movistar-a")]),
      );
      const situada = Option.some({ clave: "movistar-a", provincia: "08" });
      assert.deepStrictEqual(resultado, [situada, situada]);
      // El resumen y una sola vez la parte: ni la capa de la provincia ni las otras partes.
      assert.deepStrictEqual(peticiones.slice(2), [parteDe(HOY, "movistar-a")]);
    }),
  );

  it.effect("una clave que ninguna provincia tiene no está", () =>
    Effect.gen(function* () {
      const { resultado } = yield* conCapa(origenCon(HOY), (capa) =>
        capa.situarClave("vodafone-nadie"),
      );
      assert.isTrue(Option.isNone(resultado));
    }),
  );

  it.effect("la de un emplazamiento que se juntó con otro lleva a la de ese otro", () =>
    Effect.gen(function* () {
      const juntado = publicacionDePrueba(versionDeCapa(NOCHE), NOCHE, FICHAS, 2, 4, [
        ["vodafone-juntado", "movistar-a"],
      ]);
      const { resultado } = yield* conCapa(origenCon(juntado), (capa) =>
        capa.situarClave("vodafone-juntado"),
      );
      assert.deepStrictEqual(resultado, Option.some({ clave: "movistar-a", provincia: "08" }));
    }),
  );

  it.effect("con un resumen de antes del índice, un enlace sin provincia es de Barcelona", () =>
    Effect.gen(function* () {
      const antes = publicacionDePrueba(versionDeCapa(NOCHE), NOCHE, FICHAS, 2, null);
      const { resultado, peticiones } = yield* conCapa(origenCon(antes), (capa) =>
        capa.situarClave("vodafone-nadie"),
      );
      assert.deepStrictEqual(resultado, Option.some({ clave: "vodafone-nadie", provincia: "08" }));
      assert.lengthOf(peticiones, 2);
    }),
  );

  it.effect("si la parte no llega, falla, y la siguiente vez la vuelve a pedir", () =>
    Effect.gen(function* () {
      const sinParte = origenCon(HOY);
      sinParte.delete(`${ORIGEN}/${parteDe(HOY, "movistar-a")}`);
      const { resultado, peticiones } = yield* conCapa(sinParte, (capa) =>
        Effect.all([
          Effect.exit(capa.situarClave("movistar-a")),
          Effect.exit(capa.situarClave("movistar-a")),
        ]),
      );
      assert.deepStrictEqual(resultado.map(errorDe), ["CapaNoDescargada", "CapaNoDescargada"]);
      assert.lengthOf(peticiones, 4);
    }),
  );
});

describe("los puntos de toda España (ADR 0028)", () => {
  it.effect("se leen en el Worker una vez por visita, con su GeoJSON, sin pedir provincias", () =>
    Effect.gen(function* () {
      const worker = workerDePrueba();
      const { resultado, peticiones } = yield* conCapa(
        origenCon(HOY),
        (capa) => Effect.zip(capa.puntos, capa.puntos),
        indexadorEnWorker(worker.crear),
      );
      const [puntos, otra] = resultado;
      assert.strictEqual(otra, puntos);
      assert.strictEqual(puntos.puntos.cuantos, FICHAS.length);
      assert.deepStrictEqual(puntos.puntos.provincias, ["08"]);
      const texto = new TextDecoder().decode(puntos.geojson);
      assert.match(texto, /^\{"type":"FeatureCollection","features":\[/u);
      assert.include(texto, '"id":2,');
      assert.notInclude(texto, '"id":3,');
      assert.strictEqual(worker.recibidas(), 1);
      assert.deepStrictEqual(
        peticiones.filter((p) => !p.startsWith("resumen@")),
        ["vigente.json", HOY.resumen.puntos],
      );
    }),
  );

  it.effect("si el origen no los tiene, no llegan", () =>
    Effect.gen(function* () {
      const sinPuntos = origenCon(HOY);
      sinPuntos.delete(`${ORIGEN}/${HOY.resumen.puntos}`);
      const { resultado } = yield* conCapa(sinPuntos, (capa) => Effect.exit(capa.puntos));
      assert.strictEqual(errorDe(resultado), "CapaNoDescargada");
    }),
  );
});
