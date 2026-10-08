import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import type { EmplazamientoDeCapa } from "./capa.ts";
import { mascarasDeFiltro } from "./filtro.ts";
import type { EmplazamientoSituado } from "./provincias.ts";
import {
  contarEnTramos,
  ESCALA_DE_PUNTOS,
  ficheroDePuntos,
  generarPuntos,
  leerPuntos,
  type PuntosLeidos,
  tramosDeMunicipio,
} from "./puntos.ts";

const situado = (
  clave: string,
  longitud: number,
  latitud: number,
  companias: EmplazamientoDeCapa["companias"],
  provincia: string,
  municipio: string | null,
): EmplazamientoSituado => ({
  emplazamiento: { clave, posicion: { longitud, latitud }, estado: "verificado", companias },
  provincia,
  municipio,
  lugar: { municipio: null, provincia: null },
});

const BARCELONA = [
  situado("movistar-0802532", 2.112_345_6, 41.390_123_4, ["movistar", "orange"], "08", "08019"),
  situado("vodafone-079808", 2.18, 41.45, ["vodafone"], "08", "08019"),
  situado("orange-CATR0508Z", 2.05, 41.36, ["orange"], "08", "08101"),
  situado("digi-0800001", 2.06, 41.37, ["digi"], "08", "08101"),
];
const GIRONA = [
  situado("digi-1700001", 2.8, 42, ["digi"], "17", "17079"),
  // En un territorio compartido o en el mar: sin municipio.
  situado("movistar-1700002", 3.4, 42.1, ["movistar"], "17", null),
];
const SITUADOS = new Map([
  ["17", GIRONA],
  ["08", BARCELONA],
]);

const leidos = (contenido: string): PuntosLeidos => {
  const leido = leerPuntos(contenido);
  if (Result.isFailure(leido)) return assert.fail(leido.failure.motivo);
  return leido.success;
};

/** La posición, las compañías y la provincia de cada punto, en su orden. */
const filas = (puntos: PuntosLeidos) =>
  Array.from({ length: puntos.cuantos }, (_, i) => ({
    lon: puntos.longitud[i] ?? 0,
    lat: puntos.latitud[i] ?? 0,
    companias: puntos.companias[i],
    provincia: puntos.provincias[puntos.provincia[i] ?? -1],
  }));

describe("los puntos de toda España", () => {
  it("llevan cada emplazamiento con su posición al metro, sus compañías y su provincia", () => {
    const puntos = leidos(generarPuntos(SITUADOS));
    assert.strictEqual(puntos.cuantos, 6);
    assert.deepStrictEqual(puntos.provincias, ["08", "17"]);
    const todos = [...BARCELONA, ...GIRONA];
    for (const s of todos) {
      const i = filas(puntos).findIndex(
        ({ lon, lat }) =>
          Math.abs(lon - s.emplazamiento.posicion.longitud) <= 0.5 / ESCALA_DE_PUNTOS &&
          Math.abs(lat - s.emplazamiento.posicion.latitud) <= 0.5 / ESCALA_DE_PUNTOS,
      );
      assert.isAtLeast(i, 0, s.emplazamiento.clave);
      assert.strictEqual(filas(puntos)[i]?.provincia, s.provincia);
    }
    assert.deepStrictEqual(
      filas(puntos).map((fila) => fila.companias),
      // Por provincia y municipio: Barcelona, L'Hospitalet, Girona sin municipio y Girona.
      [5, 2, 4, 8, 1, 8],
    );
  });

  it("van por municipio, y cada tramo dice el suyo y cuántos tiene", () => {
    const puntos = leidos(generarPuntos(SITUADOS));
    assert.deepStrictEqual(
      puntos.tramos.map((t) => [t.municipio, puntos.provincias[t.provincia], t.desde, t.cuantos]),
      [
        ["08019", "08", 0, 2],
        ["08101", "08", 2, 2],
        [null, "17", 4, 1],
        ["17079", "17", 5, 1],
      ],
    );
  });

  it("son los mismos bytes lleguen en el orden que lleguen, y no llevan claves", () => {
    const contenido = generarPuntos(SITUADOS);
    const alReves = new Map(
      [...SITUADOS].toReversed().map(([p, lista]) => [p, lista.toReversed()] as const),
    );
    assert.strictEqual(generarPuntos(alReves), contenido);
    assert.notInclude(contenido, "movistar-0802532");
  });

  it("cuentan por municipio con un filtro solo los de sus compañías, como las zonas", () => {
    const puntos = leidos(generarPuntos(SITUADOS));
    const enBarcelona = tramosDeMunicipio(puntos, "08019");
    assert.strictEqual(contarEnTramos(puntos, enBarcelona, mascarasDeFiltro([])), 2);
    assert.strictEqual(contarEnTramos(puntos, enBarcelona, mascarasDeFiltro(["orange"])), 1);
    // Con DIGI, los de Movistar salen por la red que usa, pero no cuentan.
    const enHospitalet = tramosDeMunicipio(puntos, "08101");
    assert.strictEqual(contarEnTramos(puntos, enHospitalet, mascarasDeFiltro(["digi"])), 1);
    assert.deepStrictEqual(tramosDeMunicipio(puntos, "28079"), []);
  });

  it("unos puntos descuadrados o de otro formato no se dan por buenos", () => {
    const contenido = generarPuntos(SITUADOS);
    const con = (columna: string, valor: string) =>
      contenido.replace(
        new RegExp(`"${columna}":(\\[[^\\]]*\\]|\\d+)`, "u"),
        `"${columna}":${valor}`,
      );
    assert.isTrue(Result.isSuccess(leerPuntos(contenido)));
    assert.isTrue(Result.isFailure(leerPuntos(con("formato", "7"))));
    assert.isTrue(Result.isFailure(leerPuntos(con("lat", "[0]"))));
    // Unos tramos que cuentan más puntos de los que hay, o un tramo sin su número.
    assert.isTrue(
      Result.isFailure(
        leerPuntos(contenido.replace(/"municipios":\[\[[^\]]*\]/u, '"municipios":[[19,9]')),
      ),
    );
    assert.isTrue(
      Result.isFailure(
        leerPuntos(contenido.replace(/"municipios":\[\[[^\]]*\]/u, '"municipios":[[19]')),
      ),
    );
  });

  it("el nombre lleva la huella, recortada", () => {
    assert.strictEqual(
      ficheroDePuntos("0123456789abcdef0123456789abcdef"),
      "puntos/0123456789abcdef.json",
    );
  });
});
