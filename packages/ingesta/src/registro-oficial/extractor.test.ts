// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ArchivoDePaginas, type PaginaDelRegistro } from "../archivo.ts";
import type { OpcionesCliente } from "../cliente.ts";
import {
  ExtractorPorCajas,
  FuenteBloqueada,
  type Registro,
  SinFichaEnElRegistro,
} from "../extractor.ts";
import { leerMuestra } from "../pruebas/grabado.ts";
import {
  clienteDePrueba,
  NO_HAY_ROBOTS,
  type Peticion,
  type Respondedor,
} from "../pruebas/http.ts";
import { esperarConReloj } from "../pruebas/reloj.ts";
import { capaPorCajas, OPCIONES } from "./extractor.ts";
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

/** Opciones del listado y, si van aparte, de las fichas, sobre las de siempre. */
interface Cambios {
  readonly listado?: Partial<OpcionesCliente>;
  readonly fichas?: Partial<OpcionesCliente>;
}

/**
 * Ejecuta `programa` con el extractor real sobre el cliente de prueba y el reloj de prueba, con
 * las fichas a otro ritmo que el listado si se le da `fichas`.
 */
const conExtractor = <A, E>(
  responder: Respondedor,
  programa: (extractor: typeof ExtractorPorCajas.Service) => Effect.Effect<A, E>,
  cambios: Cambios = {},
) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const fibra = yield* Effect.gen(function* () {
      return yield* programa(yield* ExtractorPorCajas);
    }).pipe(
      Effect.provide(
        capaPorCajas(
          { ...OPCIONES, ...cambios.listado },
          cambios.fichas === undefined ? undefined : { ...OPCIONES, ...cambios.fichas },
        ).pipe(Layer.provide(clienteDePrueba(peticiones, responder))),
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
        (extractor) => extractor.caja(CAJA),
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

  it.effect("deja al menos la pausa entre el final de una respuesta y la siguiente petición", () =>
    Effect.gen(function* () {
      const { peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: elementos(1, "A", CAJA) },
        (extractor) => Effect.andThen(extractor.caja(CAJA), extractor.caja(CAJA)),
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
        (extractor) => extractor.caja(CAJA),
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
        (extractor) => extractor.caja(CAJA),
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
            : { estado: 200, cuerpo: elementos(1, "A", CAJA) },
        (extractor) => Effect.forEach([CAJA, CAJA, CAJA], (caja) => extractor.caja(caja)),
        { listado: { maxPeticiones: 3 } },
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
        (extractor) => extractor.caja(CAJA),
      );
      assert.deepStrictEqual(
        peticiones.map((p) => p.ruta),
        ["/robots.txt"],
      );
      assert.include(String(salida), "ProhibidoPorRobots");
    }),
  );

  it.effect(
    "una ficha con el aviso de código no válido es una estación base sin ficha en el registro",
    () =>
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
            new SinFichaEnElRegistro({
              url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=CATR0228A",
              motivo: "La ficha dice «Código de emplazamiento no válido»",
            }),
          ),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

const FICHA: Registro = {
  clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942",
  compania: "movistar",
  codigo: "0800942",
  posicion: { longitud: 2.113886, latitud: 41.390648 },
  direccion: "VP Eusebi Güell, 6. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0800942",
};

describe("fichas del registro oficial y bloqueos del geoportal", () => {
  it.effect("las fichas van a su pausa sobre la misma conexión que el listado", () =>
    Effect.gen(function* () {
      const html = new Uint8Array(yield* leerMuestra("detalle-telefonica-0800942.iso-8859-1.html"));
      const { salida, peticiones } = yield* conExtractor(
        (url) => {
          if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
          if (url.pathname === "/VCTEL/detalleEstacion.do") return { estado: 200, cuerpo: html };
          return { estado: 200, cuerpo: elementos(1, "A", CAJA) };
        },
        (extractor) =>
          Effect.gen(function* () {
            yield* extractor.caja(CAJA);
            yield* extractor.ficha(FICHA);
            yield* extractor.ficha(FICHA);
            return yield* extractor.peticiones;
          }),
        { fichas: { pausa: Duration.seconds(5), maxPeticiones: 2 } },
      );
      assert.deepStrictEqual(salida, Exit.succeed(4));
      // robots.txt una sola vez; la primera ficha espera sus 5 s desde la caja.
      assert.deepStrictEqual(
        peticiones.map((p) => [p.ruta.split("?")[0], p.en]),
        [
          ["/robots.txt", 0],
          ["/VCTEL/infoantenasGeoJSON.do", 3000],
          ["/VCTEL/detalleEstacion.do", 8000],
          ["/VCTEL/detalleEstacion.do", 13000],
        ],
      );
      assert.isTrue(peticiones.every((p) => p.userAgent === OPCIONES.userAgent));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("las fichas tienen su propio tope, aparte del del listado", () =>
    Effect.gen(function* () {
      const html = new Uint8Array(yield* leerMuestra("detalle-telefonica-0800942.iso-8859-1.html"));
      const { salida } = yield* conExtractor(
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 200, cuerpo: html }),
        (extractor) => Effect.flip(Effect.andThen(extractor.ficha(FICHA), extractor.ficha(FICHA))),
        { fichas: { maxPeticiones: 1 } },
      );
      assert.include(String(salida), "LimiteDePeticiones");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un 403 en una ficha es la fuente bloqueando a Celda: no se reintenta", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 403, cuerpo: "Forbidden" },
        (extractor) => Effect.flip(extractor.ficha(FICHA)),
      );
      assert.deepStrictEqual(
        salida,
        Exit.succeed(new FuenteBloqueada({ url: FICHA.url, motivo: "HTTP 403" })),
      );
      assert.strictEqual(peticiones.length, 2);
    }),
  );

  it.effect("una página que no es una ficha del geoportal es la fuente bloqueando a Celda", () =>
    Effect.gen(function* () {
      const { salida } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: "<html><body>Request rejected</body></html>" },
        (extractor) => Effect.flip(extractor.ficha(FICHA)),
      );
      assert.deepStrictEqual(
        salida,
        Exit.succeed(
          new FuenteBloqueada({
            url: FICHA.url,
            motivo: "una página que no es una ficha del geoportal",
          }),
        ),
      );
    }),
  );

  it.effect("un listado que llega en HTML es la fuente bloqueando a Celda", () =>
    Effect.gen(function* () {
      const { salida } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: "\n<!DOCTYPE html><html>Mantenimiento</html>" },
        (extractor) => Effect.flip(extractor.caja(CAJA)),
      );
      assert.strictEqual(salida._tag, "Success");
      if (salida._tag === "Success") {
        assert.strictEqual(salida.value._tag, "FuenteBloqueada");
      }
    }),
  );
});

describe("archivo de páginas", () => {
  /** Un archivo en memoria que apunta cada página que le llega. */
  const archivoEnMemoria = Effect.map(
    Ref.make<ReadonlyArray<PaginaDelRegistro>>([]),
    (paginas) => ({
      paginas: Ref.get(paginas),
      archivo: ArchivoDePaginas.of({
        archivar: (pagina) => Ref.update(paginas, (p) => [...p, pagina]),
      }),
    }),
  );

  it.effect("archiva con sus bytes cada página que llega con HTTP 200, se pueda leer o no", () =>
    Effect.gen(function* () {
      const ficha = new Uint8Array(
        yield* leerMuestra("detalle-telefonica-0800942.iso-8859-1.html"),
      );
      const sinFicha = new Uint8Array(
        yield* leerMuestra("detalle-codigo-no-valido.iso-8859-1.html"),
      );
      const listado = elementos(1, "A", CAJA);
      const ilegible = latin1('<table class="tablaDetalleEstacion"><tr><td>Obras</td></tr>');
      const ajena = latin1("<html><body>Request rejected</body></html>");
      const respuestas = new Map<string, Uint8Array<ArrayBuffer>>([
        ["leida", ficha],
        ["sin-ficha", sinFicha],
        ["ilegible", ilegible],
        ["ajena", ajena],
      ]);
      const { paginas, archivo } = yield* archivoEnMemoria;
      const { salida } = yield* conExtractor(
        (url) => {
          if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
          if (url.pathname === "/VCTEL/infoantenasGeoJSON.do") {
            return { estado: 200, cuerpo: listado };
          }
          const cuerpo = respuestas.get(url.searchParams.get("emplazamiento") ?? "");
          return cuerpo === undefined
            ? { estado: 403, cuerpo: "Forbidden" }
            : { estado: 200, cuerpo };
        },
        (extractor) =>
          Effect.gen(function* () {
            yield* extractor.caja(CAJA);
            for (const cual of ["leida", "sin-ficha", "ilegible", "ajena", "prohibida"]) {
              const url = `https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=${cual}`;
              yield* Effect.exit(extractor.ficha({ ...FICHA, clave: `C - ${cual}`, url }));
            }
          }).pipe(Effect.provideService(ArchivoDePaginas, archivo)),
      );
      assert.strictEqual(salida._tag, "Success");
      const archivadas = yield* paginas;
      // El 403 no se archiva: no trae nada del registro.
      assert.deepStrictEqual(
        archivadas.map((p) => [p.tipo, p.clave, p.resultado]),
        [
          ["listado", undefined, "leida"],
          ["ficha", "C - leida", "leida"],
          ["ficha", "C - sin-ficha", "sin-ficha"],
          ["ficha", "C - ilegible", "ilegible"],
          ["ficha", "C - ajena", "ajena"],
        ],
      );
      // Los bytes tal como llegan, en ISO-8859-1 y sin decodificar.
      assert.deepStrictEqual(
        archivadas.map((p) => [...p.cuerpo]),
        [listado, ficha, sinFicha, ilegible, ajena].map((bytes) => [...bytes]),
      );
      assert.strictEqual(
        archivadas[0]?.url,
        "https://geoportal.minetur.gob.es/VCTEL/infoantenasGeoJSON.do?idCapa=null&zoom=4&bbox=2.105000,41.382000,2.125000,41.392000",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un listado en HTML o que no se entiende también se archiva", () =>
    Effect.gen(function* () {
      const { paginas, archivo } = yield* archivoEnMemoria;
      const cuerpos = [latin1("<html>Mantenimiento</html>"), latin1("Servicio no disponible")];
      yield* conExtractor(
        (url, intento) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: cuerpos[intento] ?? latin1("{}") },
        (extractor) =>
          Effect.gen(function* () {
            yield* Effect.exit(extractor.caja(CAJA));
            yield* Effect.exit(extractor.caja(CAJA));
          }).pipe(Effect.provideService(ArchivoDePaginas, archivo)),
      );
      assert.deepStrictEqual(
        (yield* paginas).map((p) => [p.tipo, p.resultado, [...p.cuerpo]]),
        [
          ["listado", "ajena", [...(cuerpos[0] ?? [])]],
          ["listado", "ilegible", [...(cuerpos[1] ?? [])]],
        ],
      );
    }),
  );
});
