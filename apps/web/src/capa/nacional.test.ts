import { contiene } from "@celda/dominio/area";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";

import {
  type Elemento,
  type ElementoMunicipio,
  type ElementoProvincia,
  type Escena,
  NIVEL_DE_MUNICIPIOS,
} from "./agrupacion.ts";
import {
  claveDeProvincia,
  crearAgrupadorNacional,
  NIVEL_DE_PROVINCIAS,
  provinciasDeLaVista,
} from "./nacional.ts";
import {
  BARCELONA,
  barcelonaConMunicipios,
  EMPLAZAMIENTOS_POR_PROVINCIA,
  estados,
  GIRONA,
  MUNDO,
  RESUMEN,
  resumenConBarcelona,
} from "./pruebasNacional.ts";

const LISTAS = estados(
  ["08", { tipo: "lista", provincia: BARCELONA }],
  ["17", { tipo: "lista", provincia: GIRONA }],
);

/** Lo que hay alrededor del borde entre Barcelona y Girona. */
const BORDE = {
  suroeste: { longitud: 2.3, latitud: 41.85 },
  noreste: { longitud: 2.7, latitud: 42 },
};

const provinciasDe = (escena: Escena): ReadonlyArray<ElementoProvincia> =>
  [...escena.elementos.values()].filter((e): e is ElementoProvincia => e.tipo === "provincia");

describe("provincias que pide la vista", () => {
  it("por debajo del nivel de provincias no pide ninguna: basta el resumen", () => {
    assert.deepStrictEqual(provinciasDeLaVista(RESUMEN, { caja: MUNDO, zoom: 7.9 }), []);
  });

  it("desde ese nivel pide las que tienen emplazamientos en la vista, con su margen", () => {
    assert.deepStrictEqual(provinciasDeLaVista(RESUMEN, { caja: BORDE, zoom: 9 }), ["08", "17"]);
    const soloBarcelona = {
      suroeste: { longitud: 2.3, latitud: 41.85 },
      noreste: { longitud: 2.44, latitud: 42 },
    };
    assert.deepStrictEqual(provinciasDeLaVista(RESUMEN, { caja: soloBarcelona, zoom: 12 }), ["08"]);
    // Lleida no tiene capa: no se pide aunque se vea.
    assert.deepStrictEqual(provinciasDeLaVista(RESUMEN, { caja: MUNDO, zoom: 9 }), ["08", "17"]);
  });
});

describe("escena del resumen", () => {
  const agrupador = crearAgrupadorNacional(RESUMEN, estados());

  it("de lejos, un hexágono por provincia con su número; la de sin cubrir va sin datos", () => {
    const escena = agrupador.escena(6, MUNDO);
    const hexagonos = provinciasDe(escena);
    assert.deepStrictEqual(
      hexagonos.map((h) => [h.clave, h.provincia.emplazamientos, h.provincia.cubierta, h.carga]),
      [
        ["p:08", 40, true, "resumen"],
        ["p:17", 30, true, "resumen"],
        ["p:25", 0, false, "resumen"],
      ],
    );
    assert.strictEqual(escena.elementos.size, 3);
  });

  it("una provincia cubierta dice sus ausencias; una sin cubrir no dice ninguna", () => {
    const [barcelona, girona, lleida] = provinciasDe(agrupador.escena(6, MUNDO));
    assert.deepStrictEqual(barcelona?.ausentes, ["vodafone"]);
    assert.deepStrictEqual(girona?.ausentes, ["movistar"]);
    assert.deepStrictEqual(lleida?.ausentes, []);
  });

  it("solo dibuja las provincias cuya etiqueta cae en la caja", () => {
    const soloLleida = {
      suroeste: { longitud: 0.5, latitud: 41.5 },
      noreste: { longitud: 1.5, latitud: 42.5 },
    };
    assert.deepStrictEqual([...agrupador.escena(6, soloLleida).elementos.keys()], ["p:25"]);
  });
});

describe("escena con provincias", () => {
  it("mientras una provincia llega se ve su hexágono dentro de lo que se ve de ella, nunca un hueco", () => {
    const agrupador = crearAgrupadorNacional(
      RESUMEN,
      estados(["08", { tipo: "cargando" }], ["17", { tipo: "lista", provincia: GIRONA }]),
    );
    // La etiqueta de Barcelona queda fuera: se ve solo el lado este de sus emplazamientos.
    const caja = {
      suroeste: { longitud: 2.47, latitud: 41.85 },
      noreste: { longitud: 2.7, latitud: 42 },
    };
    const escena = agrupador.escena(10, caja);
    const barcelona = escena.elementos.get(claveDeProvincia("08"));
    assert.strictEqual(barcelona?.tipo === "provincia" ? barcelona.carga : undefined, "cargando");
    assert.isTrue(contiene(caja, barcelona?.posicion ?? { longitud: 0, latitud: 0 }));
    assert.isFalse(escena.elementos.has(claveDeProvincia("17")));
  });

  it("en el borde entre dos provincias cada emplazamiento está una sola vez y cada número cuadra", () => {
    const agrupador = crearAgrupadorNacional(RESUMEN, LISTAS);
    for (let nivel = NIVEL_DE_PROVINCIAS; nivel <= 17; nivel++) {
      const escena = agrupador.escena(nivel, BORDE);
      const vistos = new Set<string>();
      let suma = 0;
      for (const elemento of escena.elementos.values()) {
        const suyos = agrupador.emplazamientosDe(elemento).map((e) => e.clave);
        if (elemento.tipo === "agrupacion") {
          assert.strictEqual(elemento.cuantos, suyos.length, elemento.clave);
          suma += elemento.cuantos;
        } else {
          suma += suyos.length;
        }
        for (const clave of suyos) {
          assert.isFalse(vistos.has(clave), `${clave} dos veces en el nivel ${nivel}`);
          vistos.add(clave);
        }
        // Una agrupación nunca mezcla provincias.
        assert.strictEqual(new Set(suyos.map((c) => c[0])).size <= 1, true, elemento.clave);
      }
      assert.strictEqual(suma, 70, `nivel ${nivel}`);
    }
  });

  it("las claves de cada provincia llevan su código", () => {
    const escena = crearAgrupadorNacional(RESUMEN, LISTAS).escena(10, BORDE);
    const claves = [...escena.elementos.keys()];
    assert.isTrue(claves.some((c) => c.startsWith("a:08:")));
    assert.isTrue(claves.some((c) => c.startsWith("a:17:")));
  });

  it("el seleccionado se ve suelto también sobre el resumen", () => {
    const agrupador = crearAgrupadorNacional(RESUMEN, LISTAS);
    const escena = agrupador.escena(5, MUNDO, "g3");
    assert.isTrue(escena.elementos.has("e:g3"));
    assert.isTrue(escena.elementos.has("p:17"));
  });
});

describe("transiciones entre el resumen y las provincias", () => {
  const relacionDe = (escena: Escena, relacion: ReadonlyMap<string, string>) =>
    [...escena.elementos.values()].filter((e: Elemento) => relacion.has(e.clave));

  it("al acercar, cada elemento de una provincia sale de su hexágono; al alejar, va a él", () => {
    const agrupador = crearAgrupadorNacional(RESUMEN, LISTAS);
    const lejos = agrupador.escena(7, MUNDO);
    const cerca = agrupador.escena(9, BORDE);
    const acercar = agrupador.transicion(lejos, cerca);
    assert.strictEqual(acercar.destino.size, 0);
    assert.strictEqual(acercar.origen.size, cerca.elementos.size);
    for (const elemento of cerca.elementos.values()) {
      const provincia =
        elemento.clave.startsWith("a:08:") || elemento.clave.startsWith("e:b") ? "p:08" : "p:17";
      assert.strictEqual(acercar.origen.get(elemento.clave), provincia, elemento.clave);
    }
    const alejar = agrupador.transicion(cerca, lejos);
    assert.deepStrictEqual([...alejar.destino].toSorted(), [...acercar.origen].toSorted());
    assert.strictEqual(alejar.origen.size, 0);
  });

  it("al llegar una provincia en el mismo nivel, sus elementos salen de su hexágono", () => {
    const antes = crearAgrupadorNacional(
      RESUMEN,
      estados(["08", { tipo: "cargando" }], ["17", { tipo: "lista", provincia: GIRONA }]),
    ).escena(10, BORDE);
    const despues = crearAgrupadorNacional(RESUMEN, LISTAS).escena(10, BORDE);
    const transicion = crearAgrupadorNacional(RESUMEN, LISTAS).transicion(antes, despues);
    const deBarcelona = relacionDe(despues, transicion.origen);
    assert.isAbove(deBarcelona.length, 0);
    assert.isTrue(deBarcelona.every((e) => transicion.origen.get(e.clave) === "p:08"));
    // Lo de Girona ya estaba y no se mueve.
    assert.isFalse([...transicion.origen.keys()].some((c) => c.startsWith("a:17:")));
  });

  it("donde hay detalle a los dos lados, la transición es la del agrupador de la provincia", () => {
    const nacional = crearAgrupadorNacional(RESUMEN, LISTAS);
    const fina = nacional.escena(15, BORDE);
    const gruesa = nacional.escena(10, BORDE);
    const suya = BARCELONA.agrupador.transicion(
      BARCELONA.agrupador.escena(15, BORDE),
      BARCELONA.agrupador.escena(10, BORDE),
    );
    const nacionalAlejar = nacional.transicion(fina, gruesa);
    for (const [clave, destino] of suya.destino) {
      assert.strictEqual(nacionalAlejar.destino.get(clave), destino, clave);
    }
  });

  it("entre escenas de dos agrupadores nacionales la transición sigue funcionando", () => {
    const uno = crearAgrupadorNacional(RESUMEN, LISTAS);
    const otro = crearAgrupadorNacional(RESUMEN, LISTAS);
    const t = otro.transicion(uno.escena(7, MUNDO), otro.escena(9, BORDE));
    assert.isAbove(t.origen.size, 0);
  });

  it("todos los emplazamientos de la prueba están en alguna provincia", () => {
    const total = [...EMPLAZAMIENTOS_POR_PROVINCIA.values()].flat().length;
    assert.strictEqual(total, 70);
  });
});

describe("zonas de cada provincia", () => {
  const cargadaCon = (resumen: ResumenLeido) =>
    estados(
      ["08", { tipo: "lista", provincia: barcelonaConMunicipios(resumen) }],
      ["17", { tipo: "lista", provincia: GIRONA }],
    );
  const municipiosDe = (escena: Escena): ReadonlyArray<ElementoMunicipio> =>
    [...escena.elementos.values()].filter((e): e is ElementoMunicipio => e.tipo === "municipio");

  it("una provincia cubierta se ve por municipios, con sus claves y sus números", () => {
    const resumen = resumenConBarcelona(true);
    const agrupador = crearAgrupadorNacional(resumen, cargadaCon(resumen));
    const escena = agrupador.escena(NIVEL_DE_MUNICIPIOS, BORDE);
    assert.deepStrictEqual(
      municipiosDe(escena).map((m) => [m.clave, m.resumen.emplazamientos]),
      [
        ["m:08:08001", 20],
        ["m:08:08002", 15],
        ["m:08:08003", 3],
      ],
    );
    // Los dos sin municipio van sueltos, y Girona, que no tiene municipios, en hexágonos.
    const sueltos = [...escena.elementos.values()].filter(
      (e) => e.tipo === "emplazamiento" && e.emplazamiento.provincia === "08",
    );
    assert.lengthOf(sueltos, 2);
    for (const m of municipiosDe(escena)) {
      assert.strictEqual(agrupador.emplazamientosDe(m).length, m.resumen.emplazamientos);
    }
  });

  it("las ausencias de un municipio cuentan con las compañías de todo el resumen", () => {
    const resumen = resumenConBarcelona(true);
    const escena = crearAgrupadorNacional(resumen, cargadaCon(resumen)).escena(
      NIVEL_DE_MUNICIPIOS,
      BORDE,
    );
    // Solo hay Movistar en Barcelona y Vodafone en Girona: a los municipios les falta Vodafone,
    // pero Pequeño, con 3, no lo dice.
    assert.deepStrictEqual(
      municipiosDe(escena).map((m) => m.resumen.ausentes),
      [["vodafone"], ["vodafone"], []],
    );
  });

  it("una provincia a medias sigue en hexágonos: sus municipios del borde contarían solo una parte", () => {
    const resumen = resumenConBarcelona(false);
    const escena = crearAgrupadorNacional(resumen, cargadaCon(resumen)).escena(
      NIVEL_DE_MUNICIPIOS,
      BORDE,
    );
    assert.lengthOf(municipiosDe(escena), 0);
    assert.isTrue([...escena.elementos.keys()].some((c) => c.startsWith("a:08:")));
  });

  it("una provincia sin cubrir se sigue viendo de cerca con su hexágono, sin número", () => {
    const resumen = resumenConBarcelona(true);
    const escena = crearAgrupadorNacional(resumen, cargadaCon(resumen)).escena(
      NIVEL_DE_MUNICIPIOS,
      MUNDO,
    );
    const lleida = escena.elementos.get(claveDeProvincia("25"));
    assert.strictEqual(lleida?.tipo, "provincia");
    if (lleida?.tipo !== "provincia") return;
    assert.isFalse(lleida.provincia.cubierta);
    assert.strictEqual(lleida.provincia.emplazamientos, 0);
    assert.deepStrictEqual(lleida.ausentes, []);
  });

  it("al acercar desde el resumen, cada municipio sale del hexágono de su provincia", () => {
    const resumen = resumenConBarcelona(true);
    const agrupador = crearAgrupadorNacional(resumen, cargadaCon(resumen));
    const lejos = agrupador.escena(7, MUNDO);
    const cerca = agrupador.escena(NIVEL_DE_MUNICIPIOS, BORDE);
    const acercar = agrupador.transicion(lejos, cerca);
    for (const m of municipiosDe(cerca)) assert.strictEqual(acercar.origen.get(m.clave), "p:08");
    const alejar = agrupador.transicion(cerca, lejos);
    for (const m of municipiosDe(cerca)) assert.strictEqual(alejar.destino.get(m.clave), "p:08");
  });

  it("al alejar de los municipios a los hexágonos, cada municipio va al que recoge los suyos", () => {
    const resumen = resumenConBarcelona(true);
    const agrupador = crearAgrupadorNacional(resumen, cargadaCon(resumen));
    const municipios = agrupador.escena(NIVEL_DE_MUNICIPIOS, BORDE);
    const hexagonos = agrupador.escena(NIVEL_DE_MUNICIPIOS - 1, BORDE);
    const alejar = agrupador.transicion(municipios, hexagonos);
    for (const m of municipiosDe(municipios)) {
      const destino = hexagonos.elementos.get(alejar.destino.get(m.clave) ?? "");
      assert.isDefined(destino, m.clave);
      if (destino === undefined) continue;
      const suyos = new Set(agrupador.emplazamientosDe(destino).map((e) => e.clave));
      assert.isTrue(
        agrupador.emplazamientosDe(m).some((e) => suyos.has(e.clave)),
        `${m.clave} va a un hexágono sin ninguno de los suyos`,
      );
    }
  });
});
