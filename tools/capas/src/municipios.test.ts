import {
  indexarMunicipios,
  LimitesDeMunicipios,
  municipioDelPunto,
} from "@celda/dominio/municipio";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { unidadesDelGml } from "./gml.ts";
import {
  clasificar,
  cruzarConElPadron,
  ficheroDeMunicipios,
  limitesDelIgn,
  padronDelIne,
} from "./municipios.ts";
import {
  CSV_DE_PRUEBA,
  FUENTE_DE_PRUEBA,
  GML_MUNICIPIOS_DE_PRUEBA,
  GML_PROVINCIAS_DE_PRUEBA,
} from "./pruebas.ts";

const unidades = (gml: string) => Result.getOrThrow(unidadesDelGml(gml));

const LIMITES = Result.getOrThrow(
  limitesDelIgn(
    unidades(GML_MUNICIPIOS_DE_PRUEBA),
    unidades(GML_PROVINCIAS_DE_PRUEBA),
    FUENTE_DE_PRUEBA,
  ),
);

const PADRON_FUENTE = {
  atribucion: "INE",
  licencia: "CC BY 4.0",
  enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
  publicada: "2025-12-11",
};

const decodificar = Schema.decodeSync(Schema.fromJsonString(LimitesDeMunicipios));

describe("clasificación de las unidades del IGN", () => {
  it("un municipio lleva su código INE, y los demás, el código nacional", () => {
    assert.deepStrictEqual(clasificar("34090808019"), {
      tipo: "municipio",
      codigo: "08019",
      provincia: "08",
    });
    assert.deepStrictEqual(clasificar("34153153078"), {
      tipo: "compartido",
      codigo: "34153153078",
      provincia: "31",
    });
    assert.deepStrictEqual(clasificar("34205454001"), {
      tipo: "sin-provincia",
      codigo: "34205454001",
      provincia: null,
    });
  });
});

describe("límites de municipios y provincias", () => {
  it("ordena los recintos por código y deja fuera la provincia de los territorios no asociados", () => {
    assert.deepStrictEqual(
      LIMITES.territorios.map((t) => [t.codigo, t.tipo, t.provincia]),
      [
        ["08001", "municipio", "08"],
        ["08002", "municipio", "08"],
        ["34070953005", "compartido", "09"],
        ["34205454001", "sin-provincia", null],
      ],
    );
    assert.deepStrictEqual(
      LIMITES.provincias.map((p) => [p.codigo, p.nombre]),
      [
        ["08", "Barcelona"],
        ["09", "Burgos"],
      ],
    );
  });

  it("calcula el área con el límite completo y deja la etiqueta dentro", () => {
    const [a] = LIMITES.territorios;
    // Un trapecio de 0,025° por 0,02° a 41° de latitud: unos 4,67 km².
    assert.closeTo(a?.areaKm2 ?? 0, 4.67, 0.05);
    const indice = indexarMunicipios(LIMITES);
    for (const territorio of LIMITES.territorios) {
      const { municipio, provincia } = municipioDelPunto(territorio.etiqueta, indice);
      assert.strictEqual(
        municipio?.codigo ?? provincia?.codigo ?? null,
        territorio.tipo === "municipio" ? territorio.codigo : territorio.provincia,
      );
    }
  });

  it("los vecinos comparten los arcos de su límite", () => {
    const usos = new Map<number, number>();
    for (const territorio of LIMITES.territorios) {
      for (const referencia of territorio.poligonos.flat(2)) {
        const arco = referencia >= 0 ? referencia : ~referencia;
        usos.set(arco, (usos.get(arco) ?? 0) + 1);
      }
    }
    // El límite de A con B y el de B con el territorio compartido.
    assert.strictEqual([...usos.values()].filter((n) => n === 2).length, 2);
  });

  it("escribe un recinto o un arco por línea y el fichero se vuelve a leer igual", () => {
    const fichero = ficheroDeMunicipios(LIMITES);
    assert.deepStrictEqual(decodificar(fichero), LIMITES);
    const lineas = fichero.trim().split("\n");
    assert.strictEqual(
      lineas.length,
      LIMITES.provincias.length + LIMITES.territorios.length + LIMITES.arcos.length + 4,
    );
  });

  it("falla si un municipio es de una provincia que no está, o si un código se repite", () => {
    const sinBurgos = limitesDelIgn(
      unidades(GML_MUNICIPIOS_DE_PRUEBA),
      unidades(GML_PROVINCIAS_DE_PRUEBA).filter((u) => u.nombre !== "Burgos"),
      FUENTE_DE_PRUEBA,
    );
    assert.isTrue(Result.isFailure(sinBurgos));
    if (Result.isFailure(sinBurgos)) assert.match(sinBurgos.failure.motivo, /provincia 09/u);

    const [primera] = unidades(GML_MUNICIPIOS_DE_PRUEBA);
    const repetida = limitesDelIgn(
      [...unidades(GML_MUNICIPIOS_DE_PRUEBA), ...(primera === undefined ? [] : [primera])],
      unidades(GML_PROVINCIAS_DE_PRUEBA),
      FUENTE_DE_PRUEBA,
    );
    assert.isTrue(Result.isFailure(repetida));
    if (Result.isFailure(repetida)) assert.match(repetida.failure.motivo, /08002 se repite/u);
  });
});

describe("padrón del INE", () => {
  it("toma el año más reciente, lee los miles con punto y descarta los municipios sin valor", () => {
    const padron = Result.getOrThrow(padronDelIne(CSV_DE_PRUEBA, PADRON_FUENTE));
    assert.strictEqual(padron.fuente.referencia, "2025-01-01");
    assert.deepStrictEqual(padron.municipios, [
      { codigo: "08001", habitantes: 1234 },
      { codigo: "08002", habitantes: 56 },
    ]);
  });

  it("falla si faltan columnas o si un valor no es un número", () => {
    const sinTotal = padronDelIne("Municipios;Sexo;Periodo\n08001 A;Total;2025\n", PADRON_FUENTE);
    assert.isTrue(Result.isFailure(sinTotal));
    const letras = padronDelIne(`${CSV_DE_PRUEBA}08001 A;Total;2026;mil\r\n`, PADRON_FUENTE);
    assert.isTrue(Result.isFailure(letras));
    if (Result.isFailure(letras)) assert.match(letras.failure.motivo, /«mil»/u);
  });

  it("se cruza con los límites por código, y falla si falta uno en cualquier lado", () => {
    const padron = Result.getOrThrow(padronDelIne(CSV_DE_PRUEBA, PADRON_FUENTE));
    assert.isTrue(Result.isSuccess(cruzarConElPadron(LIMITES, padron)));

    const cambiado = {
      ...padron,
      municipios: [
        { codigo: "08001", habitantes: 1234 },
        { codigo: "08003", habitantes: 7 },
      ],
    };
    const cruce = cruzarConElPadron(LIMITES, cambiado);
    assert.isTrue(Result.isFailure(cruce));
    if (Result.isFailure(cruce)) {
      assert.strictEqual(
        cruce.failure.motivo,
        "1 municipios sin padrón (08002) y 1 municipios del padrón sin límites (08003)",
      );
    }
  });
});
