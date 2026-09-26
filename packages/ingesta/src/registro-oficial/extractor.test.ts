// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { Extractor, RespuestaInesperada } from "../extractor.ts";
import { leerMuestra } from "../pruebas/grabado.ts";
import {
  clienteDePrueba,
  NO_HAY_ROBOTS,
  type Peticion,
  type Respondedor,
} from "../pruebas/http.ts";
import { esperarConReloj } from "../pruebas/reloj.ts";
import { capa, OPCIONES, type Opciones } from "./extractor.ts";
import type { Caja } from "../zona.ts";

const CAJA: Caja = [2.105, 41.382, 2.125, 41.392];

/** Bytes en ISO-8859-1, como los manda el geoportal. */
const latin1 = (texto: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(texto, (caracter) => caracter.charCodeAt(0));

/** `n` elementos del listado con claves que empiezan por `prefijo`, en la esquina de `caja`. */
const elementos = (n: number, prefijo: string, [oeste, sur]: Caja) =>
  latin1(
    JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: n }, (_, i) => ({
        type: "Feature",
        id: `TELEFONICA MOVILES ESPAÑA, S.A.U. - ${prefijo}${i}`,
        geometry: { type: "Point", coordinates: [oeste + 0.0001, sur + 0.0001] },
        properties: { Gis_ID: `${prefijo}${i}`, Dirección: "CL X, 1. BARCELONA, BARCELONA" },
      })),
    }),
  );

const opciones = (cambios: Partial<Opciones> = {}): Opciones => ({
  ...OPCIONES,
  zona: CAJA,
  ...cambios,
});

/** Ejecuta `programa` con el extractor real sobre el cliente de prueba y el reloj de prueba. */
const conExtractor = <A, E>(
  responder: Respondedor,
  programa: (extractor: typeof Extractor.Service) => Effect.Effect<A, E>,
  cambios: Partial<Opciones> = {},
) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const fibra = yield* Effect.gen(function* () {
      return yield* programa(yield* Extractor);
    }).pipe(
      Effect.provide(
        capa(opciones(cambios)).pipe(Layer.provide(clienteDePrueba(peticiones, responder))),
      ),
      Effect.exit,
      Effect.forkChild,
    );
    const salida = yield* esperarConReloj(fibra);
    return { salida, peticiones: yield* Ref.get(peticiones) };
  });

describe("extractor del registro oficial", () => {
  it.effect("pide robots.txt primero y se identifica con su User-Agent", () =>
    Effect.gen(function* () {
      const muestra = new Uint8Array(yield* leerMuestra("geojson-campus-nord.iso-8859-1.json"));
      const { salida, peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 200, cuerpo: muestra },
        (extractor) => extractor.listado,
      );
      assert.strictEqual(salida._tag, "Success");
      assert.deepStrictEqual(
        peticiones.map((p) => p.ruta),
        [
          "/robots.txt",
          "/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=2.105000,41.382000,2.125000,41.392000",
        ],
      );
      assert.isTrue(peticiones.every((p) => p.userAgent === OPCIONES.userAgent));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("divide la caja en cuatro cuando llega al tope de 1000 y quita los repetidos", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) => {
          if (url.pathname === "/robots.txt") {
            return NO_HAY_ROBOTS;
          }
          const caja = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
          const [oeste = 0, sur = 0, este = 0, norte = 0] = caja;
          const raiz = caja.join(",") === CAJA.join(",");
          // La caja entera llega al tope; cada cuarto tiene 300, y dos repiten un elemento.
          return {
            estado: 200,
            cuerpo: raiz
              ? elementos(1000, "R", [oeste, sur, este, norte])
              : elementos(300, sur === CAJA[1] ? "S" : `N${oeste}-`, [oeste, sur, este, norte]),
          };
        },
        (extractor) => extractor.listado,
      );
      assert.strictEqual(peticiones.length, 6);
      assert.strictEqual(salida._tag, "Success");
      if (salida._tag === "Success") {
        // Los dos cuartos del sur comparten claves: 300 + 2 × 300 del norte.
        assert.strictEqual(salida.value.registros.length, 900);
      }
    }),
  );

  it.effect("deja al menos la pausa entre el final de una respuesta y la siguiente petición", () =>
    Effect.gen(function* () {
      const { peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: elementos(1, "A", CAJA) },
        (extractor) => Effect.andThen(extractor.listado, extractor.listado),
      );
      const huecos = peticiones.slice(1).map((p, i) => p.en - (peticiones[i]?.en ?? 0));
      assert.strictEqual(peticiones.length, 3);
      assert.isTrue(huecos.every((hueco) => hueco >= Duration.toMillis(OPCIONES.pausa)));
    }),
  );

  it.effect("reintenta con espera exponencial los fallos pasajeros", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url, intento) => {
          if (url.pathname === "/robots.txt") {
            return NO_HAY_ROBOTS;
          }
          return intento < 2
            ? { estado: 503, cuerpo: "" }
            : { estado: 200, cuerpo: elementos(1, "A", CAJA) };
        },
        (extractor) => extractor.listado,
      );
      assert.strictEqual(salida._tag, "Success");
      const listados = peticiones.filter((p) => p.ruta !== "/robots.txt");
      assert.strictEqual(listados.length, 3);
      const [primera, segunda, tercera] = listados.map((p) => p.en);
      // La primera espera es la pausa y la segunda, el doble.
      assert.isAtLeast((segunda ?? 0) - (primera ?? 0), 3000);
      assert.isAtLeast((tercera ?? 0) - (segunda ?? 0), 6000);
    }),
  );

  it.effect("tras agotar los reintentos la fuente queda como no disponible", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 502, cuerpo: "" }),
        (extractor) => extractor.listado,
      );
      assert.strictEqual(peticiones.length, 1 + 1 + OPCIONES.reintentos);
      assert.strictEqual(salida._tag, "Failure");
      assert.include(String(salida), "FuenteNoDisponible");
    }),
  );

  it.effect("no pasa de su límite de peticiones", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: elementos(1000, "R", CAJA) },
        (extractor) => extractor.listado,
        { maxPeticiones: 3 },
      );
      assert.strictEqual(peticiones.length, 3);
      assert.include(String(salida), "LimiteDePeticiones");
    }),
  );

  it.effect("respeta robots.txt: si prohíbe la ruta no la pide", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? { estado: 200, cuerpo: "User-agent: Celda\nDisallow: /VCTEL/\n" }
            : { estado: 200, cuerpo: elementos(1, "A", CAJA) },
        (extractor) => extractor.listado,
      );
      assert.deepStrictEqual(
        peticiones.map((p) => p.ruta),
        ["/robots.txt"],
      );
      assert.include(String(salida), "ProhibidoPorRobots");
    }),
  );

  it.effect("una zona entera vacía es un fallo de la fuente, no un listado sin estaciones", () =>
    Effect.gen(function* () {
      const { salida } = yield* conExtractor(
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 200, cuerpo: "{}" }),
        (extractor) => Effect.flip(extractor.listado),
      );
      assert.deepStrictEqual(
        salida,
        Exit.succeed(
          new RespuestaInesperada({
            url: "https://geoportal.minetur.gob.es/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=2.105000,41.382000,2.125000,41.392000",
            motivo: "el listado de toda la zona está vacío",
          }),
        ),
      );
    }),
  );

  it.effect("una ficha con el aviso de código no válido es una respuesta inesperada", () =>
    Effect.gen(function* () {
      const html = new Uint8Array(yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"));
      const { salida } = yield* conExtractor(
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 200, cuerpo: html }),
        (extractor) =>
          extractor
            .ficha({
              clave: "ORANGE ESPAGNE, S.A.U. - CATR0228A",
              compania: "orange",
              codigo: "CATR0228A",
              posicion: { longitud: 2.113628, latitud: 41.388344 },
              direccion: "PZ EUSEBI GÜELL, 1. BARCELONA, BARCELONA",
              municipio: "BARCELONA",
              url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=CATR0228A",
            })
            .pipe(Effect.flip),
      );
      assert.deepStrictEqual(
        salida,
        Exit.succeed(
          new RespuestaInesperada({
            url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=CATR0228A",
            motivo: "La ficha dice «Código de emplazamiento no válido»",
          }),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
