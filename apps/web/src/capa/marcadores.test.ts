import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { assert, describe, it } from "@effect/vitest";

import { ZOOM_LOGOS } from "@celda/ui/mapa/estilo.ts";

import { marcadoresVisibles, nombreDeMarcador, puntosDe, type Vista } from "./marcadores.ts";

const en = (clave: string, longitud: number, latitud: number): EmplazamientoDeCapa => ({
  clave,
  posicion: { longitud, latitud },
  estado: "verificado",
  companias: ["movistar"],
});

/** Una vista de 0,02° × 0,01° alrededor de Campus Nord. */
const CAMPUS_NORD: Vista = {
  caja: {
    suroeste: { longitud: 2.1, latitud: 41.385 },
    noreste: { longitud: 2.12, latitud: 41.395 },
  },
  zoom: 16,
};

const EMPLAZAMIENTOS = [
  en("dentro", 2.11, 41.39),
  en("en-el-margen", 2.121, 41.39),
  en("lejos-al-este", 2.2, 41.39),
  en("lejos-al-sur", 2.11, 41.3),
];

describe("marcadores visibles", () => {
  it("dibuja los de la vista y un margen alrededor, y ninguno más", () => {
    assert.deepStrictEqual(marcadoresVisibles(EMPLAZAMIENTOS, CAMPUS_NORD), {
      tipo: "cerca",
      indices: [0, 1],
    });
  });

  it("lejos no dibuja ninguno: son puntos del mapa, uno por emplazamiento", () => {
    const lejos = { ...CAMPUS_NORD, zoom: ZOOM_LOGOS - 0.5 };
    assert.deepStrictEqual(marcadoresVisibles(EMPLAZAMIENTOS, lejos), { tipo: "lejos" });
    const justo = { ...CAMPUS_NORD, zoom: ZOOM_LOGOS };
    assert.strictEqual(marcadoresVisibles(EMPLAZAMIENTOS, justo).tipo, "cerca");
    assert.lengthOf(puntosDe(EMPLAZAMIENTOS).features, EMPLAZAMIENTOS.length);
  });

  it("sin nada a la vista, la lista está vacía", () => {
    const soloLejos = EMPLAZAMIENTOS.slice(2);
    assert.deepStrictEqual(marcadoresVisibles(soloLejos, CAMPUS_NORD), {
      tipo: "cerca",
      indices: [],
    });
  });
});

describe("nombre accesible de un marcador", () => {
  it("dice qué compañías emiten allí, y el estado si no está verificado", () => {
    assert.strictEqual(nombreDeMarcador(en("a", 0, 0)), "Emplazamiento de Movistar");
    assert.strictEqual(
      nombreDeMarcador({
        ...en("b", 0, 0),
        companias: ["movistar", "vodafone", "orange"],
        estado: "corregido",
      }),
      "Emplazamiento compartido por Movistar, Vodafone y Orange, corregido",
    );
    assert.strictEqual(
      nombreDeMarcador({ ...en("c", 0, 0), companias: ["orange", "digi"] }),
      "Emplazamiento compartido por Orange y Digi",
    );
  });
});
