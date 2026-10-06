import { assert, describe, it } from "@effect/vitest";

import { conClavesEstables, llaveDeProcedencia, procedenciasDe } from "./claveEstable.ts";
import type { Emplazamiento } from "./emplazamiento.ts";

/** Un emplazamiento con su clave y una estación base por cada observación del registro. */
const emplazamiento = (clave: string, observaciones: ReadonlyArray<string>): Emplazamiento => ({
  clave,
  posicion: { longitud: 2.11, latitud: 41.39 },
  direccion: "CL X, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  fuentes: ["registro-oficial"],
  datosDel: 0,
  estaciones: observaciones.map((o) => ({
    compania: "movistar",
    codigos: [o],
    bandas: [],
    observaciones: [{ fuente: "registro-oficial", clave: o }],
  })),
});

/** Dónde estaba cada observación en unos emplazamientos de antes. */
const deAntes = (emplazamientos: ReadonlyArray<Emplazamiento>) => {
  const anterior = new Map(
    emplazamientos.flatMap((e) => procedenciasDe(e).map((p) => [llaveDeProcedencia(p), e.clave])),
  );
  return { anterior, anteriores: new Set(emplazamientos.map((e) => e.clave)) };
};

const claves = (emplazamientos: ReadonlyArray<Emplazamiento>) => emplazamientos.map((e) => e.clave);

describe("claves estables de los emplazamientos", () => {
  it("uno con DIGI y Movistar conserva la clave de DIGI aunque DIGI se vaya", () => {
    const { anterior, anteriores } = deAntes([emplazamiento("digi-1", ["DIGI - 1", "TEF - 9"])]);
    const nuevos = [emplazamiento("movistar-9", ["TEF - 9"])];
    assert.deepStrictEqual(claves(conClavesEstables(nuevos, anterior, anteriores)), ["digi-1"]);
  });

  it("al partirse, la clave se queda con el que la sigue teniendo, y el otro lleva la suya", () => {
    const { anterior, anteriores } = deAntes([emplazamiento("a-1", ["A - 1", "B - 2", "C - 3"])]);
    const nuevos = [emplazamiento("a-1", ["A - 1"]), emplazamiento("b-2", ["B - 2", "C - 3"])];
    assert.deepStrictEqual(claves(conClavesEstables(nuevos, anterior, anteriores)), ["a-1", "b-2"]);
  });

  it("al partirse sin que ninguno la tenga, la hereda el que comparte más", () => {
    const { anterior, anteriores } = deAntes([emplazamiento("a-1", ["A - 1", "B - 2", "C - 3"])]);
    const nuevos = [emplazamiento("b-2", ["B - 2"]), emplazamiento("c-3", ["C - 3", "D - 4"])];
    // Empatan en una observación cada uno: la hereda el de clave menor.
    assert.deepStrictEqual(claves(conClavesEstables(nuevos, anterior, anteriores)), ["a-1", "c-3"]);
    const masDeUno = [emplazamiento("b-2", ["B - 2"]), emplazamiento("c-3", ["C - 3", "A - 1"])];
    assert.deepStrictEqual(claves(conClavesEstables(masDeUno, anterior, anteriores)), [
      "b-2",
      "a-1",
    ]);
  });

  it("al juntarse dos, se queda la clave que ya tenía su estación base menor y la otra desaparece", () => {
    const { anterior, anteriores } = deAntes([
      emplazamiento("a-1", ["A - 1"]),
      emplazamiento("b-2", ["B - 2"]),
    ]);
    const nuevos = [emplazamiento("a-1", ["A - 1", "B - 2"])];
    assert.deepStrictEqual(claves(conClavesEstables(nuevos, anterior, anteriores)), ["a-1"]);
  });

  it("uno nuevo lleva su clave de siempre, y sin cambios no cambia nada", () => {
    const antes = [emplazamiento("a-1", ["A - 1"])];
    const { anterior, anteriores } = deAntes(antes);
    const nuevos = [...antes, emplazamiento("z-9", ["Z - 9"])];
    const estables = conClavesEstables(nuevos, anterior, anteriores);
    assert.deepStrictEqual(claves(estables), ["a-1", "z-9"]);
    assert.strictEqual(estables[0], nuevos[0]);
  });
});
