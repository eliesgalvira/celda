import type { Mhz } from "@celda/dominio/banda";
import type { Compania } from "@celda/dominio/compania";
import type { EstacionDeFicha } from "@celda/dominio/ficha";
import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import {
  datosTecnicosDe,
  filasDelEje,
  fraseDeResumen,
  NOTA_TECNICA,
  TITULO_EJE,
} from "./resumen.ts";

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
  bandasSinLeer: bandas.length === 0,
  origenes: [
    {
      fuente: "registro-oficial",
      clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
      url: "https://geoportal.minetur.gob.es/",
      fecha: NOCHE,
      afirma: "presente",
      historial: [],
    },
  ],
});

/** La frase tal como se lee. */
const leer = (estaciones: ReadonlyArray<EstacionDeFicha>): string =>
  textoPlano(fraseDeResumen(estaciones));

describe("fraseDeResumen", () => {
  it("subraya la banda, el 4G y el 5G una vez cada uno", () => {
    const marcada = fraseDeResumen([estacion("movistar", [700, 800, 1800, 3500])]);
    assert.deepStrictEqual(terminosDe([marcada]), ["banda", "4g", "5g"]);
    // La frase dice «bandas» dos veces; los términos repetidos se quitan al pintarla.
    const sinDatos = fraseDeResumen([estacion("vodafone", [])]);
    assert.deepStrictEqual(terminosDe([sinDatos]), ["banda", "4g", "5g"]);
  });

  it("una compañía con bandas bajas y altas: 4G y 5G, llega lejos y da velocidad", () => {
    assert.strictEqual(
      leer([estacion("movistar", [700, 800, 1800, 3500])]),
      "Aquí emite Movistar. Por sus bandas, probablemente da 4G y 5G. Llega lejos, entra bien " +
        "en los edificios y sus bandas altas dan más velocidad.",
    );
  });

  it("varias compañías: las nombra, y dice con cuál da 5G si no lo dan todas", () => {
    assert.strictEqual(
      leer([
        estacion("movistar", [800, 3500]),
        estacion("vodafone", [800, 2600]),
        estacion("orange", [900, 1800]),
      ]),
      "Movistar, Vodafone y Orange comparten este emplazamiento. Por sus bandas, probablemente " +
        "da 4G, y 5G con Movistar. Llega lejos, entra bien en los edificios y sus bandas altas " +
        "dan más velocidad.",
    );
  });

  it("solo 4G: no menciona el 5G", () => {
    const frase = leer([estacion("orange", [800, 1800, 2600])]);
    assert.include(frase, "probablemente da 4G.");
    assert.notInclude(frase, "5G");
  });

  it("3500 MHz se da como 5G probable, nunca como seguro", () => {
    const frase = leer([estacion("vodafone", [3500])]);
    assert.strictEqual(
      frase,
      "Aquí emite Vodafone. Por sus bandas, probablemente da 5G. Sus bandas altas dan más " +
        "velocidad, pero sin bajas llega menos lejos y entra peor en los edificios.",
    );
  });

  it("solo bandas bajas: llega lejos, y dice que le faltan las altas", () => {
    assert.strictEqual(
      leer([estacion("orange", [800, 900])]),
      "Aquí emite Orange. Por sus bandas, probablemente da 4G. Llega lejos y entra bien en los " +
        "edificios, pero sin bandas altas da menos velocidad.",
    );
  });

  it("solo bandas medias: alcance y velocidad intermedios", () => {
    assert.include(
      leer([estacion("digi", [1800, 2100])]),
      "probablemente da 4G. Sus bandas son medias, con alcance y velocidad intermedios.",
    );
  });

  it("sin bandas: dice que no se conocen y no deduce nada", () => {
    assert.strictEqual(
      leer([estacion("movistar", []), estacion("vodafone", [])]),
      "Movistar y Vodafone comparten este emplazamiento. Aún no se conocen sus bandas ni si da " +
        "4G o 5G.",
    );
  });

  it("datos incompletos: habla de las bandas que se conocen y dice de quién faltan", () => {
    const frase = leer([estacion("movistar", [800]), estacion("vodafone", [])]);
    assert.strictEqual(
      frase,
      "Movistar y Vodafone comparten este emplazamiento. Por las bandas que se conocen, " +
        "probablemente da 4G. Llega lejos y entra bien en los edificios. " +
        "De Vodafone aún no se conocen las bandas.",
    );
    // Con datos incompletos no afirma lo que falta: puede que Vodafone tenga bandas altas.
    assert.notInclude(frase, "sin bandas altas");
  });

  it("datos incompletos con solo bandas medias, como las de Digi en el registro", () => {
    assert.strictEqual(
      leer([estacion("digi", [1800, 2100]), estacion("movistar", [])]),
      "Digi y Movistar comparten este emplazamiento. Por las bandas que se conocen, " +
        "probablemente da 4G. Son bandas medias, con alcance y velocidad intermedios. " +
        "De Movistar aún no se conocen las bandas.",
    );
  });

  it("un tramo que no encaja en ninguna banda cuenta como dato incompleto", () => {
    const frase = leer([estacion("movistar", [800, null])]);
    assert.include(frase, "Por las bandas que se conocen");
    assert.notInclude(frase, "sin bandas altas");
    assert.include(leer([estacion("movistar", [null])]), "Aún no se conocen sus bandas");
  });

  it("sin ficha en el registro: lo dice con la fecha y no la da por pendiente", () => {
    const vodafone = { ...estacion("vodafone", []), sinFichaEnRegistro: NOCHE };
    const sola = fraseDeResumen([vodafone]);
    assert.strictEqual(
      textoPlano(sola),
      "Aquí emite Vodafone. El registro no tiene ficha para este emplazamiento " +
        "(comprobado el 26 sept 2026). Sin sus bandas no se sabe si da 4G o 5G.",
    );
    assert.deepStrictEqual(terminosDe([sola]), ["registro-oficial", "banda", "4g", "5g"]);
  });

  it("en un emplazamiento compartido, solo de la compañía sin ficha en el registro", () => {
    const orange = { ...estacion("orange", []), sinFichaEnRegistro: NOCHE };
    assert.strictEqual(
      leer([estacion("movistar", [800]), orange, estacion("vodafone", [])]),
      "Movistar, Orange y Vodafone comparten este emplazamiento. Por las bandas que se " +
        "conocen, probablemente da 4G. Llega lejos y entra bien en los edificios. " +
        "De Vodafone aún no se conocen las bandas. El registro no tiene ficha de Orange para " +
        "este emplazamiento (comprobado el 26 sept 2026).",
    );
    // Si ninguna tiene bandas, las demás siguen pendientes.
    assert.strictEqual(
      leer([orange, estacion("vodafone", [])]),
      "Orange y Vodafone comparten este emplazamiento. Aún no se conocen sus bandas ni si da " +
        "4G o 5G. El registro no tiene ficha de Orange para este emplazamiento " +
        "(comprobado el 26 sept 2026).",
    );
  });

  it("leída sin bandas: dice que el registro no las publica y no la da por pendiente (#41)", () => {
    const vodafone = { ...estacion("vodafone", []), bandasSinLeer: false };
    const sola = fraseDeResumen([vodafone]);
    assert.strictEqual(
      textoPlano(sola),
      "Aquí emite Vodafone. El registro no publica sus bandas. Sin sus bandas no se sabe si da " +
        "4G o 5G.",
    );
    // «bandas» sale dos veces; al pintarla se subraya solo la primera.
    assert.deepStrictEqual(terminosDe([sola]), ["registro-oficial", "banda", "banda", "4g", "5g"]);
    const orange = { ...estacion("orange", []), bandasSinLeer: false };
    assert.strictEqual(
      leer([estacion("movistar", [800]), orange, estacion("vodafone", [])]),
      "Movistar, Orange y Vodafone comparten este emplazamiento. Por las bandas que se " +
        "conocen, probablemente da 4G. Llega lejos y entra bien en los edificios. " +
        "De Vodafone aún no se conocen las bandas. El registro no publica las bandas de Orange.",
    );
  });

  it("sin estaciones base no dice quién emite", () => {
    assert.strictEqual(leer([]), "Ninguna fuente dice qué compañía emite aquí.");
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

  it("la compañía sin ficha en el registro lo dice en su fila", () => {
    const [orange] = filasDelEje([{ ...estacion("orange", []), sinFichaEnRegistro: NOCHE }]);
    assert.strictEqual(orange?.nota, "El registro no tiene ficha para este emplazamiento");
  });

  it("la compañía cuya ficha se ha leído sin bandas dice que el registro no las publica", () => {
    const [orange] = filasDelEje([{ ...estacion("orange", []), bandasSinLeer: false }]);
    assert.strictEqual(orange?.nota, "El registro no publica sus bandas");
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

  it("sin expedientes dice si el registro no tiene la ficha, si aún no se ha leído o si no las publica", () => {
    const [orange, vodafone, movistar] = datosTecnicosDe([
      { ...estacion("orange", []), sinFichaEnRegistro: NOCHE },
      estacion("vodafone", []),
      { ...estacion("movistar", []), bandasSinLeer: false },
    ]);
    assert.strictEqual(movistar?.sinExpedientes, "El registro oficial no publica sus bandas.");
    assert.strictEqual(
      orange?.sinExpedientes,
      "El registro no tiene ficha para este emplazamiento (comprobado el 26 sept 2026), así " +
        "que no se conocen sus bandas.",
    );
    assert.strictEqual(
      vodafone?.sinExpedientes,
      "Celda aún no ha leído sus bandas en el registro oficial.",
    );
  });
});

describe("términos de la ficha", () => {
  it("el título del eje explica la frecuencia y los MHz", () => {
    assert.strictEqual(textoPlano(TITULO_EJE), "¿Qué frecuencia usa cada compañía (MHz)?");
    assert.deepStrictEqual(terminosDe([TITULO_EJE]), ["banda", "mhz"]);
  });

  it("la nota técnica explica la orientación", () => {
    assert.deepStrictEqual(terminosDe([NOTA_TECNICA]), ["azimut"]);
  });
});
