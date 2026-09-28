// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { type ZonaDeBarrido, zonaDeBarrido } from "@celda/dominio/barrido";
import { ficheroDeLote, leerCapa } from "@celda/dominio/capa";
import { leerLote } from "@celda/dominio/loteDeFichas";
import * as AntenasMoviles from "@celda/ingesta/antenasmoviles/extractor";
import {
  enLosCuadros,
  observacionesDeDetalle,
  puntosDeListado,
} from "@celda/ingesta/antenasmoviles/normalizar";
import { OPCIONES_PUNTOS, type OpcionesPuntos } from "@celda/ingesta/barridoDePuntos";
import { INTERRUPTOR_POR_DEFECTO } from "@celda/ingesta/ejecucion";
import { type DetalleDePunto, ExtractorDePuntos } from "@celda/ingesta/extractor";
import { capaDePuntosGrabada } from "@celda/ingesta/pruebas/antenasmoviles";
import { capaGrabadaPorCajas, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { clienteDePrueba, NO_HAY_ROBOTS, type Peticion } from "@celda/ingesta/pruebas/http";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { BaseNocturna, baseNocturna } from "./base.ts";
import { configuracion } from "./configuracion.ts";
import { describirResumen } from "./estado.ts";
import {
  conBase,
  conEntorno,
  contenidoDe,
  type Entorno,
  tablasDe,
  unaNoche,
  type Variante,
} from "./pruebas/entorno.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;

/**
 * Las noches esperan de verdad entre dos avances del reloj de prueba. Cien detalles tardan unos
 * 5 s en una máquina cargada, por encima de los 5 s por defecto.
 */
const PLAZO = 60_000;

const cataluna = zonaDeBarrido("cataluna");
const levante = zonaDeBarrido("levante");

/** Una ER5 o un marcador que copia el registro, como fila de `showf` y con su detalle. */
interface Marcador {
  readonly codigo: string;
  readonly latitud: number;
  readonly longitud: number;
  /** `er5_7` (ER5 de Movistar), `er5` (ER5 sin compañía) o `7` (copia del registro). */
  readonly operador: string;
  /** Algo más en la fila, para cambiar su huella. */
  readonly bandas?: string;
}

const fila = (m: Marcador): string =>
  m.operador.startsWith("er5")
    ? `[${m.latitud},${m.longitud},["${m.codigo}"],"${m.operador}","${m.bandas ?? ""}"]`
    : `[${m.latitud},${m.longitud},["${m.codigo}"],"${m.operador}",{"MS":["${m.bandas ?? "B3"}"]}]`;

/** El texto del listado de toda España con estos marcadores. */
const textoDeShowf = (marcadores: ReadonlyArray<Marcador>): string =>
  `[${marcadores.map(fila).join(",")}]`;

/** La respuesta de `showf` con estos marcadores. */
const showf = (marcadores: ReadonlyArray<Marcador>) => ({
  estado: 200,
  cuerpo: textoDeShowf(marcadores),
});

/**
 * El detalle de una ER5 de Movistar, como el de Tarragona 177 grabado. El de una sin compañía en el
 * listado la dice en el suyo.
 */
const detalleDe = (m: Marcador): string =>
  JSON.stringify([
    [
      [m.codigo],
      ["ER5-M-TELEFONICA", "er5_7", "1"],
      ["Carrer de prova, 1, 08014 Barcelona", m.latitud, m.longitud, "40m"],
      [],
      [],
      "1",
      [],
    ],
  ]);

/** Una ER5 de Movistar en Barcelona, en una rejilla de 55 m hacia el norte desde la Diagonal. */
const er5 = (i: number, operador = "er5_7"): Marcador => ({
  codigo: `MV-PRUEBA-${String(i).padStart(3, "0")}`,
  latitud: Number((41.4 + i * 0.0005).toFixed(6)),
  longitud: 2.17,
  operador,
});

const MADRID: ReadonlyArray<Marcador> = [
  { codigo: "MV-MAD-1", latitud: 40.4168, longitud: -3.7038, operador: "er5_7" },
  { codigo: "MV-MAD-2", latitud: 40.42, longitud: -3.7, operador: "er5" },
];
const VALENCIA: Marcador = {
  codigo: "MV-VLC-1",
  latitud: 39.47,
  longitud: -0.376,
  operador: "er5_7",
};
const COPIA: Marcador = {
  codigo: "0802532",
  latitud: 41.388342,
  longitud: 2.113628,
  operador: "7",
};

/** Lo que contesta antenasmoviles.es de mentira: sin `robots.txt`, el listado y cada detalle. */
interface Fuente {
  readonly listado: { readonly estado: number; readonly cuerpo: string };
  readonly marcadores: ReadonlyArray<Marcador>;
  /** Contesta un 403 a los detalles a partir de este. */
  readonly bloqueaDetallesDesde?: number;
}

/**
 * El extractor real de antenasmoviles.es con sus zonas, sobre un cliente HTTP de prueba que apunta
 * cada petición.
 */
const antenasMoviles = (
  fuente: Fuente,
  peticiones: Ref.Ref<ReadonlyArray<Peticion>>,
  zonas: ReadonlyArray<ZonaDeBarrido>,
) => {
  const detalles = new Map(fuente.marcadores.map((m) => [m.codigo, detalleDe(m)]));
  let leidos = 0;
  return AntenasMoviles.capa({
    ...AntenasMoviles.OPCIONES_CLIENTE,
    maxPeticiones: 1000,
    dentro: enLosCuadros(zonas.flatMap((zona) => zona.cuadros)),
  }).pipe(
    Layer.provide(
      clienteDePrueba(peticiones, (url) => {
        if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
        if (url.pathname === "/v1/showf") return fuente.listado;
        leidos++;
        if (fuente.bloqueaDetallesDesde !== undefined && leidos >= fuente.bloqueaDetallesDesde) {
          return { estado: 403, cuerpo: "Forbidden" };
        }
        return { estado: 200, cuerpo: detalles.get(url.searchParams.get("id") ?? "") ?? "[]" };
      }),
    ),
  );
};

const ENCENDIDO = {
  ...INTERRUPTOR_POR_DEFECTO,
  antenasmoviles: { activo: true, motivo: "" },
};

/**
 * Una noche con el registro oficial grabado de Campus Nord y antenasmoviles.es de mentira. El
 * reloj de prueba avanza de 5 en 5 s, con pausas reales, para las esperas entre peticiones.
 */
const nocheCon = (
  entorno: Entorno,
  fuente: Fuente,
  peticiones: Ref.Ref<ReadonlyArray<Peticion>>,
  cambios: { readonly puntos?: OpcionesPuntos; readonly variante?: Variante } = {},
) =>
  Effect.gen(function* () {
    const puntos = cambios.puntos ?? OPCIONES_PUNTOS;
    const fibra = yield* Effect.forkChild(
      unaNoche(entorno, capaGrabadaPorCajas("registro-oficial", yield* muestraCampusNord), {
        interruptores: ENCENDIDO,
        antenasMoviles: antenasMoviles(fuente, peticiones, puntos.zonas),
        puntos,
        ...cambios.variante,
      }),
    );
    for (let paso = 0; paso < 5000 && fibra.pollUnsafe() === undefined; paso++) {
      yield* TestClock.adjust("5 seconds");
      yield* TestClock.withLive(Effect.sleep("1 millis"));
    }
    return yield* Fiber.join(fibra);
  });

/** Las rutas pedidas desde la última vez, y las borra. */
const pedidas = (peticiones: Ref.Ref<ReadonlyArray<Peticion>>) =>
  Effect.map(Ref.getAndSet(peticiones, []), (hechas) => hechas.map((p) => p.ruta));

const detallesPedidos = (rutas: ReadonlyArray<string>) =>
  rutas
    .filter((ruta) => ruta.startsWith("/v1/markers"))
    .map((ruta) => decodeURIComponent(ruta.slice("/v1/markers?id=".length)));

/** La versión de la última capa publicada en el almacén, como `sitios@<fecha>`. */
const ultimaVersion = (almacen: ReadonlyMap<string, string>): string =>
  [...almacen.keys()]
    .filter((fichero) => fichero.startsWith("sitios@"))
    .toSorted()
    .at(-1)
    ?.slice(0, -".json".length) ?? "";

/** antenasmoviles.es en el resumen de la base. */
const fuenteDe = (entorno: Entorno) =>
  conBase(
    entorno.base,
    Effect.map(
      Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)),
      (resumen) => {
        const fuente = resumen.fuentes.find((f) => f.fuente === "antenasmoviles");
        assert.isDefined(fuente);
        return fuente;
      },
    ),
  );

describe("antenasmoviles.es en la ingesta nocturna (#48)", () => {
  it.effect(
    "empieza apagado: la ejecución queda omitida sin pedir nada a la fuente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          yield* TestClock.setTime(NOCHE);
          const hecha = yield* nocheCon(
            entorno,
            { listado: showf([er5(0)]), marcadores: [er5(0)] },
            peticiones,
            { variante: { interruptores: INTERRUPTOR_POR_DEFECTO } },
          );
          assert.deepStrictEqual(
            hecha.ejecuciones.map((e) => [e.fuente, e.estado]),
            [
              ["registro-oficial", "completada"],
              ["antenasmoviles", "omitida"],
            ],
          );
          assert.deepStrictEqual(yield* pedidas(peticiones), []);
          const fuente = yield* fuenteDe(entorno);
          assert.isFalse(fuente.interruptor.activo);
          assert.deepStrictEqual(fuente.ultima?.errores, [
            `Interruptor apagado: ${INTERRUPTOR_POR_DEFECTO.antenasmoviles.motivo}`,
          ]);
          assert.strictEqual(fuente.puntos, 0);
        }),
      ),
    PLAZO,
  );

  it.effect(
    "con Cataluña lee solo sus marcadores y el detalle de sus ER5 pendientes, 100 por noche y sin repaso",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          // 130 ER5 de Movistar y 2 sin compañía en Barcelona, una copia del registro y ER5 de
          // fuera de Cataluña.
          const conCompania = Array.from({ length: 130 }, (_, i) => er5(i));
          const sinCompania = [er5(200, "er5"), er5(201, "er5")];
          const marcadores = [...conCompania, ...sinCompania, COPIA, ...MADRID, VALENCIA];
          const fuente: Fuente = { listado: showf(marcadores), marcadores };
          yield* TestClock.setTime(NOCHE);

          const primera = yield* nocheCon(entorno, fuente, peticiones);
          const rutas = yield* pedidas(peticiones);
          assert.deepStrictEqual(rutas.slice(0, 2), ["/robots.txt", "/v1/showf?er5"]);
          const leidos = detallesPedidos(rutas);
          assert.strictEqual(leidos.length, 100);
          assert.strictEqual(rutas.length, 102);
          // Primero las que no dicen su compañía; nunca la copia del registro ni las de fuera.
          assert.deepStrictEqual(
            leidos.slice(0, 2),
            sinCompania.map((m) => m.codigo),
          );
          assert.isFalse(leidos.some((codigo) => codigo.startsWith("MV-MAD")));
          assert.notInclude(leidos, VALENCIA.codigo);
          assert.notInclude(leidos, COPIA.codigo);
          const ejecucion = primera.ejecuciones.find((e) => e.fuente === "antenasmoviles");
          assert.strictEqual(ejecucion?.estado, "completada");
          assert.deepStrictEqual(
            ejecucion?.zonas.map((z) => [z.zona, z.estado, z.registros, z.peticiones]),
            [["cataluna", "completado", 133, 100]],
          );
          const trasUna = yield* fuenteDe(entorno);
          assert.strictEqual(trasUna.puntos, 133);
          assert.strictEqual(trasUna.detallesPendientes, 32);
          assert.strictEqual(trasUna.vigentes, 100);
          assert.deepStrictEqual(trasUna.ultima?.cambios.puntos, {
            creados: 133,
            cambiados: 0,
            retirados: 0,
          });

          yield* TestClock.adjust(DIA);
          yield* nocheCon(entorno, fuente, peticiones);
          assert.strictEqual(detallesPedidos(yield* pedidas(peticiones)).length, 32);
          assert.strictEqual((yield* fuenteDe(entorno)).vigentes, 132);

          // Sin nada nuevo ni cambiado no se vuelve a leer ningún detalle.
          yield* TestClock.adjust(DIA);
          yield* nocheCon(entorno, fuente, peticiones);
          assert.deepStrictEqual(yield* pedidas(peticiones), ["/robots.txt", "/v1/showf?er5"]);
          const trasTres = yield* fuenteDe(entorno);
          assert.strictEqual(trasTres.detallesPendientes, 0);
          assert.deepStrictEqual(trasTres.ultima?.cambios.puntos, {
            creados: 0,
            cambiados: 0,
            retirados: 0,
          });

          // Cada ER5 publicada cita antenasmoviles.es con el enlace a su sitio en su mapa.
          const almacen = yield* contenidoDe(entorno.almacen);
          const version = ultimaVersion(almacen);
          const capa = leerCapa(almacen.get(`${version}.json`) ?? "", version);
          if (Result.isFailure(capa)) return assert.fail(capa.failure.message);
          const citas = capa.success.emplazamientos.flatMap((emplazamiento) => {
            const numero = emplazamiento.lote ?? -1;
            const lote = leerLote(
              almacen.get(ficheroDeLote(version, numero)) ?? "",
              version,
              numero,
            );
            if (Result.isFailure(lote)) return assert.fail(lote.failure.message);
            return lote.success.fichas
              .filter((ficha) => ficha.clave === emplazamiento.clave)
              .flatMap((ficha) => ficha.estaciones.flatMap((e) => e.origenes))
              .filter((origen) => origen.fuente === "antenasmoviles");
          });
          assert.strictEqual(citas.length, 132);
          const tarragona = citas.find((c) => c.clave === `movistar - ${er5(3).codigo}`);
          assert.strictEqual(tarragona?.url, "https://antenasmoviles.es/#19/41.401500/2.170000");
        }),
      ),
    PLAZO,
  );

  it.effect(
    "un 403 o una página HTML en el listado es la fuente bloqueada, no una zona vacía",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          const marcadores = [er5(0), er5(1)];
          yield* TestClock.setTime(NOCHE);
          yield* nocheCon(entorno, { listado: showf(marcadores), marcadores }, peticiones);
          const antes = yield* tablasDe(entorno.base);

          for (const listado of [
            { estado: 403, cuerpo: "Forbidden" },
            { estado: 200, cuerpo: "<!DOCTYPE html><title>Just a moment...</title>" },
            { estado: 200, cuerpo: "<!DOCTYPE html><title>Just a moment...</title>" },
          ]) {
            yield* TestClock.adjust(DIA);
            const hecha = yield* nocheCon(entorno, { listado, marcadores }, peticiones);
            const ejecucion = hecha.ejecuciones.find((e) => e.fuente === "antenasmoviles");
            assert.strictEqual(ejecucion?.estado, "fallida");
            assert.strictEqual(ejecucion?.zonas[0]?.estado, "fallido");
            assert.include(ejecucion?.zonas[0]?.error, "bloqueando a Celda");
          }
          const fuente = yield* fuenteDe(entorno);
          assert.strictEqual(fuente.ultima?.estado, "fallida");
          assert.include(fuente.ultima?.errores[0], "FuenteNoDisponible");
          // Tres noches bloqueadas no retiran nada.
          assert.strictEqual(fuente.puntos, 2);
          assert.deepStrictEqual(yield* tablasDe(entorno.base), antes);
        }),
      ),
    PLAZO,
  );

  it.effect(
    "un 403 en un detalle para los detalles y deja los demás para la noche siguiente",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          const marcadores = Array.from({ length: 5 }, (_, i) => er5(i));
          yield* TestClock.setTime(NOCHE);
          yield* nocheCon(
            entorno,
            { listado: showf(marcadores), marcadores, bloqueaDetallesDesde: 3 },
            peticiones,
          );
          assert.strictEqual(detallesPedidos(yield* pedidas(peticiones)).length, 3);
          const trasUna = yield* fuenteDe(entorno);
          assert.strictEqual(trasUna.ultima?.estado, "completada");
          assert.strictEqual(trasUna.detallesPendientes, 3);
          assert.isTrue(
            trasUna.ultima?.errores.includes("Detalles pendientes para la próxima ejecución"),
          );

          yield* TestClock.adjust(DIA);
          yield* nocheCon(entorno, { listado: showf(marcadores), marcadores }, peticiones);
          assert.deepStrictEqual(
            detallesPedidos(yield* pedidas(peticiones)),
            marcadores.slice(2).map((m) => m.codigo),
          );
          assert.strictEqual((yield* fuenteDe(entorno)).vigentes, 5);
        }),
      ),
    PLAZO,
  );

  it.effect(
    "un marcador que falta en dos barridos de su zona se retira con sus observaciones",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          const [quitado, queda] = [er5(0), er5(1)];
          const dosZonas = {
            ...OPCIONES_PUNTOS,
            zonas: [cataluna, levante].flatMap((z) => z ?? []),
          };
          const soloCataluna = { ...OPCIONES_PUNTOS, zonas: [cataluna].flatMap((z) => z ?? []) };
          const noche = (marcadores: ReadonlyArray<Marcador>, puntos: OpcionesPuntos) =>
            Effect.andThen(
              TestClock.adjust(DIA),
              nocheCon(entorno, { listado: showf(marcadores), marcadores }, peticiones, { puntos }),
            );
          yield* TestClock.setTime(NOCHE - DIA);
          yield* noche([quitado, queda, VALENCIA], dosZonas);
          assert.strictEqual((yield* fuenteDe(entorno)).vigentes, 3);

          // Falta una vez: sigue vigente.
          yield* noche([queda, VALENCIA], dosZonas);
          const trasUna = yield* fuenteDe(entorno);
          assert.strictEqual(trasUna.puntos, 3);
          assert.strictEqual(trasUna.vigentes, 3);

          // Falta la segunda: se retira con su ER5. La de Valencia falta también, pero su zona no se
          // barre esta noche y no cuenta.
          const tercera = yield* noche([queda], soloCataluna);
          const trasDos = yield* fuenteDe(entorno);
          assert.strictEqual(trasDos.puntos, 2);
          assert.strictEqual(trasDos.vigentes, 2);
          assert.deepStrictEqual(trasDos.ultima?.cambios.puntos, {
            creados: 0,
            cambiados: 0,
            retirados: 1,
          });
          assert.strictEqual(trasDos.ultima?.cambios.observaciones.retirados, 1);
          assert.strictEqual(tercera.publicacion.tipo, "publicada");
          const almacen = yield* contenidoDe(entorno.almacen);
          const capa = almacen.get(`${ultimaVersion(almacen)}.json`) ?? "";
          assert.include(capa, queda.codigo);
          assert.notInclude(capa, quitado.codigo);

          // Una zona que vuelve sin ningún marcador cuando tenía alguno falla y no cuenta ausencias.
          for (let noches = 0; noches < 2; noches++) {
            const vacia = yield* noche([VALENCIA], dosZonas);
            const zonas = vacia.ejecuciones.find((e) => e.fuente === "antenasmoviles")?.zonas;
            assert.deepStrictEqual(
              zonas?.map((z) => [z.zona, z.estado]),
              [
                ["cataluna", "fallido"],
                ["levante", "completado"],
              ],
            );
            assert.include(zonas?.[0]?.error, "ZonaVacia");
          }
          assert.strictEqual((yield* fuenteDe(entorno)).vigentes, 2);
        }),
      ),
    PLAZO,
  );

  it.effect(
    "una ER5 que cambia en el listado se vuelve a leer, y una que deja de serlo pierde su observación",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          const [cambia, deja] = [er5(0), er5(1)];
          yield* TestClock.setTime(NOCHE);
          yield* nocheCon(entorno, { listado: showf([cambia, deja]), marcadores: [] }, peticiones);
          yield* pedidas(peticiones);

          yield* TestClock.adjust(DIA);
          const despues = [
            { ...cambia, bandas: "N78" },
            { ...deja, operador: "7" },
          ];
          yield* nocheCon(
            entorno,
            { listado: showf(despues), marcadores: [cambia, deja] },
            peticiones,
          );
          assert.deepStrictEqual(detallesPedidos(yield* pedidas(peticiones)), [cambia.codigo]);
          const fuente = yield* fuenteDe(entorno);
          assert.deepStrictEqual(fuente.ultima?.cambios.puntos, {
            creados: 0,
            cambiados: 2,
            retirados: 0,
          });
          // Los detalles de la primera noche no dieron nada: solo queda la ER5 releída.
          assert.strictEqual(fuente.vigentes, 1);

          yield* TestClock.adjust(DIA);
          yield* nocheCon(
            entorno,
            { listado: showf([cambia, deja]), marcadores: [cambia, deja] },
            peticiones,
          );
          assert.deepStrictEqual(detallesPedidos(yield* pedidas(peticiones)), [
            cambia.codigo,
            deja.codigo,
          ]);
          assert.strictEqual((yield* fuenteDe(entorno)).vigentes, 2);

          yield* TestClock.adjust(DIA);
          yield* nocheCon(
            entorno,
            { listado: showf([cambia, { ...deja, operador: "7" }]), marcadores: [cambia, deja] },
            peticiones,
          );
          const trasDejar = yield* fuenteDe(entorno);
          assert.strictEqual(trasDejar.vigentes, 1);
          assert.strictEqual(trasDejar.ultima?.cambios.observaciones.retirados, 1);
        }),
      ),
    PLAZO,
  );

  it.effect(
    "una noche cortada en los detalles se retoma y deja lo mismo que una completa",
    () =>
      Effect.gen(function* () {
        const marcadores = Array.from({ length: 6 }, (_, i) => er5(i));
        // Sin esperas entre peticiones, para que las dos noches empiecen a la misma hora.
        const listado = puntosDeListado(textoDeShowf(marcadores), enLosCuadros(["2,41"]));
        if (Result.isFailure(listado)) return assert.fail(listado.failure);
        const detalles = new Map<string, DetalleDePunto>();
        for (const m of marcadores) {
          const detalle = observacionesDeDetalle(detalleDe(m));
          if (Result.isFailure(detalle)) return assert.fail(detalle.failure);
          detalles.set(m.codigo, detalle.success);
        }
        const grabada = capaDePuntosGrabada({ listado: listado.success, detalles });
        const cortado = Layer.effect(
          ExtractorDePuntos,
          Effect.gen(function* () {
            const leidos = yield* Ref.make(0);
            const real = yield* ExtractorDePuntos;
            return ExtractorDePuntos.of({
              ...real,
              detalle: (punto) =>
                Effect.flatMap(
                  Ref.updateAndGet(leidos, (n) => n + 1),
                  (n) => (n === 4 ? Effect.die("se ha ido la luz") : real.detalle(punto)),
                ),
            });
          }),
        ).pipe(Layer.provide(grabada));
        const noche = (entorno: Entorno, extractor: Layer.Layer<ExtractorDePuntos>) =>
          Effect.gen(function* () {
            return yield* unaNoche(
              entorno,
              capaGrabadaPorCajas("registro-oficial", yield* muestraCampusNord),
              { interruptores: ENCENDIDO, antenasMoviles: extractor },
            );
          });
        yield* TestClock.setTime(NOCHE);

        const retomada = yield* conEntorno((entorno) =>
          Effect.gen(function* () {
            const salida = yield* Effect.exit(noche(entorno, cortado));
            assert.isTrue(Exit.isFailure(salida));
            yield* noche(entorno, grabada);
            return {
              almacen: yield* contenidoDe(entorno.almacen),
              tablas: yield* tablasDe(entorno.base),
              ultima: (yield* fuenteDe(entorno)).ultima?.estado,
            };
          }),
        );
        const completa = yield* conEntorno((entorno) =>
          Effect.gen(function* () {
            yield* noche(entorno, grabada);
            return {
              almacen: yield* contenidoDe(entorno.almacen),
              tablas: yield* tablasDe(entorno.base),
            };
          }),
        );
        assert.strictEqual(retomada.ultima, "completada");
        assert.deepStrictEqual(retomada.tablas, completa.tablas);
        assert.deepStrictEqual(retomada.almacen, completa.almacen);
      }),
    PLAZO,
  );

  it.effect(
    "el estado dice los puntos, los detalles pendientes y lo que hizo cada zona",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
          const marcadores = Array.from({ length: 4 }, (_, i) => er5(i));
          yield* TestClock.setTime(NOCHE);
          yield* nocheCon(
            entorno,
            { listado: showf([...marcadores, COPIA]), marcadores },
            peticiones,
            {
              puntos: { ...OPCIONES_PUNTOS, maxDetalles: 3 },
            },
          );
          const resumen = yield* Effect.flatMap(BaseNocturna, (base) => base.resumen(NOCHE)).pipe(
            Effect.provide(baseNocturna({ fichero: entorno.base, interruptores: ENCENDIDO })),
          );
          const texto = describirResumen(entorno.base, resumen);
          assert.include(texto, "antenasmoviles: encendida");
          assert.include(texto, "completada, 5 registros en el listado");
          assert.include(texto, "puntos +5 ~0 -0, observaciones +3 ~0 -0, detalles 3 leídos");
          assert.include(
            texto,
            "Puntos vigentes: 5; detalles de ER5 pendientes: 1; observaciones vigentes: 3",
          );
          assert.include(texto, "- cataluna: completado, 9 cuadros, 3 peticiones");
          assert.include(texto, "- cataluna: último barrido completado");
        }),
      ),
    PLAZO,
  );

  it.effect(
    "la configuración lo deja apagado y con las zonas del registro oficial",
    () =>
      Effect.gen(function* () {
        const porDefecto = yield* configuracion.parse(ConfigProvider.fromEnv({ env: {} }));
        assert.deepStrictEqual(
          porDefecto.interruptores.antenasmoviles,
          INTERRUPTOR_POR_DEFECTO.antenasmoviles,
        );
        assert.isFalse(porDefecto.interruptores.antenasmoviles.activo);
        assert.deepStrictEqual(
          porDefecto.noche.puntos.zonas.map((zona) => zona.nombre),
          ["cataluna"],
        );
        assert.strictEqual(porDefecto.noche.puntos.maxDetalles, 100);
        assert.strictEqual(Duration.toSeconds(porDefecto.antenasMoviles.pausa), 5);
        assert.strictEqual(porDefecto.antenasMoviles.maxPeticiones, 110);
        assert.strictEqual(
          porDefecto.antenasMoviles.userAgent,
          "Celda (ingesta; contacto en celda.elies.site)",
        );

        // Sin zonas propias, las del registro oficial: las de cada noche y las que se turnan.
        const delRegistro = yield* configuracion.parse(
          ConfigProvider.fromEnv({
            env: {
              CELDA_REGISTRO_ZONAS: "cataluna",
              CELDA_REGISTRO_ZONAS_EN_TURNO: "centro,cataluna,norte",
              CELDA_REGISTRO_USER_AGENT: "Celda (pruebas)",
            },
          }),
        );
        assert.deepStrictEqual(
          delRegistro.noche.puntos.zonas.map((zona) => zona.nombre),
          ["cataluna", "centro", "norte"],
        );
        assert.strictEqual(delRegistro.antenasMoviles.userAgent, "Celda (pruebas)");

        const cambiada = yield* configuracion.parse(
          ConfigProvider.fromEnv({
            env: {
              CELDA_ANTENASMOVILES_ACTIVO: "true",
              CELDA_ANTENASMOVILES_ZONAS: "levante",
              CELDA_ANTENASMOVILES_MAX_DETALLES: "400",
              CELDA_ANTENASMOVILES_PAUSA_SEGUNDOS: "1",
              CELDA_ANTENASMOVILES_USER_AGENT: "Celda (antenas)",
            },
          }),
        );
        assert.isTrue(cambiada.interruptores.antenasmoviles.activo);
        assert.deepStrictEqual(
          cambiada.noche.puntos.zonas.map((zona) => zona.nombre),
          ["levante"],
        );
        assert.strictEqual(cambiada.noche.puntos.maxDetalles, 400);
        assert.strictEqual(cambiada.antenasMoviles.maxPeticiones, 410);
        // Nunca por debajo de 5 s entre peticiones.
        assert.strictEqual(Duration.toSeconds(cambiada.antenasMoviles.pausa), 5);
        assert.strictEqual(cambiada.antenasMoviles.userAgent, "Celda (antenas)");

        const ninguna = yield* configuracion.parse(
          ConfigProvider.fromEnv({
            env: {
              CELDA_ANTENASMOVILES_ZONAS: "ninguna",
              CELDA_ANTENASMOVILES_MAX_PETICIONES: "7",
            },
          }),
        );
        assert.deepStrictEqual(ninguna.noche.puntos.zonas, []);
        assert.strictEqual(ninguna.antenasMoviles.maxPeticiones, 7);

        const mal = yield* Effect.flip(
          configuracion.parse(
            ConfigProvider.fromEnv({ env: { CELDA_ANTENASMOVILES_ZONAS: "catalunya" } }),
          ),
        );
        assert.include(mal.message, "zonas de barrido desconocidas: catalunya");
      }),
    PLAZO,
  );
});
