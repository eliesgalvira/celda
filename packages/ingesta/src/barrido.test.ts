// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  type Caja,
  cajaDeCuadro,
  type Cuadro,
  dividir,
  divisiones,
  type ZonaDeBarrido,
} from "@celda/dominio/barrido";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  DIVISIONES_MAXIMAS,
  type EstadoDeZona,
  RECIENTE,
  recorrerCuadro,
  zonasPorBarrer,
} from "./barrido.ts";
import type { Registro } from "./extractor.ts";
import {
  capaGrabadaPorCajas,
  type ElementoGrabado,
  geoportalGrabado,
  listadoGrabado,
} from "./pruebas/grabado.ts";
import { clienteDePrueba, type Peticion } from "./pruebas/http.ts";
import { esperarConReloj } from "./pruebas/reloj.ts";
import { capaPorCajas, OPCIONES } from "./registro-oficial/extractor.ts";
import { enCaja } from "./zona.ts";

/** Un punto con clave, para simular el teselado sin pasar por el extractor. */
interface Punto {
  readonly id: string;
  readonly longitud: number;
  readonly latitud: number;
}

/** Las peticiones de un teselado y sus cajas finales, en el orden en que se piden. */
interface Teselado {
  readonly peticiones: number;
  readonly hojas: ReadonlyArray<Caja>;
}

/** La división en cuatro que simuló la investigación 08, sobre unos puntos. */
const simular = (puntos: ReadonlyArray<Punto>, caja: Caja, tope: number): Teselado => {
  const dentro = puntos.filter((p) => enCaja(caja, p.longitud, p.latitud));
  if (dentro.length < tope) return { peticiones: 1, hojas: [caja] };
  const partes = dividir(caja).map((parte) => simular(dentro, parte, tope));
  return {
    peticiones: 1 + partes.reduce((suma, p) => suma + p.peticiones, 0),
    hojas: partes.flatMap((p) => p.hojas),
  };
};

const simularDesde = (puntos: ReadonlyArray<Punto>, cajas: ReadonlyArray<Caja>, tope: number) => {
  const partes = cajas.map((caja) => simular(puntos, caja, tope));
  return {
    peticiones: partes.reduce((suma, p) => suma + p.peticiones, 0),
    hojas: partes.flatMap((p) => p.hojas),
  };
};

const cuantosEn = (puntos: ReadonlyArray<Punto>, caja: Caja) =>
  puntos.filter((p) => enCaja(caja, p.longitud, p.latitud)).length;

const puntosDe = (registros: ReadonlyArray<Registro>): ReadonlyArray<Punto> =>
  registros.map((r) => ({ id: r.clave, ...r.posicion }));

/**
 * Recorre un cuadro con el extractor real del registro oficial, contra un geoportal que contesta
 * con un listado grabado y corta en 1000 como el de verdad, con el reloj de prueba.
 */
const recorrerContraElGeoportal = (
  responder: Parameters<typeof clienteDePrueba>[1],
  cuadro: Cuadro,
  guardadas: ReadonlyArray<Caja>,
) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const fibra = yield* recorrerCuadro(cuadro, guardadas).pipe(
      Effect.provide(
        capaPorCajas(OPCIONES).pipe(Layer.provide(clienteDePrueba(peticiones, responder))),
      ),
      Effect.forkChild,
    );
    const recorrido = yield* esperarConReloj(fibra);
    const listados = (yield* Ref.get(peticiones)).filter((p) => p.ruta !== "/robots.txt");
    return { recorrido, listados };
  });

describe("recorrido de un cuadro con listados grabados que llegan al tope de 1000", () => {
  for (const [ciudad, cuadro, registrosGrabados] of [
    ["barcelona", "2,41", 2380],
    ["madrid-centro", "-4,40", 2397],
  ] as const) {
    it.effect(
      `${ciudad}: divide cada caja que llega al tope, no pierde ningún registro y pide lo que ` +
        "dice la simulación de la investigación 08",
      () =>
        Effect.gen(function* () {
          const { responder, elementos } = yield* geoportalGrabado(ciudad);
          const puntos: ReadonlyArray<ElementoGrabado> = elementos;
          const ids = new Set(puntos.map((p) => p.id));
          assert.strictEqual(ids.size, registrosGrabados);
          // El cuadro entero llega al tope: pedirlo sin dividir perdería registros sin avisar.
          assert.isAtLeast(cuantosEn(puntos, cajaDeCuadro(cuadro)), 1000);

          const { recorrido, listados } = yield* recorrerContraElGeoportal(responder, cuadro, []);
          assert.deepStrictEqual(new Set(recorrido.registros.map((r) => r.clave)), ids);
          const simulado = simular(puntos, cajaDeCuadro(cuadro), 1000);
          assert.strictEqual(listados.length, simulado.peticiones);
          assert.deepStrictEqual(recorrido.cajas, simulado.hojas);
          // Ninguna caja guardada llega al tope, y entre todas cubren el cuadro.
          for (const caja of recorrido.cajas) {
            assert.isBelow(cuantosEn(puntos, caja), 1000);
          }
          assert.isAbove(recorrido.bytes, 0);

          // La pasada siguiente pide solo las cajas guardadas, una petición cada una.
          const segunda = yield* recorrerContraElGeoportal(responder, cuadro, recorrido.cajas);
          assert.strictEqual(segunda.listados.length, recorrido.cajas.length);
          assert.deepStrictEqual(segunda.recorrido.registros, recorrido.registros);
          assert.deepStrictEqual(segunda.recorrido.cajas, recorrido.cajas);
        }).pipe(Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("una caja guardada que ha crecido hasta el tope se divide; las demás no", () =>
    Effect.gen(function* () {
      const listado = yield* listadoGrabado("barcelona");
      const puntos = puntosDe(listado.registros);
      const grabada = { listado, fichas: new Map() };
      const primera = yield* recorrerCuadro("2,41", []).pipe(
        Effect.provide(capaGrabadaPorCajas("registro-oficial", grabada, 1000)),
      );
      // Con un tope de 250, como si las cajas hubieran crecido: solo se dividen las que llegan.
      const segunda = yield* recorrerCuadro("2,41", primera.cajas).pipe(
        Effect.provide(capaGrabadaPorCajas("registro-oficial", grabada, 250)),
      );
      const esperado = simularDesde(puntos, primera.cajas, 250);
      assert.deepStrictEqual(segunda.cajas, esperado.hojas);
      assert.isAbove(segunda.cajas.length, primera.cajas.length);
      for (const caja of primera.cajas) {
        if (cuantosEn(puntos, caja) < 250) {
          assert.deepInclude(segunda.cajas, caja);
        }
      }
      for (const caja of segunda.cajas) {
        assert.isBelow(cuantosEn(puntos, caja), 250);
      }
      assert.strictEqual(segunda.registros.length, listado.registros.length);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("un cuadro que sigue en el tope tras las divisiones máximas falla", () =>
    Effect.gen(function* () {
      const listado = yield* listadoGrabado("barcelona");
      const [uno, dos] = listado.registros;
      assert.isDefined(uno);
      assert.isDefined(dos);
      // Dos estaciones en el mismo punto y un tope de 2: ninguna división las separa.
      const mismoPunto = { ...dos, posicion: uno.posicion };
      const fallo = yield* recorrerCuadro("2,41", []).pipe(
        Effect.flip,
        Effect.provide(
          capaGrabadaPorCajas(
            "registro-oficial",
            { listado: { registros: [uno, mismoPunto], avisos: [] }, fichas: new Map() },
            2,
          ),
        ),
      );
      assert.strictEqual(fallo._tag, "CuadroSinDividir");
      if (fallo._tag === "CuadroSinDividir") {
        assert.strictEqual(divisiones(fallo.caja), DIVISIONES_MAXIMAS);
        assert.include(fallo.message, "2,41");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("zonas de una ejecución", () => {
  const zona = (nombre: string): ZonaDeBarrido => ({
    nombre,
    titulo: nombre,
    comunidades: [],
    cuadros: [],
  });
  const [a, b, c, d] = [zona("a"), zona("b"), zona("c"), zona("d")];
  const nombres = (zonas: ReadonlyArray<ZonaDeBarrido>) => zonas.map((z) => z.nombre);
  const DIA = 86_400_000;
  /** El primer sábado de noviembre de 2026, a las 00:30 de Madrid. */
  const SABADO = Date.UTC(2026, 10, 6, 23, 30);
  const DOMINGO = SABADO + DIA;

  it("el sábado barre todas, en el orden de la configuración, porque la ronda anterior es de hace un mes", () => {
    const estado = new Map<string, EstadoDeZona>([
      ["b", { completado: SABADO - 35 * DIA, aMedias: false }],
      ["c", { completado: SABADO - 28 * DIA, aMedias: false }],
      ["d", { completado: SABADO - 35 * DIA, aMedias: true }],
    ]);
    const desde = SABADO - 36 * 3_600_000;
    assert.deepStrictEqual(nombres(zonasPorBarrer([a, b, c, d], estado, desde)), [
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("el domingo solo las que el sábado no completó, también la que dejó a medias", () => {
    const estado = new Map<string, EstadoDeZona>([
      ["a", { completado: SABADO, aMedias: false }],
      ["b", { completado: SABADO - 28 * DIA, aMedias: true }],
      ["c", { completado: SABADO, aMedias: false }],
    ]);
    const desde = DOMINGO - Duration.toMillis(RECIENTE);
    assert.deepStrictEqual(nombres(zonasPorBarrer([a, b, c, d], estado, desde)), ["b", "d"]);
    // Con todas completadas el sábado, el domingo no barre ninguna.
    const todas = new Map<string, EstadoDeZona>(
      [a, b, c, d].map((z) => [z.nombre, { completado: SABADO, aMedias: false }]),
    );
    assert.deepStrictEqual(nombres(zonasPorBarrer([a, b, c, d], todas, desde)), []);
  });

  it("una zona repetida en la configuración se barre una vez", () => {
    assert.deepStrictEqual(nombres(zonasPorBarrer([a, b, a], new Map(), SABADO)), ["a", "b"]);
  });
});
