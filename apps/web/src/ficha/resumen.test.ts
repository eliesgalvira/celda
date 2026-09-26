import type { Mhz } from "@celda/dominio/banda";
import type { Compania } from "@celda/dominio/compania";
import type { EstacionDeFicha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";

import { datosTecnicosDe, filasDelEje, fraseDeResumen } from "./resumen.ts";

const NOCHE = Date.UTC(2026, 8, 26, 0, 15, 3);

/** Un rango publicado dentro de cada banda nominal, como los del registro oficial. */
const RANGO: Readonly<Record<Mhz, { desdeMhz: number; hastaMhz: number }>> = {
  700: { desdeMhz: 778, hastaMhz: 788 },
  800: { desdeMhz: 852, hastaMhz: 862 },
  900: { desdeMhz: 935.1, hastaMhz: 949.9 },
  1800: { desdeMhz: 1805.1, hastaMhz: 1825.1 },
  2100: { desdeMhz: 2155, hastaMhz: 2170 },
  2600: { desdeMhz: 2620, hastaMhz: 2640 },
  3500: { desdeMhz: 3460, hastaMhz: 3600 },
};

/** Una estación base con un expediente por banda; `null` es un tramo que no encaja en ninguna. */
const estacion = (compania: Compania, bandas: ReadonlyArray<Mhz | null>): EstacionDeFicha => ({
  compania,
  codigos: ["0802532"],
  bandas: bandas.map((mhz, i) => ({
    referencia: `B B -23004${String(i).padStart(2, "0")}`,
    compania,
    rangos: [mhz === null ? { desdeMhz: 1452, hastaMhz: 1462 } : RANGO[mhz]],
    mhz,
    anio: 2023,
  })),
  origenes: [
    {
      fuente: "registro-oficial",
      clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
      url: "https://geoportal.minetur.gob.es/",
      fecha: NOCHE,
      afirma: "presente",
    },
  ],
});

describe("fraseDeResumen", () => {
  it("una compañía con bandas bajas y altas: 4G y 5G, llega lejos y da velocidad", () => {
    assert.strictEqual(
      fraseDeResumen([estacion("movistar", [700, 800, 1800, 3500])]),
      "Aquí emite Movistar. Por sus bandas, probablemente da 4G y 5G. Llega lejos y entra bien " +
        "en los edificios, y tiene bandas altas que dan más velocidad.",
    );
  });

  it("varias compañías: las nombra, y dice con cuál da 5G si no lo dan todas", () => {
    assert.strictEqual(
      fraseDeResumen([
        estacion("movistar", [800, 3500]),
        estacion("vodafone", [800, 2600]),
        estacion("orange", [900, 1800]),
      ]),
      "Movistar, Vodafone y Orange comparten este emplazamiento. Por sus bandas, probablemente " +
        "da 4G, y 5G con Movistar. Llega lejos y entra bien en los edificios, y tiene bandas " +
        "altas que dan más velocidad.",
    );
  });

  it("solo 4G: no menciona el 5G", () => {
    const frase = fraseDeResumen([estacion("orange", [800, 1800, 2600])]);
    assert.include(frase, "probablemente da 4G.");
    assert.notInclude(frase, "5G");
  });

  it("3500 MHz se da como 5G probable, nunca como seguro", () => {
    const frase = fraseDeResumen([estacion("vodafone", [3500])]);
    assert.strictEqual(
      frase,
      "Aquí emite Vodafone. Por sus bandas, probablemente da 5G. Tiene bandas altas que dan más " +
        "velocidad, pero no bajas, que son las que llegan más lejos y entran mejor en los edificios.",
    );
  });

  it("solo bandas bajas: llega lejos, y dice que le faltan las altas", () => {
    assert.strictEqual(
      fraseDeResumen([estacion("orange", [800, 900])]),
      "Aquí emite Orange. Por sus bandas, probablemente da 4G. Llega lejos y entra bien en los " +
        "edificios, pero no tiene bandas altas, que son las que dan más velocidad.",
    );
  });

  it("solo bandas medias: alcance y velocidad intermedios", () => {
    assert.include(
      fraseDeResumen([estacion("digi", [1800, 2100])]),
      "probablemente da 4G. Sus bandas son medias, con alcance y velocidad intermedios.",
    );
  });

  it("sin bandas: dice que no se conocen y no deduce nada", () => {
    assert.strictEqual(
      fraseDeResumen([estacion("movistar", []), estacion("vodafone", [])]),
      "Movistar y Vodafone comparten este emplazamiento. Aún no se conocen sus bandas, así que " +
        "no se sabe si da 4G o 5G ni si llega lejos o da velocidad.",
    );
  });

  it("datos incompletos: habla de las bandas que se conocen y dice de quién faltan", () => {
    const frase = fraseDeResumen([estacion("movistar", [800]), estacion("vodafone", [])]);
    assert.strictEqual(
      frase,
      "Movistar y Vodafone comparten este emplazamiento. Por las bandas que se conocen, " +
        "probablemente da 4G. Llega lejos y entra bien en los edificios. " +
        "De Vodafone aún no se conocen las bandas.",
    );
    // Con datos incompletos no afirma lo que falta: puede que Vodafone tenga bandas altas.
    assert.notInclude(frase, "no tiene bandas altas");
  });

  it("datos incompletos con solo bandas medias, como las de Digi en el registro", () => {
    assert.strictEqual(
      fraseDeResumen([estacion("digi", [1800, 2100]), estacion("movistar", [])]),
      "Digi y Movistar comparten este emplazamiento. Por las bandas que se conocen, " +
        "probablemente da 4G. Son bandas medias, con alcance y velocidad intermedios. " +
        "De Movistar aún no se conocen las bandas.",
    );
  });

  it("un tramo que no encaja en ninguna banda cuenta como dato incompleto", () => {
    const frase = fraseDeResumen([estacion("movistar", [800, null])]);
    assert.include(frase, "Por las bandas que se conocen");
    assert.notInclude(frase, "no tiene bandas altas");
    assert.include(fraseDeResumen([estacion("movistar", [null])]), "Aún no se conocen sus bandas");
  });

  it("sin estaciones base no dice quién emite", () => {
    assert.strictEqual(fraseDeResumen([]), "Ninguna fuente dice qué compañía emite aquí.");
  });
});

describe("filasDelEje", () => {
  it("una fila por compañía con sus bandas nominales, una vez cada una y de menor a mayor", () => {
    assert.deepStrictEqual(
      filasDelEje([estacion("movistar", [3500, 800, 900, 900, null]), estacion("vodafone", [])]),
      [
        { compania: "movistar", nombre: "Movistar", bandas: [800, 900, 3500], nota: undefined },
        {
          compania: "vodafone",
          nombre: "Vodafone",
          bandas: [],
          nota: "Aún no se conocen sus bandas",
        },
      ],
    );
  });
});

describe("datosTecnicosDe", () => {
  it("cada expediente con su tramo exacto, su banda y la tecnología como probable", () => {
    const [movistar] = datosTecnicosDe([estacion("movistar", [700, 900, null])]);
    assert.deepStrictEqual(movistar?.expedientes, [
      { referencia: "B B -2300400", tramo: "778–788 MHz", banda: "700 MHz", tecnologia: "5G" },
      {
        referencia: "B B -2300401",
        tramo: "935,1–949,9 MHz",
        banda: "900 MHz",
        tecnologia: "4G (o 2G o 3G)",
      },
      {
        referencia: "B B -2300402",
        tramo: "1452–1462 MHz",
        banda: "Sin banda conocida",
        tecnologia: "No se sabe",
      },
    ]);
    assert.deepStrictEqual(movistar?.origenes, [
      {
        fuente: "Registro oficial",
        clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
        fecha: "desde el 26 sept 2026",
      },
    ]);
  });
});
