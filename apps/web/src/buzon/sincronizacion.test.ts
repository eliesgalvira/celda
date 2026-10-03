// Cada prueba monta su sincronización con un almacén y un buzón nuevos.
// @effect-diagnostics strictEffectProvide:off
import type { CorreccionPropuesta } from "@celda/dominio/aportacion";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import { almacenDePrueba } from "../ubicacion/pruebas.ts";
import { buzonDePrueba } from "./pruebas.ts";
import {
  BuzonCerrado,
  IdentidadCaducada,
  LimiteDelBuzon,
  Sincronizacion,
  sincronizacionCon,
} from "./sincronizacion.ts";

const MEDIODIA = Date.UTC(2026, 9, 3, 12);

const CORRECCION: CorreccionPropuesta = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322110",
  tipo: "correccion-propuesta",
  esquema: 1,
  creada: MEDIODIA - 60_000,
  origen: "ficha",
  emplazamiento: "movistar-0802532",
  cambio: { tipo: "ya-no-existe" },
  nota: null,
};

const otra = (id: string): CorreccionPropuesta => ({ ...CORRECCION, id });

/** La sincronización sobre un almacén y un buzón de prueba, con lo que hace falta para mirarlos. */
const montar = () => {
  const almacen = almacenDePrueba();
  const buzon = buzonDePrueba();
  let cargas = 0;
  const remoto = Effect.sync(() => {
    cargas += 1;
    return buzon.remoto;
  });
  return {
    almacen,
    buzon,
    cargas: () => cargas,
    capa: sincronizacionCon(remoto).pipe(Layer.provide(almacen.capa)),
  };
};

describe("Sincronizacion", () => {
  it.effect("guarda la aportación, la envía y apunta cuándo se compartió", () => {
    const { almacen, buzon, cargas, capa } = montar();
    return Effect.gen(function* () {
      yield* TestClock.setTime(MEDIODIA);
      // Montar el servicio no carga el buzón: eso pasa al compartir la primera vez.
      const sincronizacion = yield* Sincronizacion;
      assert.strictEqual(cargas(), 0);

      const compartida = yield* sincronizacion.compartir(CORRECCION);
      assert.strictEqual(compartida.compartidaEl, MEDIODIA);
      assert.deepStrictEqual(almacen.guardadas(), [CORRECCION]);
      assert.deepStrictEqual(buzon.recibidas(), [CORRECCION]);
      assert.deepStrictEqual(almacen.compartidas(), new Map([[CORRECCION.id, MEDIODIA]]));
      assert.strictEqual(almacen.identidad(), "identidad-1.firma");

      // La identidad se pide una vez y el buzón se carga una vez.
      yield* sincronizacion.compartir(otra("2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d"));
      assert.strictEqual(buzon.identidades(), 1);
      assert.strictEqual(cargas(), 1);
    }).pipe(Effect.provide(capa));
  });

  it.effect("compartir dos veces la misma aportación la deja una vez en el buzón", () => {
    const { almacen, buzon, capa } = montar();
    return Effect.gen(function* () {
      const sincronizacion = yield* Sincronizacion;
      yield* sincronizacion.compartir(CORRECCION);
      yield* sincronizacion.compartir(CORRECCION);
      assert.lengthOf(buzon.recibidas(), 1);
      assert.lengthOf(almacen.guardadas(), 1);
    }).pipe(Effect.provide(capa));
  });

  it.effect("si el buzón ya no reconoce la identidad, pide otra y envía otra vez", () => {
    const { almacen, buzon, capa } = montar();
    return Effect.gen(function* () {
      const sincronizacion = yield* Sincronizacion;
      yield* sincronizacion.compartir(CORRECCION);
      buzon.fallar(new IdentidadCaducada());
      const fallo = yield* Effect.flip(
        sincronizacion.compartir(otra("2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d")),
      );
      // Rechaza también la nueva: el buzón no contesta como debe, y no se insiste más.
      assert.strictEqual(fallo._tag, "BuzonSinRespuesta");
      assert.strictEqual(buzon.identidades(), 2);
      assert.strictEqual(almacen.identidad(), "identidad-2.firma");

      buzon.fallar(undefined);
      yield* sincronizacion.compartir(otra("3c2b1a0d-9e8f-4b7a-8d6c-5f4e3d2c1b0a"));
      assert.lengthOf(buzon.recibidas(), 2);
    }).pipe(Effect.provide(capa));
  });

  it.effect("tras un límite no vuelve a llamar al buzón hasta la hora que dijo", () => {
    const { almacen, buzon, capa } = montar();
    return Effect.gen(function* () {
      yield* TestClock.setTime(MEDIODIA);
      const sincronizacion = yield* Sincronizacion;
      buzon.fallar(new LimiteDelBuzon({ ambito: "dispositivo", reintentarA: MEDIODIA + 60_000 }));
      const primero = yield* Effect.flip(sincronizacion.compartir(CORRECCION));
      assert.strictEqual(primero._tag, "LimiteDelBuzon");
      const llamadas = buzon.llamadas();

      buzon.fallar(undefined);
      yield* TestClock.adjust("59 seconds");
      const segundo = yield* Effect.flip(sincronizacion.compartir(CORRECCION));
      assert.strictEqual(segundo._tag, "LimiteDelBuzon");
      assert.strictEqual(buzon.llamadas(), llamadas);
      // Se queda en el dispositivo, sin apuntar como compartida.
      assert.deepStrictEqual(almacen.guardadas(), [CORRECCION]);
      assert.strictEqual(almacen.compartidas().size, 0);

      yield* TestClock.adjust("1 second");
      yield* sincronizacion.compartir(CORRECCION);
      assert.deepStrictEqual(buzon.recibidas(), [CORRECCION]);
    }).pipe(Effect.provide(capa));
  });

  it.effect("con el buzón cerrado la aportación se queda en el dispositivo", () => {
    const almacen = almacenDePrueba();
    const capa = sincronizacionCon(Effect.fail(new BuzonCerrado())).pipe(
      Layer.provide(almacen.capa),
    );
    return Effect.gen(function* () {
      const sincronizacion = yield* Sincronizacion;
      const fallo = yield* Effect.flip(sincronizacion.compartir(CORRECCION));
      assert.strictEqual(fallo._tag, "BuzonCerrado");
      assert.deepStrictEqual(almacen.guardadas(), [CORRECCION]);
      assert.strictEqual(almacen.compartidas().size, 0);
    }).pipe(Effect.provide(capa));
  });
});
