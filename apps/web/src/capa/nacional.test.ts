import { contiene } from "@celda/dominio/area";
import {
  claveDeFiltro,
  combinacionesDe,
  type FiltroDeCompanias,
  separarPorPapel,
  SIN_FILTRO,
} from "@celda/dominio/filtro";
import type { ResumenLeido } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";

import {
  type Agrupador,
  type Elemento,
  type ElementoMunicipio,
  type ElementoProvincia,
  type Escena,
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
  espanaDePrueba,
  estados,
  GIRONA,
  MUNDO,
  RESUMEN,
  resumenConBarcelona,
} from "./pruebasNacional.ts";
import { agrupacionEnHilo } from "./pruebas.ts";
import { NIVEL_DE_MUNICIPIOS } from "./zonas.ts";

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
    // El resumen llega hasta el 9 (ADR 0024): una vista a z8 no pide ninguna capa de provincia.
    assert.strictEqual(NIVEL_DE_PROVINCIAS, 9);
    assert.deepStrictEqual(provinciasDeLaVista(RESUMEN, { caja: BORDE, zoom: 8.9 }), []);
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
    // En el 10 van en las agrupaciones anchas de los municipios grandes, con su nivel delante.
    assert.isTrue(claves.some((c) => c.startsWith("s10:08:")));
    assert.isTrue(claves.some((c) => c.startsWith("s10:17:")));
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
        /^(?:a|s\d+):08:/u.test(elemento.clave) || elemento.clave.startsWith("e:b")
          ? "p:08"
          : "p:17";
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
      ],
    );
    // Los dos sin municipio y los tres de Pequeño, que no llega al mínimo de una zona, van en
    // hexágonos del nivel, y Girona, que no tiene municipios, en los de siempre.
    const fueraDeZonas = [...escena.elementos.values()]
      .filter((e) => e.tipo !== "municipio")
      .flatMap((e) => agrupador.emplazamientosDe(e))
      .filter((s) => s.provincia === "08");
    assert.deepStrictEqual(fueraDeZonas.map((s) => s.municipio ?? "ninguno").toSorted(), [
      "08003",
      "08003",
      "08003",
      "ninguno",
      "ninguno",
    ]);
    assert.isTrue(
      [...escena.elementos.keys()].some((c) => c.startsWith(`s${NIVEL_DE_MUNICIPIOS}:08:`)),
    );
    for (const m of municipiosDe(escena)) {
      assert.strictEqual(agrupador.emplazamientosDe(m).length, m.resumen.emplazamientos);
    }
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

describe("el hexágono de cada provincia, en su centro visual", () => {
  it("de lejos va en el centro visual, y en su etiqueta solo si la tabla no la tiene", () => {
    const real = crearAgrupadorNacional(RESUMEN, estados()).escena(6, MUNDO);
    const barcelona = real.elementos.get(claveDeProvincia("08"));
    // El polo de inaccesibilidad de la provincia de Barcelona, no la etiqueta del resumen.
    assert.closeTo(barcelona?.posicion.longitud ?? 0, 1.945, 0.01);
    assert.closeTo(barcelona?.posicion.latitud ?? 0, 41.6375, 0.01);
    assert.notDeepEqual(barcelona?.posicion, RESUMEN.provincias[0]?.etiqueta);

    const sinTabla = crearAgrupadorNacional(RESUMEN, estados(), {
      centroDe: (p) => p.etiqueta,
    }).escena(6, MUNDO);
    assert.deepStrictEqual(
      sinTabla.elementos.get(claveDeProvincia("08"))?.posicion,
      RESUMEN.provincias[0]?.etiqueta,
    );
  });
});

describe("niveles de municipios grandes", () => {
  const { resumen, provincias } = espanaDePrueba();
  const agrupador = crearAgrupadorNacional(resumen, provincias);
  const municipios = (nivel: number) =>
    [...agrupador.escena(nivel, MUNDO).elementos.values()]
      .filter((e): e is ElementoMunicipio => e.tipo === "municipio")
      .map((e) => e.resumen.municipio.nombre)
      .toSorted();

  it("en el 9 solo son zona los de 50.000 habitantes o más, y en el 10 los de 20.000", () => {
    assert.deepStrictEqual(municipios(8), []);
    assert.deepStrictEqual(municipios(9), ["Barcelona", "Zaragoza"]);
    assert.deepStrictEqual(municipios(10), ["Badalona", "Barcelona", "Zaragoza"]);
    // Desde el 11, por lo que miden: Zaragoza y Barcelona no caben, Utebo sí.
    assert.include(municipios(11), "Utebo");
    assert.notInclude(municipios(11), "Zaragoza");
  });

  it("el resto va en agrupaciones anchas de su nivel, que se abren en el siguiente", () => {
    for (const nivel of [9, 10]) {
      const escena = agrupador.escena(nivel, MUNDO);
      const anchas = [...escena.elementos.values()].filter(
        (e) => e.tipo === "agrupacion" && e.clave.startsWith(`s${nivel}:`),
      );
      assert.isAbove(anchas.length, 0, `nivel ${nivel}`);
      for (const e of anchas) {
        if (e.tipo === "agrupacion") assert.strictEqual(agrupador.zoomDeApertura(e), nivel + 1);
      }
      // Ninguna agrupación de las de siempre, de 60 px.
      assert.isFalse([...escena.elementos.keys()].some((clave) => clave.startsWith("a:")));
    }
  });

  it("un municipio se abre en el primer nivel tras los que es zona", () => {
    const abre = (nombre: string, nivel: number) => {
      const elemento = [...agrupador.escena(nivel, MUNDO).elementos.values()].find(
        (e): e is ElementoMunicipio =>
          e.tipo === "municipio" && e.resumen.municipio.nombre === nombre,
      );
      assert.isDefined(elemento, nombre);
      return elemento === undefined ? 0 : agrupador.zoomDeApertura(elemento);
    };
    assert.strictEqual(abre("Zaragoza", 9), 11);
    assert.strictEqual(abre("Zaragoza", 10), 11);
    assert.strictEqual(abre("Utebo", 11), 13);
  });

  it("una provincia a medias va toda en las agrupaciones anchas, sin zonas", () => {
    const aMedias: ResumenLeido = {
      ...resumen,
      provincias: resumen.provincias.map((p) =>
        p.codigo === "50" ? { ...p, cubierta: false } : p,
      ),
    };
    const { provincias: suyas } = espanaDePrueba(aMedias);
    const escena = crearAgrupadorNacional(aMedias, suyas).escena(9, MUNDO);
    const deZaragoza = [...escena.elementos.values()].filter((e) => e.clave.includes(":50:"));
    assert.isAbove(deZaragoza.length, 0);
    assert.isTrue(deZaragoza.every((e) => e.tipo === "agrupacion" || e.tipo === "emplazamiento"));
    const suma = deZaragoza.reduce((n, e) => n + (e.tipo === "agrupacion" ? e.cuantos : 0), 0);
    assert.isAbove(suma, 200);
  });
});

describe("filtro de compañías (ADR 0026)", () => {
  const { resumen: sinCombinaciones, provincias } = espanaDePrueba();
  /** El resumen de prueba con las combinaciones de cada provincia, como lo publica la noche. */
  const resumen: ResumenLeido = {
    ...sinCombinaciones,
    provincias: sinCombinaciones.provincias.map((p) => {
      const estado = provincias.get(p.codigo);
      const suyos = estado?.tipo === "lista" ? estado.provincia.capa.emplazamientos : [];
      return { ...p, combinaciones: combinacionesDe(suyos) };
    }),
  };
  const cargadas = [...provincias.values()].flatMap((e) =>
    e.tipo === "lista" ? [e.provincia] : [],
  );
  const todos = cargadas.flatMap((p) => p.capa.emplazamientos);
  const agrupadorCon = (filtro: FiltroDeCompanias, conResumen: ResumenLeido = resumen) =>
    crearAgrupadorNacional(conResumen, provincias, {
      filtro,
      agrupaciones: new Map(
        cargadas.map((p) => [p.codigo, agrupacionEnHilo(p, conResumen, filtro)] as const),
      ),
    });

  /** Lo que cuentan los elementos de una escena: los suyos y los de la red usada, aparte. */
  const cuentas = (escena: Escena) => {
    let suyos = 0;
    let deLaRed = 0;
    for (const e of escena.elementos.values()) {
      const cuantos =
        e.tipo === "emplazamiento"
          ? 1
          : e.tipo === "agrupacion"
            ? e.cuantos
            : e.tipo === "provincia"
              ? e.cuantos
              : e.resumen.emplazamientos;
      const red = (e.tipo === "emplazamiento" || e.tipo === "agrupacion") && e.redUsada === true;
      if (red) deLaRed += cuantos;
      else suyos += cuantos;
    }
    return { suyos, deLaRed };
  };

  /** Las claves de los emplazamientos que recoge cada elemento de una escena, por su papel. */
  const recogidos = (agrupador: Agrupador, escena: Escena) => {
    const suyos: Array<string> = [];
    const deLaRed: Array<string> = [];
    for (const e of escena.elementos.values()) {
      const claves = agrupador.emplazamientosDe(e).map((x) => x.clave);
      const red = (e.tipo === "emplazamiento" || e.tipo === "agrupacion") && e.redUsada === true;
      (red ? deLaRed : suyos).push(...claves);
    }
    return { suyos: suyos.toSorted(), deLaRed: deLaRed.toSorted() };
  };

  const FILTROS: ReadonlyArray<FiltroDeCompanias> = [
    ["movistar"],
    ["digi"],
    ["orange"],
    ["movistar", "digi"],
    ["vodafone", "digi"],
  ];

  it("a todos los zooms se cuentan solo los suyos, y los de la red usada aparte", () => {
    for (const filtro of FILTROS) {
      const { propios, redUsada } = separarPorPapel(todos, filtro);
      const agrupador = agrupadorCon(filtro);
      for (let nivel = 5; nivel <= 18; nivel++) {
        const escena = agrupador.escena(nivel, MUNDO);
        const { suyos, deLaRed } = cuentas(escena);
        const que = `${claveDeFiltro(filtro)} nivel ${nivel}`;
        assert.strictEqual(suyos, propios.length, que);
        // De lejos solo se ven los hexágonos de las provincias: la red usada sale de cerca.
        assert.strictEqual(deLaRed, nivel < NIVEL_DE_PROVINCIAS ? 0 : redUsada.length, que);
        if (nivel >= NIVEL_DE_PROVINCIAS) {
          const claves = recogidos(agrupador, escena);
          assert.deepStrictEqual(claves.suyos, propios.map((e) => e.clave).toSorted(), que);
          assert.deepStrictEqual(claves.deLaRed, redUsada.map((e) => e.clave).toSorted(), que);
        }
      }
    }
  });

  it("de lejos, cada provincia cuenta lo del filtro por sus combinaciones", () => {
    const hexagonos = (filtro: FiltroDeCompanias, conResumen = resumen) =>
      provinciasDe(agrupadorCon(filtro, conResumen).escena(6, MUNDO)).map((p) => [
        p.provincia.codigo,
        p.cuantos,
        p.deLaRed,
        p.sinFiltrar,
      ]);
    const deLaProvincia = (codigo: string, filtro: FiltroDeCompanias) => {
      const suyos = todos.filter((e) => e.provincia === codigo);
      const { propios, redUsada } = separarPorPapel(suyos, filtro);
      return [codigo, propios.length, redUsada.length, false];
    };
    assert.deepStrictEqual(hexagonos(["digi"]), [
      deLaProvincia("08", ["digi"]),
      ["25", 0, 0, false],
      deLaProvincia("50", ["digi"]),
    ]);
    // Zaragoza no tiene Digi: su hexágono dice 0, y los de Movistar salen aparte.
    assert.deepStrictEqual(deLaProvincia("50", ["digi"]).slice(1, 3), [0, 144]);
    assert.deepStrictEqual(
      hexagonos(SIN_FILTRO).map(([codigo, cuantos]) => [codigo, cuantos]),
      [
        ["08", 70],
        ["25", 0],
        ["50", 217],
      ],
    );
    // Con un resumen de antes de las combinaciones no se puede contar: cuenta todas y lo dice.
    assert.deepStrictEqual(hexagonos(["digi"], sinCombinaciones), [
      ["08", 70, 0, true],
      ["25", 0, 0, true],
      ["50", 217, 0, true],
    ]);
  });

  it("las zonas cuentan solo lo del filtro, y un municipio sin bastantes deja de ser zona", () => {
    const zonas = (filtro: FiltroDeCompanias, nivel: number) =>
      [...agrupadorCon(filtro).escena(nivel, MUNDO).elementos.values()]
        .filter((e): e is ElementoMunicipio => e.tipo === "municipio")
        .map((e) => [e.resumen.municipio.nombre, e.resumen.emplazamientos] as const)
        .toSorted(([a], [b]) => (a < b ? -1 : 1));
    const enUtebo = (filtro: FiltroDeCompanias) =>
      separarPorPapel(
        todos.filter((e) => e.municipio === "50272"),
        filtro,
      ).propios.length;
    assert.deepStrictEqual(
      zonas(SIN_FILTRO, 11).find(([n]) => n === "Utebo"),
      ["Utebo", 8],
    );
    // Utebo tiene 3 de Orange: menos de los 4 que hacen falta para ser zona.
    assert.strictEqual(enUtebo(["orange"]), 3);
    assert.isUndefined(zonas(["orange"], 11).find(([n]) => n === "Utebo"));
    assert.deepStrictEqual(
      zonas(["movistar"], 11).find(([n]) => n === "Utebo"),
      ["Utebo", enUtebo(["movistar"])],
    );
  });

  it("una provincia lista sin la agrupación del filtro se ve con su hexágono, cargando", () => {
    const agrupador = crearAgrupadorNacional(resumen, provincias, {
      filtro: ["digi"],
      agrupaciones: new Map(),
    });
    const escena = agrupador.escena(10, MUNDO);
    const hexagonos = provinciasDe(escena);
    assert.deepStrictEqual(
      hexagonos.map((p) => [p.provincia.codigo, p.carga]),
      [
        ["08", "cargando"],
        // Lleida no tiene ninguno: va con su hexágono del resumen, como sin filtro.
        ["25", "resumen"],
        ["50", "cargando"],
      ],
    );
    assert.isFalse([...escena.elementos.values()].some((e) => e.tipo === "emplazamiento"));
  });

  it("la red usada sale y entra de sus propias agrupaciones, no de las de la provincia", () => {
    const agrupador = agrupadorCon(["digi"]);
    const lejos = agrupador.escena(12, MUNDO);
    const cerca = agrupador.escena(14, MUNDO);
    const { origen } = agrupador.transicion(lejos, cerca);
    for (const [clave, desde] of origen) {
      const nueva = cerca.elementos.get(clave);
      const vieja = lejos.elementos.get(desde);
      const red = (e: Elemento | undefined) =>
        (e?.tipo === "emplazamiento" || e?.tipo === "agrupacion") && e.redUsada === true;
      assert.strictEqual(red(nueva), red(vieja), `${clave} sale de ${desde}`);
    }
    assert.isAbove(origen.size, 0);
  });
});
