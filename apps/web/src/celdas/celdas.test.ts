import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { celdas } from "@celda/sim/celdas";
import { contiene } from "@celda/sim/poligono";
import { assert, describe, it } from "@effect/vitest";

import { cajaDe, type Rectangulo } from "@celda/dominio/area";

import { EMPLAZAMIENTOS_POR_PROVINCIA, RESUMEN } from "../capa/pruebasNacional.ts";
import {
  type CeldaEnMapa,
  celdasDudosas,
  celdasEnMapa,
  MARGEN_CELDAS_M,
  pedirCeldas,
  pistaDeCeldas,
  type ProvinciaFuera,
  provinciasQueFaltan,
} from "./celdas.ts";

const emplazamiento = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
});

const EMPLAZAMIENTOS: ReadonlyArray<EmplazamientoDeCapa> = [
  emplazamiento("campus-nord", 2.113412, 41.389278),
  emplazamiento("placa-catalunya", 2.1701, 41.3871),
  emplazamiento("sagrada-familia", 2.1744, 41.4036),
  emplazamiento("repetido", 2.1701, 41.3871),
  emplazamiento("port", 2.18, 41.37),
];

/** El anillo de una celda como polígono en grados, sin repetir el primer vértice. */
const enGrados = (celda: CeldaEnMapa): Float64Array =>
  Float64Array.from((celda.geometry.coordinates[0] ?? []).slice(0, -1).flat());

describe("celdas de la capa", () => {
  const { origen, params } = pedirCeldas(EMPLAZAMIENTOS);
  const mapa = celdasEnMapa(
    celdas.ejecutar(params, { este: new Float64Array(0), norte: new Float64Array(0) }),
    EMPLAZAMIENTOS,
    origen,
  );

  it("rodean todos los emplazamientos con el margen, en un plano centrado en la capa", () => {
    const { caja, emplazamientos } = params;
    assert.lengthOf(emplazamientos, EMPLAZAMIENTOS.length);
    const estes = emplazamientos.map((e) => e.este);
    const nortes = emplazamientos.map((e) => e.norte);
    assert.closeTo(Math.min(...estes) - caja.oeste, MARGEN_CELDAS_M, 1e-9);
    assert.closeTo(caja.norte - Math.max(...nortes), MARGEN_CELDAS_M, 1e-9);
    // Centrado: tanto a un lado del origen como al otro.
    assert.closeTo(Math.min(...estes) + Math.max(...estes), 0, 1e-6);
  });

  it("dan una celda cerrada por emplazamiento que lo contiene, salvo al repetido", () => {
    assert.deepStrictEqual(
      mapa.features.map((celda) => celda.properties.clave),
      ["campus-nord", "placa-catalunya", "sagrada-familia", "port"],
    );
    for (const celda of mapa.features) {
      const anillo = celda.geometry.coordinates[0] ?? [];
      assert.deepStrictEqual(anillo[0], anillo.at(-1));
      const propio = EMPLAZAMIENTOS.find((e) => e.clave === celda.properties.clave);
      assert.isTrue(
        contiene(enGrados(celda), propio?.posicion.longitud ?? 0, propio?.posicion.latitud ?? 0),
        celda.properties.clave,
      );
    }
  });

  it("un punto del mapa cae en la celda del emplazamiento más cercano", () => {
    // Entre el Campus Nord y la plaza de Catalunya, más cerca del campus.
    const punto = { longitud: 2.13, latitud: 41.388 };
    const dentro = mapa.features.filter((celda) =>
      contiene(enGrados(celda), punto.longitud, punto.latitud),
    );
    assert.deepStrictEqual(
      dentro.map((celda) => celda.properties.clave),
      ["campus-nord"],
    );
  });
});

describe("celdas junto al borde entre dos provincias", () => {
  // Barcelona al oeste y Girona al este, con 1,25 km entre los últimos emplazamientos de una y
  // los primeros de la otra (`pruebasNacional.ts`).
  const barcelona = EMPLAZAMIENTOS_POR_PROVINCIA.get("08") ?? [];
  const girona = EMPLAZAMIENTOS_POR_PROVINCIA.get("17") ?? [];
  const cajaDeGirona = RESUMEN.provincias.find((p) => p.codigo === "17")?.caja;
  const GIRONA_FUERA: ReadonlyArray<ProvinciaFuera> =
    cajaDeGirona === undefined ? [] : [{ codigo: "17", caja: cajaDeGirona }];
  /** La caja de las dos provincias: la del cálculo, lleguen o no. */
  const LAS_DOS = cajaDe([...barcelona, ...girona].map((e) => e.posicion));

  const calcular = (
    emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
    fuera: ReadonlyArray<ProvinciaFuera>,
  ) => {
    const { origen, params } = pedirCeldas(emplazamientos, LAS_DOS);
    const resultado = celdas.ejecutar(params, {
      este: new Float64Array(0),
      norte: new Float64Array(0),
    });
    const dudosas = celdasDudosas(resultado, emplazamientos, origen, fuera);
    // Una celda es convexa: sus vértices la dicen entera, empiece por el que empiece. En una
    // rejilla regular se cortan cuatro celdas en un punto, y un vértice puede salir repetido.
    const vertices = (anillo: ReadonlyArray<[number, number]>) =>
      [...new Set(anillo.map((p) => p.join(" ")))].toSorted();
    const dibujadas = new Map(
      celdasEnMapa(resultado, emplazamientos, origen, dudosas).features.map((c) => [
        c.properties.clave,
        vertices(c.geometry.coordinates[0] ?? []),
      ]),
    );
    return { dudosas, dibujadas };
  };

  const juntas = calcular([...barcelona, ...girona], []);
  const soloBarcelona = calcular(barcelona, GIRONA_FUERA);

  it("con las dos provincias no hay ninguna dudosa, y se dibujan todas", () => {
    assert.strictEqual(juntas.dudosas.size, 0);
    assert.strictEqual(juntas.dibujadas.size, barcelona.length + girona.length);
  });

  it("sin Girona, las de Barcelona junto al borde no se dibujan: saldrían mal", () => {
    const dudosas = [...soloBarcelona.dudosas.keys()];
    assert.isNotEmpty(dudosas);
    // Las de la columna del borde son dudosas; las de la columna más al oeste, no.
    for (const e of barcelona) {
      const alBorde = e.posicion.longitud > 2.48;
      if (alBorde) assert.include(dudosas, e.clave);
      if (e.posicion.longitud < 2.41) assert.notInclude(dudosas, e.clave);
    }
    // Dibujada sin Girona, alguna habría salido distinta de como es con ella.
    const calculadaSinGirona = calcular(barcelona, []).dibujadas;
    assert.isTrue(
      dudosas.some(
        (clave) =>
          JSON.stringify(calculadaSinGirona.get(clave)) !==
          JSON.stringify(juntas.dibujadas.get(clave)),
      ),
    );
  });

  it("sin Girona, las que se dibujan son iguales que con las dos juntas", () => {
    assert.isNotEmpty([...soloBarcelona.dibujadas.keys()]);
    for (const [clave, anillo] of soloBarcelona.dibujadas) {
      assert.deepStrictEqual(anillo, juntas.dibujadas.get(clave), clave);
    }
  });

  it("dice que falta Girona si se ve alguna dudosa, y nada lejos del borde", () => {
    const zona = (longitud: number): Rectangulo => ({
      suroeste: { longitud, latitud: 41.9 },
      noreste: { longitud: longitud + 0.005, latitud: 41.93 },
    });
    assert.deepStrictEqual(provinciasQueFaltan(soloBarcelona.dudosas, zona(2.48)), ["17"]);
    assert.deepStrictEqual(provinciasQueFaltan(soloBarcelona.dudosas, zona(2.4)), []);
  });

  it("una celda que llega lejos también pide la provincia que la recorta", () => {
    // Un emplazamiento solo, a 10 km de Girona: su celda llena la caja y llega hasta ella.
    const aislado = [emplazamiento("aislado", 2.38, 41.92)];
    const { dudosas } = calcular(aislado, GIRONA_FUERA);
    assert.deepStrictEqual(dudosas.get("aislado")?.provincias, ["17"]);
  });
});

describe("pista de las celdas", () => {
  it("no dice nada lejos del zoom de las celdas", () => {
    for (const calculo of ["sin-pedir", "calculando", "listas", "fallo"] as const) {
      assert.isUndefined(pistaDeCeldas(false, calculo));
    }
  });

  it("dice que se calculan, que son un modelo con su versión o que han fallado", () => {
    assert.strictEqual(pistaDeCeldas(true, "calculando")?.texto, "Calculando las celdas…");
    assert.strictEqual(pistaDeCeldas(true, "sin-pedir")?.texto, "Calculando las celdas…");
    const listas = pistaDeCeldas(true, "listas");
    assert.strictEqual(listas?.modelo, "celdas@1");
    assert.isFalse(listas?.reintentar);
    const fallo = pistaDeCeldas(true, "fallo");
    assert.isUndefined(fallo?.modelo);
    assert.strictEqual(fallo?.reintentar, "calculo");
  });

  it("mientras falta una provincia vecina lo dice, y si no llega ofrece pedirla otra vez", () => {
    const girona = { codigo: "17", nombre: "Girona" };
    const cargando = pistaDeCeldas(true, "listas", { tipo: "cargando", provincias: [girona] });
    assert.strictEqual(cargando?.texto, "Cargando Girona para las celdas de junto al borde…");
    assert.isUndefined(cargando?.modelo);
    const fallo = pistaDeCeldas(true, "listas", { tipo: "fallo", provincias: [girona] });
    assert.match(fallo?.texto ?? "", /^No han llegado los emplazamientos de Girona/u);
    assert.deepStrictEqual(fallo?.reintentar, ["17"]);
  });
});
