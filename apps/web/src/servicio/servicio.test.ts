import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { aPlano } from "@celda/dominio/plano";
import { celdas } from "@celda/sim/celdas";
import { sectorServicio } from "@celda/sim/sectorServicio";
import { assert, describe, it } from "@effect/vitest";

import { pedirCeldas } from "../celdas/celdas.ts";
import { orientacionDe } from "../ficha/diagrama.ts";
import { celdaDe, lecturaDe, lineaDe, pedirServicio, rasgosDe } from "./servicio.ts";

const emplazamiento = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["orange"],
});

const CAPA = [
  emplazamiento("a", 2.16, 41.39),
  emplazamiento("b", 2.17, 41.39),
  emplazamiento("c", 2.165, 41.4),
];

const calculadas = () => {
  const { origen, params } = pedirCeldas(CAPA);
  const resultado = celdas.ejecutar(params, {
    este: new Float64Array(0),
    norte: new Float64Array(0),
  });
  return { emplazamientos: CAPA, origen, resultado, dudosas: new Map() };
};

const A = CAPA[0]?.posicion ?? { longitud: 0, latitud: 0 };
// Unos 60 m al sureste de «a», dentro de su celda (la caja llega 100 m al sur).
const PUNTO = { longitud: 2.1605, latitud: 41.3896 };

const pedido = (conPunto = true) => ({
  clave: "a",
  emplazamiento: A,
  punto: conPunto ? PUNTO : undefined,
  celda: celdaDe(calculadas(), "a"),
  orientacion: orientacionDe([]),
});

describe("sector que da servicio en la web", () => {
  it("toma la celda del emplazamiento de las celdas calculadas, o nada si no la hay", () => {
    const celda = celdaDe(calculadas(), "a");
    assert.isAbove(celda?.length ?? 0, 2);
    assert.isUndefined(celdaDe(calculadas(), "z"));
    assert.isUndefined(celdaDe(undefined, "a"));
  });

  it("no toma una celda dudosa, que podría recortar una provincia que aún no ha llegado", () => {
    const caja = { suroeste: A, noreste: A };
    const dudosa = { ...calculadas(), dudosas: new Map([["a", { provincias: ["17"], caja }]]) };
    assert.isUndefined(celdaDe(dudosa, "a"));
    assert.isDefined(celdaDe(dudosa, "b"));
  });

  it("pide la simulación en un plano con el emplazamiento en el origen", () => {
    const { params, malla } = pedirServicio(pedido());
    const esperado = aPlano(A, PUNTO);
    assert.closeTo(malla.este[0] ?? 0, esperado.este, 1e-9);
    assert.closeTo(malla.norte[0] ?? 0, esperado.norte, 1e-9);
    assert.deepStrictEqual(params.azimuts, [0, 120, 240]);
    // La celda rodea al emplazamiento: tiene vértices a los dos lados del origen.
    const estes = params.celda.filter((_, i) => i % 2 === 0);
    assert.isBelow(Math.min(...estes), 0);
    assert.isAbove(Math.max(...estes), 0);
    assert.lengthOf(pedirServicio(pedido(false)).malla.este, 0);
  });

  it("lee el sector del punto: al sureste le da servicio el sector de 120°", () => {
    const { params, malla } = pedirServicio(pedido());
    const leida = lecturaDe(sectorServicio.ejecutar(params, malla));
    assert.strictEqual(leida?.sector, 1);
    assert.isTrue(leida?.enCelda);
    assert.closeTo(leida?.distancia ?? 0, 61, 3);
    const { params: p2, malla: m2 } = pedirServicio(pedido(false));
    assert.isUndefined(lecturaDe(sectorServicio.ejecutar(p2, m2)));
  });

  it("dibuja el degradado, los dos sectores que no dan servicio y los tres límites", () => {
    const { params, malla } = pedirServicio(pedido());
    const rasgos = rasgosDe(sectorServicio.ejecutar(params, malla), A);
    const tipos = rasgos.features.map((f) => f.properties.tipo);
    assert.strictEqual(tipos.filter((t) => t === "sector").length, 2);
    assert.strictEqual(tipos.filter((t) => t === "corte").length, 3);
    const bandas = rasgos.features.flatMap((f) =>
      f.properties.tipo === "banda" ? [f.properties.opacidad] : [],
    );
    assert.isAbove(bandas.length, 3);
    for (const f of rasgos.features) {
      if (f.geometry.type === "Polygon") {
        const [anillo = []] = f.geometry.coordinates;
        assert.deepStrictEqual(anillo[0], anillo.at(-1));
      }
    }
  });

  it("sin punto, el degradado cubre la celda y no hay sectores apagados", () => {
    const { params, malla } = pedirServicio(pedido(false));
    const tipos = rasgosDe(sectorServicio.ejecutar(params, malla), A).features.map(
      (f) => f.properties.tipo,
    );
    assert.notInclude(tipos, "sector");
    assert.include(tipos, "banda");
  });

  it("la línea va del emplazamiento al punto, y sin punto no hay", () => {
    assert.deepStrictEqual(lineaDe(A, PUNTO).features[0]?.geometry.coordinates, [
      [A.longitud, A.latitud],
      [PUNTO.longitud, PUNTO.latitud],
    ]);
    assert.lengthOf(lineaDe(A, undefined).features, 0);
    assert.lengthOf(lineaDe(undefined, PUNTO).features, 0);
  });
});
