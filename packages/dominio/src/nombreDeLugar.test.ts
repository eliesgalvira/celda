import { assert, describe, it } from "@effect/vitest";

import {
  deLaComunitatValenciana,
  FORMAS_QUE_NO_SE_VEN,
  formasDe,
  nombreDeLugarDeMunicipio,
  nombreDeLugarDeProvincia,
  nombreDelIgn,
  nombreDelMapaBase,
  nombreDeResultado,
  partesDeLaBarra,
  TABLA_DE_NOMBRES,
} from "./nombreDeLugar.ts";

/** Municipios con su código INE, su oficial del IGN y su nombre de lugar. */
type Caso = readonly [codigo: string, oficial: string, nombre: string];

const comprobarMunicipios = (casos: ReadonlyArray<Caso>) => {
  for (const [codigo, oficial, nombre] of casos) {
    assert.strictEqual(nombreDeLugarDeMunicipio(codigo, oficial), nombre, oficial);
  }
};

describe("nombre de lugar de Celda, por el código INE", () => {
  it("en la Comunitat Valenciana, la forma local de los oficiales bilingües", () => {
    assert.strictEqual(nombreDeLugarDeProvincia("03", "Alacant/Alicante"), "Alacant");
    assert.strictEqual(nombreDeLugarDeProvincia("12", "Castelló/Castellón"), "Castelló");
    assert.strictEqual(nombreDeLugarDeProvincia("46", "València/Valencia"), "València");
    comprobarMunicipios([
      ["03014", "Alacant/Alicante", "Alacant"],
      ["03065", "Elx/Elche", "Elx"],
      ["03009", "Alcoi/Alcoy", "Alcoi"],
      ["46220", "Sagunt/Sagunto", "Sagunt"],
      ["12040", "Castelló de la Plana/Castellón de la Plana", "Castelló de la Plana"],
      // El IGN pone aquí la castellana primero.
      ["12053", "Chilches/Xilxes", "Xilxes"],
    ]);
  });

  it("fuera de la Comunitat Valenciana, la forma castellana", () => {
    assert.strictEqual(nombreDeLugarDeProvincia("01", "Araba/Álava"), "Álava");
    comprobarMunicipios([
      ["31201", "Pamplona/Iruña", "Pamplona"],
      ["20069", "Donostia/San Sebastián", "San Sebastián"],
      ["20055", "Arrasate/Mondragón", "Mondragón"],
      ["31060", "Burlada/Burlata", "Burlada"],
      ["31086", "Valle de Egüés/Eguesibar", "Valle de Egüés"],
    ]);
  });

  it("un municipio de cada provincia con oficiales bilingües", () => {
    comprobarMunicipios([
      ["01036", "Laudio/Llodio", "Llodio"],
      ["03082", "Xàbia/Jávea", "Xàbia"],
      ["12089", "Peníscola/Peñíscola", "Peníscola"],
      ["20069", "Donostia/San Sebastián", "San Sebastián"],
      ["31010", "Altsasu/Alsasua", "Alsasua"],
      ["46013", "Alboraia/Alboraya", "Alboraia"],
      ["48074", "Urduña/Orduña", "Orduña"],
    ]);
  });

  it("los oficiales de una sola forma no cambian", () => {
    for (const [codigo, oficial] of [
      ["17", "Girona"],
      ["25", "Lleida"],
      ["48", "Bizkaia"],
      ["20", "Gipuzkoa"],
      ["15", "A Coruña"],
      ["32", "Ourense"],
      ["31", "Navarra"],
    ] as const) {
      assert.strictEqual(nombreDeLugarDeProvincia(codigo, oficial), oficial);
    }
    comprobarMunicipios([
      ["17079", "Girona", "Girona"],
      ["25120", "Lleida", "Lleida"],
      ["15030", "A Coruña", "A Coruña"],
      ["32054", "Ourense", "Ourense"],
      ["08266", "Cerdanyola del Vallès", "Cerdanyola del Vallès"],
      ["46250", "València", "València"],
      ["48020", "Bilbao", "Bilbao"],
    ]);
  });

  it("los once oficiales con guion son un solo nombre y no cambian", () => {
    const conGuion: ReadonlyArray<readonly [string, string]> = [
      ["01059", "Vitoria-Gasteiz"],
      ["31097", "Estella-Lizarra"],
      ["01001", "Alegría-Dulantzi"],
      ["01043", "Oyón-Oion"],
      ["01044", "Peñacerrada-Urizaharra"],
      ["20065", "Soraluze-Placencia de las Armas"],
      ["48002", "Abanto y Ciérvana-Abanto Zierbena"],
      ["48061", "Maruri-Jatabe"],
      ["48065", "Ugao-Miraballes"],
      ["48080", "Valle de Trápaga-Trapagaran"],
      ["48087", "Trucios-Turtzioz"],
    ];
    assert.lengthOf(conGuion, 11);
    comprobarMunicipios(conGuion.map(([codigo, oficial]) => [codigo, oficial, oficial]));
    for (const [, oficial] of conGuion) assert.isUndefined(formasDe(oficial), oficial);
  });

  it("un bilingüe que la tabla no tiene, o con otro oficial, sale en su primera forma", () => {
    assert.strictEqual(nombreDeLugarDeMunicipio("46999", "Poble Nou/Pueblo Nuevo"), "Poble Nou");
    assert.strictEqual(nombreDeLugarDeMunicipio("31201", "Iruña/Pamplona"), "Iruña");
  });

  it("los códigos de la Comunitat Valenciana son los de sus tres provincias", () => {
    for (const codigo of ["03", "12", "46", "03014", "12040", "46250"]) {
      assert.isTrue(deLaComunitatValenciana(codigo), codigo);
    }
    for (const codigo of ["01", "02", "44", "30", "31201", "16001"]) {
      assert.isFalse(deLaComunitatValenciana(codigo), codigo);
    }
  });
});

describe("rótulo del mapa base, por su posición", () => {
  it("con barra, en la Comunitat Valenciana va la parte que no es `name:es`", () => {
    assert.strictEqual(
      nombreDelMapaBase({ name: "Alacant / Alicante", es: "Alicante" }, true),
      "Alacant",
    );
    assert.strictEqual(nombreDelMapaBase({ name: "Elche / Elx", es: "Elche" }, true), "Elx");
    // Sin `name:es`, la primera.
    assert.strictEqual(nombreDelMapaBase({ name: "Sagunt / Sagunto" }, true), "Sagunt");
  });

  it("con barra, fuera va `name:es` y, sin él, la primera parte", () => {
    assert.strictEqual(
      nombreDelMapaBase({ name: "Donostia / San Sebastián", es: "San Sebastián" }, false),
      "San Sebastián",
    );
    assert.strictEqual(
      nombreDelMapaBase({ name: "Pamplona / Iruña", es: "Pamplona" }, false),
      "Pamplona",
    );
    assert.strictEqual(nombreDelMapaBase({ name: "Arrasate / Mondragón" }, false), "Arrasate");
    // Un `name:es` que no es ninguna de las dos no se escribe: no es el oficial.
    assert.strictEqual(
      nombreDelMapaBase({ name: "Burlada / Burlata", es: "Burlata de abajo" }, false),
      "Burlada",
    );
  });

  it("los nombres sin barra se quedan como están, también los de guion", () => {
    for (const name of ["Girona", "Vitoria-Gasteiz", "Estella-Lizarra", "A Coruña", "València"]) {
      assert.strictEqual(nombreDelMapaBase({ name, latin: name }, true), name);
      assert.strictEqual(nombreDelMapaBase({ name, latin: name }, false), name);
    }
  });

  it("las excepciones van por su `name` tal cual, a cualquier lado", () => {
    const lugar = { name: "Peñacerrada / Urizaharra", es: "Peñacerrada" };
    assert.strictEqual(nombreDelMapaBase(lugar, false), "Peñacerrada-Urizaharra");
    assert.strictEqual(nombreDelMapaBase(lugar, true), "Peñacerrada-Urizaharra");
  });

  it("un lugar en letra no latina lleva `name:es` o, sin él, `name:latin`", () => {
    assert.strictEqual(
      nombreDelMapaBase({ name: "Tanger ⵟⴰⵏⵊⴰ طنجة", es: "Tánger", latin: "Tanger" }, false),
      "Tánger",
    );
    assert.strictEqual(
      nombreDelMapaBase({ name: "الناظور", latin: "an-Nāẓūr" }, false),
      "an-Nāẓūr",
    );
  });

  it("corta la barra como el estilo, con o sin espacios", () => {
    assert.deepStrictEqual(partesDeLaBarra("Alacant / Alicante"), ["Alacant", "Alicante"]);
    assert.deepStrictEqual(partesDeLaBarra("Alacant/Alicante"), ["Alacant", "Alicante"]);
    assert.deepStrictEqual(partesDeLaBarra("Alacant /Alicante"), ["Alacant", "Alicante"]);
    assert.deepStrictEqual(partesDeLaBarra("Alacant/ Alicante"), ["Alacant", "Alicante"]);
    assert.isUndefined(partesDeLaBarra("Vitoria-Gasteiz"));
  });
});

describe("resultado del buscador, por su posición", () => {
  it("un par bilingüe conocido da su nombre de lugar, a cualquier lado y en cualquier orden", () => {
    assert.strictEqual(
      nombreDeResultado("Donostia / San Sebastián", undefined, false),
      "San Sebastián",
    );
    assert.strictEqual(nombreDeResultado("Alacant / Alicante", undefined, true), "Alacant");
    assert.strictEqual(nombreDeResultado("Alicante / Alacant", "Alicante", true), "Alacant");
    assert.strictEqual(nombreDeResultado("Araba / Álava", undefined, false), "Álava");
    assert.strictEqual(nombreDeResultado("València/Valencia", undefined, true), "València");
    assert.strictEqual(
      nombreDeResultado("Peñacerrada / Urizaharra", undefined, false),
      "Peñacerrada-Urizaharra",
    );
  });

  it("un par que no está va por su `name:es` según el lado", () => {
    const plaza = "Konstituzio Plaza / Plaza de la Constitución";
    assert.strictEqual(
      nombreDeResultado(plaza, "Plaza de la Constitución", false),
      "Plaza de la Constitución",
    );
    assert.strictEqual(
      nombreDeResultado(
        "Plaça de l'Ajuntament / Plaza del Ayuntamiento",
        "Plaza del Ayuntamiento",
        true,
      ),
      "Plaça de l'Ajuntament",
    );
    // Sin `name:es`, la primera parte.
    assert.strictEqual(
      nombreDeResultado("Kale Nagusia / Calle Mayor", undefined, false),
      "Kale Nagusia",
    );
  });

  it("sin barra, el mismo nombre", () => {
    assert.strictEqual(nombreDeResultado("Girona", undefined, false), "Girona");
    assert.strictEqual(nombreDeResultado("Vitoria-Gasteiz", "Vitoria", false), "Vitoria-Gasteiz");
  });
});

describe("rótulo del mapa base de reserva del IGN", () => {
  it("de un bilingüe que el IGN rotula dos veces, solo sale el nombre de lugar", () => {
    const pares: ReadonlyArray<readonly [ves: string, quitas: string]> = [
      ["San Sebastián", "Donostia"],
      ["Pamplona", "Iruña"],
      ["Mondragón", "Arrasate"],
      ["Alacant", "Alicante"],
      ["Elx", "Elche"],
      ["Sagunt", "Sagunto"],
      ["Castelló de la Plana", "Castellón de la Plana"],
    ];
    for (const [ves, quitas] of pares) {
      assert.strictEqual(nombreDelIgn(ves), ves);
      assert.isUndefined(nombreDelIgn(quitas), quitas);
    }
  });

  it("un oficial con barra da su nombre de lugar, con o sin espacios", () => {
    assert.strictEqual(nombreDelIgn("Donostia/San Sebastián"), "San Sebastián");
    assert.strictEqual(nombreDelIgn("Alacant/Alicante"), "Alacant");
    assert.strictEqual(nombreDelIgn("Elx/Elche"), "Elx");
    assert.strictEqual(nombreDelIgn("Pamplona / Iruña"), "Pamplona");
    // Uno que no está en la tabla, como las comunidades, en su primera forma.
    assert.strictEqual(nombreDelIgn("Cataluña/Catalunya"), "Cataluña");
  });

  it("sin lo que el IGN pone entre paréntesis: el exónimo de fuera o el país", () => {
    assert.strictEqual(nombreDelIgn("Porto (Oporto)"), "Porto");
    assert.strictEqual(nombreDelIgn("Ceuta (ESP)"), "Ceuta");
  });

  it("los oficiales de una sola forma y los de guion no cambian", () => {
    for (const nombre of ["Girona", "A Coruña", "Bilbao", "Vitoria-Gasteiz", "València"]) {
      assert.strictEqual(nombreDelIgn(nombre), nombre);
    }
  });

  it("ninguna forma que no se ve es el nombre de lugar de una provincia o un municipio", () => {
    const filas = [
      ...Object.values(TABLA_DE_NOMBRES.provincias),
      ...Object.values(TABLA_DE_NOMBRES.municipios),
    ];
    assert.isAtLeast(FORMAS_QUE_NO_SE_VEN.length, filas.length - 1);
    for (const { nombre } of filas) assert.notInclude(FORMAS_QUE_NO_SE_VEN, nombre);
  });
});
