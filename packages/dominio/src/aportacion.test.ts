import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  Aportacion,
  AportacionCompartible,
  esCompartible,
  LARGO_MAXIMO_NOTA,
} from "./aportacion.ts";

const decodificar = Schema.decodeUnknownEffect(Aportacion);

const PUNTO = {
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f",
  tipo: "punto-elegido",
  esquema: 1,
  creada: Date.UTC(2026, 8, 26, 10, 30),
  origen: "busqueda",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
} as const;

describe("Aportacion", () => {
  it.effect("lee un punto elegido con su identificador, fecha, versión y origen", () =>
    Effect.gen(function* () {
      const leida = yield* decodificar(PUNTO);
      assert.deepStrictEqual(leida, PUNTO);
    }),
  );

  it.effect("no da por buena una versión del esquema que no conoce", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodificar({ ...PUNTO, esquema: 2 }));
      assert.match(error.message, /esquema/u);
    }),
  );

  it.effect("exige un UUID como identificador y un origen conocido", () =>
    Effect.gen(function* () {
      yield* Effect.flip(decodificar({ ...PUNTO, id: "punto-1" }));
      yield* Effect.flip(decodificar({ ...PUNTO, origen: "gps" }));
    }),
  );
});

const leerCompartible = Schema.decodeUnknownEffect(AportacionCompartible);

const CORRECCION = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322110",
  tipo: "correccion-propuesta",
  esquema: 1,
  creada: Date.UTC(2026, 9, 2, 18, 0),
  origen: "ficha",
  emplazamiento: "movistar-0802532",
  cambio: { tipo: "posicion", posicion: { longitud: 2.1141, latitud: 41.3889 } },
  nota: "Está en la azotea del edificio de al lado.",
} as const;

describe("AportacionCompartible", () => {
  it.effect("lee los cuatro tipos de corrección propuesta", () =>
    Effect.gen(function* () {
      const cambios = [
        CORRECCION.cambio,
        { tipo: "compania", compania: "orange", esta: false },
        { tipo: "ya-no-existe" },
      ];
      for (const cambio of cambios) {
        const leida = yield* leerCompartible({ ...CORRECCION, cambio });
        assert.strictEqual(leida.tipo, "correccion-propuesta");
      }
      const falta = yield* leerCompartible({
        ...CORRECCION,
        origen: "mapa",
        emplazamiento: null,
        cambio: { tipo: "falta", posicion: CORRECCION.cambio.posicion, companias: ["digi"] },
        nota: null,
      });
      assert.strictEqual(falta.tipo, "correccion-propuesta");
    }),
  );

  it.effect("solo la de un emplazamiento que falta va sin emplazamiento", () =>
    Effect.gen(function* () {
      yield* Effect.flip(leerCompartible({ ...CORRECCION, emplazamiento: null }));
      yield* Effect.flip(
        leerCompartible({
          ...CORRECCION,
          cambio: { tipo: "falta", posicion: CORRECCION.cambio.posicion, companias: ["digi"] },
        }),
      );
    }),
  );

  it.effect("una nota más larga de la cuenta o vacía no pasa, y una imagen tampoco", () =>
    Effect.gen(function* () {
      yield* Effect.flip(
        leerCompartible({ ...CORRECCION, nota: "a".repeat(LARGO_MAXIMO_NOTA + 1) }),
      );
      yield* Effect.flip(leerCompartible({ ...CORRECCION, nota: "" }));
      const imagen = `data:image/png;base64,${"iVBORw0KGgo".repeat(2000)}`;
      yield* Effect.flip(leerCompartible({ ...CORRECCION, nota: imagen }));
      // Un campo que el esquema no conoce no llega a la aportación leída.
      const conCaptura = yield* leerCompartible({ ...CORRECCION, captura: imagen });
      assert.notProperty(conCaptura, "captura");
    }),
  );

  it.effect("un emplazamiento que falta necesita al menos una compañía, sin repetir", () =>
    Effect.gen(function* () {
      const falta = (companias: ReadonlyArray<string>) =>
        leerCompartible({
          ...CORRECCION,
          origen: "mapa",
          emplazamiento: null,
          cambio: { tipo: "falta", posicion: CORRECCION.cambio.posicion, companias },
        });
      yield* Effect.flip(falta([]));
      yield* Effect.flip(falta(["digi", "digi"]));
    }),
  );

  it.effect("el punto elegido nunca se puede compartir", () =>
    Effect.gen(function* () {
      yield* Effect.flip(leerCompartible(PUNTO));
      assert.isFalse(esCompartible(PUNTO));
    }),
  );
});
