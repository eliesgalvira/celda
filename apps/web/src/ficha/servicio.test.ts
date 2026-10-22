// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type Baremo,
  ficheroDeBaremo,
  FORMATO_DEL_BAREMO,
  generarBaremo,
} from "@celda/dominio/baremo";
import { versionDeCapa } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { generarLoteDeProvincia } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  type CapaDePrueba,
  capaDePrueba,
  capaDePublicacion,
  FUENTE_DE_MUNICIPIOS,
  type PublicacionDePrueba,
  publicacionDePrueba,
} from "../capa/pruebas.ts";
import { CapaNoDescargada } from "../capa/servicio.ts";
import { type OrigenDePrueba, origenDePrueba } from "./pruebas.ts";
import { fichasDelOrigen, FichasPublicadas, LOTES_PRECARGADOS } from "./servicio.ts";

const ORIGEN = "http://capas.prueba";
const NOCHE = Date.UTC(2026, 8, 26, 2, 15, 3);
const DIA = 86_400_000;

const ficha = (clave: string, longitud: number, version = NOCHE): Ficha => ({
  clave,
  posicion: { longitud, latitud: 41.39 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: version,
  version,
});

// Dos vecinos en el Campus Nord y dos en la Sagrera: en lotes de dos, un lote por pareja.
const FICHAS = [
  ficha("movistar-a", 2.1134),
  ficha("orange-b", 2.1136),
  ficha("digi-c", 2.19),
  ficha("vodafone-d", 2.1902),
];

/** La publicación de unas fichas, en lotes de dos, con la URL y el cuerpo del lote de cada una. */
const publicada = (fecha: number, fichas: ReadonlyArray<Ficha>) => {
  const publicacion = publicacionDePrueba(versionDeCapa(fecha), fecha, fichas);
  return {
    publicacion,
    capa: capaDePublicacion(publicacion),
    urlDe: (clave: string) => `${ORIGEN}/${publicacion.loteDe(clave)}`,
    cuerpoDe: (clave: string) => publicacion.ficheros.get(publicacion.loteDe(clave)) ?? "",
  };
};

const HOY = publicada(NOCHE, FICHAS);

const pedida = (clave: string) => ({ clave, provincia: "08" });

/** El servicio real, con la capa de Barcelona dada y el origen de prueba. */
const conFichas = <A, E>(
  capa: Effect.Effect<CapaDePrueba, CapaNoDescargada>,
  origen: OrigenDePrueba,
  prueba: (fichas: FichasPublicadas["Service"]) => Effect.Effect<A, E>,
  anteriores: ReadonlyMap<string, string> = new Map(),
) =>
  Effect.flatMap(FichasPublicadas, prueba).pipe(
    Effect.provide(
      fichasDelOrigen.pipe(
        Layer.provide(capaDePrueba([capa], { anteriores })),
        Layer.provide(origen.capa),
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_CAPAS_ORIGEN: ORIGEN })),
        ),
      ),
    ),
  );

/** Contesta en cuanto `url` tenga una petición abierta. */
const contestar = (origen: OrigenDePrueba, url: string, estado: number, cuerpo: string) =>
  Effect.gen(function* () {
    while (!origen.abiertas().includes(url)) yield* Effect.yieldNow;
    origen.responder(url, { estado, cuerpo });
  });

/** Contesta con un fichero de una publicación en cuanto se pida. */
const servir = (origen: OrigenDePrueba, publicacion: PublicacionDePrueba, fichero: string) =>
  contestar(origen, `${ORIGEN}/${fichero}`, 200, publicacion.ficheros.get(fichero) ?? "");

describe("fichas publicadas en el origen estático", () => {
  it.effect(
    "un enlace sin provincia la busca antes; una clave que no está no pide ningún lote",
    () => {
      const origen = origenDePrueba();
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const [a] = FICHAS;
          const clave = a?.clave ?? "";
          const lectura = yield* Effect.forkChild(fichas.leer({ clave, provincia: null }));
          yield* contestar(origen, HOY.urlDe(clave), 200, HOY.cuerpoDe(clave));
          assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(a));
          const nadie = yield* fichas.leer({ clave: "movistar-nadie", provincia: null });
          assert.isTrue(Option.isNone(nadie));
          assert.deepStrictEqual(origen.pedidas(), [HOY.urlDe(clave)]);
        }),
      );
    },
  );

  it.effect(
    "lee la ficha del lote que dice su provincia, y otra del mismo lote no pide nada",
    () => {
      const origen = origenDePrueba();
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const [a, b] = FICHAS;
          assert.strictEqual(HOY.urlDe(a?.clave ?? ""), HOY.urlDe(b?.clave ?? ""));
          const lectura = yield* Effect.forkChild(fichas.leer(pedida(a?.clave ?? "")));
          const url = HOY.urlDe(a?.clave ?? "");
          yield* contestar(origen, url, 200, HOY.cuerpoDe(a?.clave ?? ""));
          assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(a));
          assert.deepStrictEqual(yield* fichas.leer(pedida(b?.clave ?? "")), Option.some(b));
          assert.deepStrictEqual(origen.pedidas(), [url]);
        }),
      );
    },
  );

  it.effect("dos lecturas a la vez del mismo lote hacen una sola petición", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const [a, b] = FICHAS;
        const lecturas = yield* Effect.forkChild(
          Effect.all([fichas.leer(pedida(a?.clave ?? "")), fichas.leer(pedida(b?.clave ?? ""))], {
            concurrency: 2,
          }),
        );
        yield* contestar(origen, HOY.urlDe(a?.clave ?? ""), 200, HOY.cuerpoDe(a?.clave ?? ""));
        assert.deepStrictEqual(yield* Fiber.join(lecturas), [Option.some(a), Option.some(b)]);
        assert.lengthOf(origen.pedidas(), 1);
      }),
    );
  });

  it.effect("la clave de un emplazamiento que se juntó con otro abre la ficha de ese otro", () => {
    const origen = origenDePrueba();
    const [a] = FICHAS;
    const clave = a?.clave ?? "";
    return conFichas(
      Effect.succeed(HOY.capa),
      origen,
      (fichas) =>
        Effect.gen(function* () {
          const lectura = yield* Effect.forkChild(fichas.leer(pedida("vodafone-juntado")));
          yield* contestar(origen, HOY.urlDe(clave), 200, HOY.cuerpoDe(clave));
          assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(a));
          assert.deepStrictEqual(origen.pedidas(), [HOY.urlDe(clave)]);
        }),
      new Map([["vodafone-juntado", clave]]),
    );
  });

  it.effect("una clave que la capa de su provincia no tiene no existe, y no se pide nada", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* fichas.leer(pedida("movistar-no-existe")), Option.none());
        assert.deepStrictEqual(origen.pedidas(), []);
      }),
    );
  });

  it.effect(
    "un fallo del origen, o un lote de otra provincia, llegan como FichaNoLeida y se reintenta",
    () => {
      const origen = origenDePrueba();
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const [a] = FICHAS;
          const clave = a?.clave ?? "";
          const url = HOY.urlDe(clave);
          const caida = yield* Effect.forkChild(Effect.exit(fichas.leer(pedida(clave))));
          yield* contestar(origen, url, 503, "");
          assert.isTrue(Exit.isFailure(yield* Fiber.join(caida)));

          const deGirona = generarLoteDeProvincia("17", FICHAS, new Map(), FUENTE_DE_MUNICIPIOS);
          const otra = yield* Effect.forkChild(Effect.exit(fichas.leer(pedida(clave))));
          yield* contestar(origen, url, 200, deGirona);
          assert.isTrue(Exit.isFailure(yield* Fiber.join(otra)));

          const buena = yield* Effect.forkChild(fichas.leer(pedida(clave)));
          yield* contestar(origen, url, 200, HOY.cuerpoDe(clave));
          assert.deepStrictEqual(yield* Fiber.join(buena), Option.some(a));
          assert.lengthOf(origen.pedidas(), 3);
        }),
      );
    },
  );

  it.effect("sin la capa de su provincia no hay ficha que leer", () => {
    const origen = origenDePrueba();
    return conFichas(
      Effect.fail(new CapaNoDescargada({ url: `${ORIGEN}/x.json`, motivo: "503" })),
      origen,
      (fichas) =>
        Effect.gen(function* () {
          const fallo = yield* Effect.flip(fichas.leer(pedida("movistar-a")));
          assert.strictEqual(fallo._tag, "FichaNoLeida");
        }),
    );
  });

  it.effect("cancelar la lectura cancela la petición del lote", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const clave = FICHAS[2]?.clave ?? "";
        const lectura = yield* Effect.forkChild(fichas.leer(pedida(clave)));
        while (origen.abiertas().length === 0) yield* Effect.yieldNow;
        yield* Fiber.interrupt(lectura);
        assert.deepStrictEqual(origen.canceladas(), [HOY.urlDe(clave)]);
        assert.deepStrictEqual(origen.abiertas(), []);
      }),
    );
  });

  it.effect("si el origen ya no tiene el lote del mapa, lee la ficha de la versión vigente", () => {
    const origen = origenDePrueba();
    // La ficha cambió al día siguiente y se publicó otra versión; el lote de hoy ya no está.
    const cambiada = ficha("movistar-a", 2.1134, NOCHE + DIA);
    const MANANA = publicada(NOCHE + DIA, [cambiada, ...FICHAS.slice(1)]).publicacion;
    const ficheroDe = (prefijo: string) =>
      [...MANANA.ficheros.keys()].find((f) => f.startsWith(prefijo)) ?? "";
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const lectura = yield* Effect.forkChild(fichas.leer(pedida("movistar-a")));
        yield* contestar(origen, HOY.urlDe("movistar-a"), 404, "");
        yield* servir(origen, MANANA, "vigente.json");
        yield* servir(origen, MANANA, ficheroDe("resumen@"));
        yield* servir(origen, MANANA, ficheroDe("provincias/08/"));
        yield* servir(origen, MANANA, MANANA.loteDe("movistar-a"));
        assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(cambiada));
      }),
    );
  });

  describe("precargar", () => {
    it.effect("descarga el lote de lo que se ve, y abrir después su ficha no pide nada", () => {
      const origen = origenDePrueba();
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const precarga = yield* Effect.forkChild(
            fichas.precargar([pedida("movistar-a"), pedida("orange-b")]),
          );
          yield* contestar(origen, HOY.urlDe("movistar-a"), 200, HOY.cuerpoDe("movistar-a"));
          yield* Fiber.join(precarga);
          assert.deepStrictEqual(yield* fichas.leer(pedida("orange-b")), Option.some(FICHAS[1]));
          assert.deepStrictEqual(origen.pedidas(), [HOY.urlDe("movistar-a")]);
        }),
      );
    });

    it.effect("pide como mucho LOTES_PRECARGADOS lotes, los que más claves tienen", () => {
      const origen = origenDePrueba();
      // Una tercera pareja en el Besòs: tres lotes de dos.
      const TRES = publicada(NOCHE, [
        ...FICHAS,
        ficha("movistar-e", 2.22),
        ficha("digi-f", 2.2202),
      ]);
      return conFichas(Effect.succeed(TRES.capa), origen, (fichas) =>
        Effect.gen(function* () {
          assert.strictEqual(LOTES_PRECARGADOS, 2);
          const precarga = yield* Effect.forkChild(
            fichas.precargar(["movistar-a", "digi-c", "vodafone-d", "movistar-e"].map(pedida)),
          );
          yield* contestar(origen, TRES.urlDe("digi-c"), 200, TRES.cuerpoDe("digi-c"));
          yield* contestar(origen, TRES.urlDe("movistar-a"), 200, TRES.cuerpoDe("movistar-a"));
          yield* Fiber.join(precarga);
          assert.sameMembers(
            [...origen.pedidas()],
            [TRES.urlDe("digi-c"), TRES.urlDe("movistar-a")],
          );
        }),
      );
    });

    it.effect("no falla si el lote no llega, y abrir la ficha lo vuelve a pedir", () => {
      const origen = origenDePrueba();
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const precarga = yield* Effect.forkChild(fichas.precargar([pedida("digi-c")]));
          yield* contestar(origen, HOY.urlDe("digi-c"), 503, "");
          assert.isTrue(Exit.isSuccess(yield* Fiber.await(precarga)));
          const lectura = yield* Effect.forkChild(fichas.leer(pedida("digi-c")));
          yield* contestar(origen, HOY.urlDe("digi-c"), 200, HOY.cuerpoDe("digi-c"));
          assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(FICHAS[2]));
          assert.lengthOf(origen.pedidas(), 2);
        }),
      );
    });
  });

  it.effect(
    "el baremo de una provincia se pide una vez; uno que no llega se vuelve a pedir la próxima vez",
    () => {
      const origen = origenDePrueba();
      const url = `${ORIGEN}/${ficheroDeBaremo(HOY.capa.version, "08")}`;
      const baremo: Baremo = {
        formato: FORMATO_DEL_BAREMO,
        version: HOY.capa.version,
        provincia: "08",
        tipica: { nivel: -7, pendiente: 0 },
        separacion: { nivel: 0.6, pendiente: 0 },
        zonaProvincial: null,
        municipios: [],
      };
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const caido = yield* Effect.forkChild(fichas.baremo("08"));
          yield* contestar(origen, url, 503, "");
          assert.isTrue(Option.isNone(yield* Fiber.join(caido)));

          const leido = yield* Effect.forkChild(fichas.baremo("08"));
          yield* contestar(origen, url, 200, generarBaremo(baremo));
          assert.deepStrictEqual(yield* Fiber.join(leido), Option.some(baremo));
          assert.deepStrictEqual(yield* fichas.baremo("08"), Option.some(baremo));
          assert.deepStrictEqual(origen.pedidas(), [url, url]);
        }),
      );
    },
  );
});
