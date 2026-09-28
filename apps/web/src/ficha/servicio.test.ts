// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type CapaLeida,
  codificarVigente,
  type EmplazamientoDeCapa,
  generarCapa,
  leerCapa,
  versionDeCapa,
} from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { capaDePrueba, LIMITES_DE_PRUEBA } from "../capa/pruebas.ts";
import { CapaNoDescargada } from "../capa/servicio.ts";
import { loteConFichas, type OrigenDePrueba, origenDePrueba } from "./pruebas.ts";
import { fichasDelOrigen, FichasPublicadas } from "./servicio.ts";

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
const deCapa = (f: Ficha): EmplazamientoDeCapa => ({
  clave: f.clave,
  posicion: f.posicion,
  estado: f.estado,
  companias: ["movistar"],
});

/** La capa publicada con esas fichas, en lotes de dos, tal como la lee la web. */
const publicada = (fecha: number, fichas: ReadonlyArray<Ficha>) => {
  const generada = generarCapa(fecha, fichas.map(deCapa), LIMITES_DE_PRUEBA, 2);
  const leida = leerCapa(generada.contenido, generada.version);
  if (Result.isFailure(leida)) throw new Error(leida.failure.message);
  const loteDe = (clave: string) => generada.lotes.findIndex((l) => l.includes(clave));
  const urlDe = (clave: string) =>
    `${ORIGEN}/fichas@${generada.version.slice("sitios@".length)}/${loteDe(clave)}.json`;
  const respuestaDe = (clave: string) =>
    loteConFichas(
      generada.version,
      loteDe(clave),
      fichas.filter((f) => generada.lotes[loteDe(clave)]?.includes(f.clave)),
    );
  return { generada, capa: leida.success, loteDe, urlDe, respuestaDe };
};

const HOY = publicada(NOCHE, FICHAS);

/** El servicio real, con la capa dada y el origen de prueba. */
const conFichas = <A, E>(
  capa: Effect.Effect<CapaLeida, CapaNoDescargada>,
  origen: OrigenDePrueba,
  prueba: (fichas: FichasPublicadas["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.flatMap(FichasPublicadas, prueba).pipe(
    Effect.provide(
      fichasDelOrigen.pipe(
        Layer.provide(capaDePrueba([capa])),
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

describe("fichas publicadas en el origen estático", () => {
  it.effect("lee la ficha del lote que dice la capa, y otra del mismo lote no pide nada", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const [a, b] = FICHAS;
        assert.strictEqual(HOY.loteDe(a?.clave ?? ""), HOY.loteDe(b?.clave ?? ""));
        const lectura = yield* Effect.forkChild(fichas.leer(a?.clave ?? ""));
        const url = HOY.urlDe(a?.clave ?? "");
        const { cuerpo } = HOY.respuestaDe(a?.clave ?? "");
        yield* contestar(origen, url, 200, cuerpo);
        assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(a));
        assert.deepStrictEqual(yield* fichas.leer(b?.clave ?? ""), Option.some(b));
        assert.deepStrictEqual(origen.pedidas(), [url]);
      }),
    );
  });

  it.effect("dos lecturas a la vez del mismo lote hacen una sola petición", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const [a, b] = FICHAS;
        const lecturas = yield* Effect.forkChild(
          Effect.all([fichas.leer(a?.clave ?? ""), fichas.leer(b?.clave ?? "")], {
            concurrency: 2,
          }),
        );
        yield* contestar(
          origen,
          HOY.urlDe(a?.clave ?? ""),
          200,
          HOY.respuestaDe(a?.clave ?? "").cuerpo,
        );
        assert.deepStrictEqual(yield* Fiber.join(lecturas), [Option.some(a), Option.some(b)]);
        assert.lengthOf(origen.pedidas(), 1);
      }),
    );
  });

  it.effect("una clave que la capa no tiene no existe, y no se pide nada", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* fichas.leer("movistar-no-existe"), Option.none());
        assert.deepStrictEqual(origen.pedidas(), []);
      }),
    );
  });

  it.effect(
    "un fallo del origen, o un lote de otra versión, llegan como FichaNoLeida y se reintenta",
    () => {
      const origen = origenDePrueba();
      return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
        Effect.gen(function* () {
          const [a] = FICHAS;
          const clave = a?.clave ?? "";
          const url = HOY.urlDe(clave);
          const caida = yield* Effect.forkChild(Effect.exit(fichas.leer(clave)));
          yield* contestar(origen, url, 503, "");
          const primera = yield* Fiber.join(caida);
          assert.isTrue(Exit.isFailure(primera));

          const ayer = publicada(NOCHE - DIA, FICHAS);
          const vieja = yield* Effect.forkChild(Effect.exit(fichas.leer(clave)));
          yield* contestar(origen, url, 200, ayer.respuestaDe(clave).cuerpo);
          const segunda = yield* Fiber.join(vieja);
          assert.isTrue(Exit.isFailure(segunda));

          const buena = yield* Effect.forkChild(fichas.leer(clave));
          yield* contestar(origen, url, 200, HOY.respuestaDe(clave).cuerpo);
          assert.deepStrictEqual(yield* Fiber.join(buena), Option.some(a));
          assert.lengthOf(origen.pedidas(), 3);
        }),
      );
    },
  );

  it.effect("sin la capa del mapa no hay ficha que leer", () => {
    const origen = origenDePrueba();
    return conFichas(
      Effect.fail(new CapaNoDescargada({ url: `${ORIGEN}/x.json`, motivo: "503" })),
      origen,
      (fichas) =>
        Effect.gen(function* () {
          const fallo = yield* Effect.flip(fichas.leer("movistar-a"));
          assert.strictEqual(fallo._tag, "FichaNoLeida");
        }),
    );
  });

  it.effect("cancelar la lectura cancela la petición del lote", () => {
    const origen = origenDePrueba();
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const clave = FICHAS[2]?.clave ?? "";
        const lectura = yield* Effect.forkChild(fichas.leer(clave));
        while (origen.abiertas().length === 0) yield* Effect.yieldNow;
        yield* Fiber.interrupt(lectura);
        assert.deepStrictEqual(origen.canceladas(), [HOY.urlDe(clave)]);
        assert.deepStrictEqual(origen.abiertas(), []);
      }),
    );
  });

  it.effect("si el origen ya no tiene el lote del mapa, lee la ficha de la versión vigente", () => {
    const origen = origenDePrueba();
    // La ficha cambió al día siguiente y se publicó otra versión; la de hoy ya no está.
    const cambiada = ficha("movistar-a", 2.1134, NOCHE + DIA);
    const MANANA = publicada(NOCHE + DIA, [cambiada, ...FICHAS.slice(1)]);
    return conFichas(Effect.succeed(HOY.capa), origen, (fichas) =>
      Effect.gen(function* () {
        const lectura = yield* Effect.forkChild(fichas.leer("movistar-a"));
        yield* contestar(origen, HOY.urlDe("movistar-a"), 404, "");
        yield* contestar(
          origen,
          `${ORIGEN}/vigente.json`,
          200,
          codificarVigente({
            version: versionDeCapa(NOCHE + DIA),
            fecha: NOCHE + DIA,
            emplazamientos: 4,
            lotes: 2,
          }),
        );
        yield* contestar(
          origen,
          `${ORIGEN}/${MANANA.generada.fichero}`,
          200,
          MANANA.generada.contenido,
        );
        yield* contestar(
          origen,
          MANANA.urlDe("movistar-a"),
          200,
          MANANA.respuestaDe("movistar-a").cuerpo,
        );
        assert.deepStrictEqual(yield* Fiber.join(lectura), Option.some(cambiada));
      }),
    );
  });
});
