// Cada prueba monta su buscador con un cliente HTTP de prueba nuevo.
// @effect-diagnostics strictEffectProvide:off
import type { Rectangulo } from "@celda/dominio/area";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { BuscadorDeDirecciones, buscadorNominatim, type Direccion } from "./buscador.ts";
import A_CORUNA from "./referencia/nominatim-a-coruna.json";
import CALLE_MAYOR from "./referencia/nominatim-calle-mayor.json";
import GIRONA from "./referencia/nominatim-girona.json";
import CON_NUMERO from "./referencia/nominatim-numero.json";
import SAGRADA_FAMILIA from "./referencia/nominatim-sagrada-familia.json";
import SORIA from "./referencia/nominatim-soria.json";
import TENERIFE from "./referencia/nominatim-tenerife.json";

const NOMINATIM = "http://nominatim.prueba";

interface Peticion {
  readonly url: URL;
  readonly cabeceras: ReadonlyArray<string>;
  /** Cuándo llegó, en milisegundos del reloj de la prueba. */
  readonly cuando: number;
}

/** Lo que contesta el servidor de prueba: un cuerpo JSON, un estado de error o nada nunca. */
type Contesta = { readonly estado: number; readonly cuerpo: string } | "nunca";

const JSON_DE = (datos: ReadonlyArray<unknown>): Contesta => ({
  estado: 200,
  cuerpo: JSON.stringify(datos),
});

/**
 * El buscador real sobre un servidor de prueba que contesta a cada consulta `q` con lo que diga
 * `respuestas` (la siguiente de la lista en cada petición) y apunta lo que recibe.
 */
const montar = (respuestas: ReadonlyMap<string, ReadonlyArray<Contesta>>, url = NOMINATIM) => {
  const peticiones: Array<Peticion> = [];
  const cliente = HttpClient.make((request, direccion) =>
    Effect.gen(function* () {
      const cuando = yield* Clock.currentTimeMillis;
      peticiones.push({ url: direccion, cabeceras: Object.keys(request.headers), cuando });
      const q = direccion.searchParams.get("q") ?? "";
      const vez = peticiones.filter((p) => p.url.searchParams.get("q") === q).length - 1;
      const lista = respuestas.get(q) ?? [JSON_DE([])];
      const contesta = lista[Math.min(vez, lista.length - 1)] ?? JSON_DE([]);
      if (contesta === "nunca") return yield* Effect.never;
      return HttpClientResponse.fromWeb(
        request,
        new Response(contesta.cuerpo, { status: contesta.estado }),
      );
    }),
  );
  const capa = buscadorNominatim.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_BUSCADOR_URL: url }))),
  );
  return { capa, peticiones };
};

const buscar = (consulta: string, encuadre?: Rectangulo) =>
  Effect.flatMap(BuscadorDeDirecciones, (buscador) => buscador.buscar(consulta, encuadre));

/** Lo que se lee de cada resultado en la lista: nombre, detalle y lugar. */
const leidas = (direcciones: ReadonlyArray<Direccion>) =>
  direcciones.map((direccion) => [direccion.nombre, direccion.detalle, direccion.lugar]);

/** Lo que se ve del mapa en el centro de Zaragoza, sin llegar a la Cartuja Baja. */
const ZARAGOZA: Rectangulo = {
  suroeste: { longitud: -0.95, latitud: 41.63 },
  noreste: { longitud: -0.85, latitud: 41.68 },
};

/** Busca y deja pasar el segundo que el buscador espera entre dos peticiones. */
const buscarConTurno = (consulta: string) =>
  Effect.gen(function* () {
    const fibra = yield* Effect.forkChild(buscar(consulta));
    yield* TestClock.adjust("1 second");
    return leidas(yield* Fiber.join(fibra));
  });

describe("búsqueda de direcciones con Nominatim", () => {
  it.effect(
    "pide a Nominatim en toda España, con los nombres oficiales, y da nombres cortos sin repetir",
    () => {
      const { capa, peticiones } = montar(
        new Map([["sagrada familia", [JSON_DE(SAGRADA_FAMILIA)]]]),
      );
      return Effect.gen(function* () {
        const direcciones = yield* buscar("  Sagrada   Familia ");
        assert.deepStrictEqual(leidas(direcciones), [
          [
            "Basílica de la Sagrada Familia",
            "Carrer de Provença, la Sagrada Família, l'Eixample",
            "Barcelona (Barcelona)",
          ],
          [
            "Sagrada Família",
            "Carrer de la Marina, la Sagrada Família, l'Eixample",
            "Barcelona (Barcelona)",
          ],
          [
            "Sagrada Família",
            "Carrer de Provença, la Sagrada Família, l'Eixample",
            "Barcelona (Barcelona)",
          ],
        ]);
        assert.deepStrictEqual(direcciones[0]?.posicion, {
          longitud: 2.1744283,
          latitud: 41.4035046,
        });

        const [peticion] = peticiones;
        assert.strictEqual(peticion?.url.pathname, "/search");
        // Sin `viewbox` ni `bounded`: la búsqueda no se limita a ninguna caja dentro de España.
        assert.deepStrictEqual(Object.fromEntries(peticion?.url.searchParams ?? []), {
          q: "sagrada familia",
          format: "jsonv2",
          addressdetails: "1",
          limit: "10",
          countrycodes: "es",
          // Ningún idioma: Nominatim da el nombre local de cada lugar, no el del navegador.
          "accept-language": "und",
        });
        // Sin cabeceras propias: el navegador no manda una petición previa de CORS por cada búsqueda.
        assert.deepStrictEqual(peticion?.cabeceras, []);
      }).pipe(Effect.provide(capa));
    },
  );

  it.effect("sin nombre, la dirección es la calle con su número", () => {
    const { capa } = montar(new Map([["carrer de jordi girona 31", [JSON_DE(CON_NUMERO)]]]));
    return Effect.gen(function* () {
      const [direccion] = yield* buscar("Carrer de Jordi Girona 31");
      assert.strictEqual(direccion?.nombre, "Carrer de Bet Figueras, 31");
      assert.strictEqual(direccion?.detalle, "Pedralbes, les Corts");
      assert.strictEqual(direccion?.lugar, "Barcelona (Barcelona)");
    }).pipe(Effect.provide(capa));
  });

  it.effect("encuentra direcciones de Girona, de Soria y de Tenerife", () => {
    const { capa } = montar(
      new Map([
        ["plaça de la independència girona", [JSON_DE(GIRONA)]],
        ["plaza mayor soria", [JSON_DE(SORIA)]],
        ["calle del castillo santa cruz de tenerife", [JSON_DE(TENERIFE)]],
      ]),
    );
    return Effect.gen(function* () {
      // Nominatim da cinco veces la misma plaza, por tramos: se leen como dos.
      assert.deepStrictEqual(yield* buscarConTurno("Plaça de la Independència Girona"), [
        ["Plaça de la Independència", "el Mercadal", "Girona (Girona)"],
        ["Plaça de la Independència", "Eixample", "Girona (Girona)"],
      ]);
      // Ocho plazas mayores de ocho sitios de Soria: el lugar dice de qué municipio es cada una, y
      // el detalle, el núcleo si no es el del municipio.
      assert.deepStrictEqual(yield* buscarConTurno("Plaza Mayor Soria"), [
        ["Plaza Mayor", "", "Medinaceli (Soria)"],
        ["Plaza Mayor", "Benamira", "Medinaceli (Soria)"],
        ["Plaza Mayor", "Fuentelcarro", "Almazán (Soria)"],
        ["Plaza Mayor", "", "Ágreda (Soria)"],
        ["Plaza Mayor", "", "San Esteban de Gormaz (Soria)"],
        ["Plaza Mayor", "Osma", "El Burgo de Osma-Ciudad de Osma (Soria)"],
        ["Plaza Mayor", "Aljama (Barrio Judío)", "Berlanga de Duero (Soria)"],
        ["Plaza Mayor", "Montuenga de Soria", "Arcos de Jalón (Soria)"],
      ]);
      assert.deepStrictEqual(yield* buscarConTurno("Calle del Castillo Santa Cruz de Tenerife"), [
        ["Calle del Castillo", "Los Hoteles", "Santa Cruz de Tenerife (Santa Cruz de Tenerife)"],
        [
          "Calle del Castillo",
          "Urbanización Montalmar, Bajamar",
          "San Cristóbal de La Laguna (Santa Cruz de Tenerife)",
        ],
      ]);
    }).pipe(Effect.provide(capa));
  });

  it.effect("da los topónimos oficiales: Girona y A Coruña, no Gerona ni La Coruña", () => {
    const { capa } = montar(
      new Map([
        ["plaça de la independència girona", [JSON_DE(GIRONA)]],
        ["rúa real a coruña", [JSON_DE(A_CORUNA)]],
      ]),
    );
    return Effect.gen(function* () {
      const girona = yield* buscarConTurno("Plaça de la Independència Girona");
      const coruna = yield* buscarConTurno("Rúa Real A Coruña");
      assert.notMatch(JSON.stringify([girona, coruna]), /Gerona|La Coruña/u);
      // En Galicia el municipio es el concello (`municipality`), y el núcleo va en el detalle.
      assert.deepStrictEqual(coruna, [
        ["Rúa Real", "Zalaeta, A Pescaría", "A Coruña (A Coruña)"],
        ["Rúa Real", "A Madalena", "Ferrol (A Coruña)"],
        ["Rúa Real", "A Insua", "Fisterra (A Coruña)"],
        ["Rúa Real", "O Souto", "Padrón (A Coruña)"],
        ["Rúa Real", "A Cochera, A Trabanca", "Padrón (A Coruña)"],
        ["Rúa Real", "A Trabanca", "Padrón (A Coruña)"],
        ["Rúa Real", "Souto da Vila", "Pontedeume (A Coruña)"],
        ["Rúa Real", "As Saíñas", "Cedeira (A Coruña)"],
        ["Rúa Real", "A Ribeira", "Muxía (A Coruña)"],
      ]);
    }).pipe(Effect.provide(capa));
  });

  it.effect("lo que cae en lo que se ve del mapa va primero, sin quitar lo demás", () => {
    const { capa, peticiones } = montar(new Map([["calle mayor 1", [JSON_DE(CALLE_MAYOR)]]]));
    return Effect.gen(function* () {
      const sinEncuadre = yield* buscar("Calle Mayor 1");
      assert.deepStrictEqual(leidas(sinEncuadre), [
        // En una comunidad de una sola provincia, Nominatim no da la provincia: va la comunidad.
        ["Calle Mayor, 1", "Sol, Centro", "Madrid (Comunidad de Madrid)"],
        ["Monasterio de San Felipe", "Calle Mayor, Sol, Centro", "Madrid (Comunidad de Madrid)"],
        ["Hostal Ruano", "Calle Mayor, Sol, Centro", "Madrid (Comunidad de Madrid)"],
        ["Hans Christian Andersen", "Calle Mayor, Sol, Centro", "Madrid (Comunidad de Madrid)"],
        ["Calle Mayor, 1", "El Tubo, Casco Antiguo", "Zaragoza (Zaragoza)"],
        ["Calle Mayor, 1", "La Cartuja Baja, Cartuja Baja", "Zaragoza (Zaragoza)"],
        ["Calle Mayor, 1", "Miralbueno", "Zaragoza (Zaragoza)"],
      ]);

      // Mirando Zaragoza, las de Zaragoza suben, en su orden, y las de Madrid siguen detrás. La
      // respuesta está en la caché: cambiar lo que se ve no vuelve a preguntar.
      const desdeZaragoza = yield* buscar("Calle Mayor 1", ZARAGOZA);
      assert.deepStrictEqual(
        desdeZaragoza.map((direccion) => direccion.detalle),
        [
          "El Tubo, Casco Antiguo",
          "Miralbueno",
          "Sol, Centro",
          "Calle Mayor, Sol, Centro",
          "Calle Mayor, Sol, Centro",
          "Calle Mayor, Sol, Centro",
          "La Cartuja Baja, Cartuja Baja",
        ],
      );
      assert.lengthOf(peticiones, 1);
    }).pipe(Effect.provide(capa));
  });

  it.effect("deja al menos un segundo entre dos peticiones, aunque se busque seguido", () => {
    const { capa, peticiones } = montar(new Map());
    return Effect.gen(function* () {
      const fibra = yield* Effect.forkChild(
        Effect.all([buscar("gràcia"), buscar("sants"), buscar("poblenou")], {
          concurrency: "unbounded",
        }),
      );
      // Cada espera se programa al acabar la petición anterior: el reloj avanza de medio en medio
      // segundo hasta que terminan las tres.
      while (fibra.pollUnsafe() === undefined) yield* TestClock.adjust("500 millis");
      const momentos = peticiones.map((p) => p.cuando);
      assert.lengthOf(momentos, 3);
      for (let i = 1; i < momentos.length; i++) {
        assert.isAtLeast((momentos[i] ?? 0) - (momentos[i - 1] ?? 0), 1000);
      }
    }).pipe(Effect.provide(capa));
  });

  it.effect("guarda las respuestas: repetir la búsqueda no vuelve a preguntar", () => {
    const { capa, peticiones } = montar(new Map([["sagrada familia", [JSON_DE(SAGRADA_FAMILIA)]]]));
    return Effect.gen(function* () {
      const primera = yield* buscar("Sagrada Familia");
      const segunda = yield* buscar("sagrada familia");
      assert.deepStrictEqual(segunda, primera);
      assert.lengthOf(peticiones, 1);
    }).pipe(Effect.provide(capa));
  });

  it.effect("un fallo no se guarda: la siguiente búsqueda vuelve a preguntar", () => {
    const { capa, peticiones } = montar(
      new Map([["sants", [{ estado: 503, cuerpo: "" }, JSON_DE(CON_NUMERO)]]]),
    );
    return Effect.gen(function* () {
      const error = yield* Effect.flip(buscar("sants"));
      assert.strictEqual(error.motivo, "sin-respuesta");
      const fibra = yield* Effect.forkChild(buscar("sants"));
      yield* TestClock.adjust("1 second");
      assert.lengthOf(yield* Fiber.join(fibra), 1);
      assert.lengthOf(peticiones, 2);
    }).pipe(Effect.provide(capa));
  });

  it.effect("si Nominatim pide esperar (429), lo dice como límite", () => {
    const { capa } = montar(new Map([["sants", [{ estado: 429, cuerpo: "" }]]]));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(buscar("sants"));
      assert.strictEqual(error.motivo, "limite");
    }).pipe(Effect.provide(capa));
  });

  it.effect("si no contesta en 10 s, lo dice", () => {
    const { capa } = montar(new Map([["sants", ["nunca"]]]));
    return Effect.gen(function* () {
      const fibra = yield* Effect.forkChild(Effect.flip(buscar("sants")));
      yield* TestClock.adjust("10 seconds");
      const error = yield* Fiber.join(fibra);
      assert.strictEqual(error.motivo, "sin-respuesta");
    }).pipe(Effect.provide(capa));
  });

  it.effect("una consulta de menos de tres letras no se envía", () => {
    const { capa, peticiones } = montar(new Map());
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* buscar(" bc "), []);
      assert.lengthOf(peticiones, 0);
    }).pipe(Effect.provide(capa));
  });

  it.effect("con el buscador apagado en la configuración, lo dice sin preguntar a nadie", () => {
    const { capa, peticiones } = montar(new Map(), "apagado");
    return Effect.gen(function* () {
      const error = yield* Effect.flip(buscar("sagrada familia"));
      assert.strictEqual(error.motivo, "apagada");
      assert.lengthOf(peticiones, 0);
    }).pipe(Effect.provide(capa));
  });
});
