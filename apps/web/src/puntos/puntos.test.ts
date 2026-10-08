import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { mascarasDeFiltro } from "@celda/dominio/filtro";
import { assert, describe, it } from "@effect/vitest";

import { puntosDePrueba } from "../capa/pruebas.ts";
import {
  CERCANOS_PARA_ABRIR,
  emplazamientoDelPunto,
  listaDePuntos,
  NIVEL_DE_PROVINCIAS_CON_PUNTOS,
  posicionDePunto,
  provinciaDePunto,
  queHacerAlTocar,
  ZOOM_PARA_ABRIR,
  ZOOM_PARA_ABRIR_SIEMPRE,
} from "./puntos.ts";
import { deLaRedUsada, dondeQueda, resumenDeLaLista } from "./textos.ts";

const emplazamiento = (
  clave: string,
  longitud: number,
  latitud: number,
  companias: EmplazamientoLeido["companias"],
): EmplazamientoLeido => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias,
  barrio: null,
  lote: 0,
  provincia: "08",
  municipio: "08019",
});

const EN_BARCELONA = [
  emplazamiento("movistar-1", 2.17, 41.39, ["movistar"]),
  emplazamiento("orange-2", 2.172, 41.39, ["orange"]),
  emplazamiento("digi-3", 2.17, 41.392, ["digi"]),
  emplazamiento("vodafone-4", 2.3, 41.5, ["vodafone"]),
];
const PUNTOS = puntosDePrueba([{ codigo: "08", emplazamientos: EN_BARCELONA }]).puntos;
const CAJA = {
  suroeste: { longitud: 2.16, latitud: 41.38 },
  noreste: { longitud: 2.18, latitud: 41.4 },
};
const CENTRO = { longitud: 2.17, latitud: 41.39 };

describe("tocar los puntos", () => {
  it("sin ninguno bajo el dedo, no hace nada", () => {
    assert.deepStrictEqual(queHacerAlTocar(12, []), { tipo: "nada" });
  });

  it("de lejos acerca hacia el dedo, sin llegar nunca a los logos de un toque", () => {
    assert.deepStrictEqual(queHacerAlTocar(5.5, [{ indice: 3, distancia: 2 }]), {
      tipo: "acercar",
      zoom: 8,
    });
    const muchos = Array.from({ length: CERCANOS_PARA_ABRIR + 1 }, (_, i) => ({
      indice: i,
      distancia: i,
    }));
    const decision = queHacerAlTocar(ZOOM_PARA_ABRIR_SIEMPRE - 0.5, muchos);
    assert.deepStrictEqual(decision, { tipo: "acercar", zoom: NIVEL_DE_PROVINCIAS_CON_PUNTOS });
  });

  it("de cerca, con pocos bajo el dedo, abre el más cercano sin mover el zoom", () => {
    assert.deepStrictEqual(
      queHacerAlTocar(ZOOM_PARA_ABRIR, [
        { indice: 7, distancia: 9 },
        { indice: 4, distancia: 3 },
      ]),
      { tipo: "abrir", indice: 4 },
    );
  });

  it("desde el zoom de abrir siempre, abre el más cercano aunque haya muchos", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({ indice: 20 - i, distancia: 12 - i }));
    assert.deepStrictEqual(queHacerAlTocar(ZOOM_PARA_ABRIR_SIEMPRE, muchos), {
      tipo: "abrir",
      indice: 9,
    });
  });
});

describe("el emplazamiento de un punto", () => {
  it("es el de la capa de su provincia más cercano a su posición, redondeada al metro", () => {
    for (let i = 0; i < PUNTOS.cuantos; i++) {
      const suyo = emplazamientoDelPunto(EN_BARCELONA, posicionDePunto(PUNTOS, i));
      const companias = PUNTOS.companias[i];
      assert.strictEqual(provinciaDePunto(PUNTOS, i), "08");
      assert.isDefined(suyo);
      assert.isTrue(
        Math.abs((suyo?.posicion.longitud ?? 0) - (PUNTOS.longitud[i] ?? 0)) < 1e-5,
        `punto ${i} con ${companias}`,
      );
    }
  });
});

describe("la lista de los que se ven", () => {
  it("lleva los de la caja, del más cercano al centro al más lejano, con dónde quedan", () => {
    const lista = listaDePuntos(PUNTOS, CAJA, CENTRO, mascarasDeFiltro([]));
    assert.strictEqual(lista.total, 3);
    assert.deepStrictEqual(
      lista.primeros.map((p) => p.companias),
      [["movistar"], ["orange"], ["digi"]],
    );
    assert.deepStrictEqual(lista.primeros.map(dondeQueda), [
      "en el centro del mapa",
      "a 170 m al este del centro",
      "a 220 m al norte del centro",
    ]);
    assert.strictEqual(
      resumenDeLaLista(lista),
      "Se ven 3, del más cercano al centro del mapa al más lejano.",
    );
  });

  it("con un filtro lleva los suyos y los de la red que usan, que lo dicen", () => {
    const lista = listaDePuntos(PUNTOS, CAJA, CENTRO, mascarasDeFiltro(["digi"]));
    assert.deepStrictEqual(
      lista.primeros.map((p) => [p.companias, p.redUsada]),
      [
        [["movistar"], true],
        [["digi"], false],
      ],
    );
    assert.strictEqual(
      deLaRedUsada(lista.primeros[0] ?? assert.fail("sin el primero"), ["digi"]),
      "red de Movistar que usa Digi",
    );
  });

  it("con más de los que caben, lleva los más cercanos y lo dice", () => {
    const lista = listaDePuntos(PUNTOS, CAJA, CENTRO, mascarasDeFiltro([]), 2);
    assert.lengthOf(lista.primeros, 2);
    assert.strictEqual(
      resumenDeLaLista(lista),
      "Se ven 3. Aquí van los 2 más cercanos al centro del mapa.",
    );
    assert.strictEqual(
      resumenDeLaLista({ total: 0, primeros: [] }),
      "No se ve ninguno. Mueve o aleja el mapa.",
    );
  });
});
