import { assert, describe, it } from "@effect/vitest";

import type { CorreccionPropuesta, Corroboracion } from "./aportacion.ts";
import { ADELANTO_MAXIMO_MS, motivoNoAceptable } from "./buzon.ts";

const AHORA = Date.UTC(2026, 9, 3, 12, 0);

const FALTA: CorreccionPropuesta = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322110",
  tipo: "correccion-propuesta",
  esquema: 1,
  creada: AHORA,
  origen: "mapa",
  emplazamiento: null,
  cambio: { tipo: "falta", posicion: { longitud: 2.1141, latitud: 41.3889 }, companias: ["digi"] },
  nota: null,
};

describe("motivoNoAceptable", () => {
  it("rechaza una aportación creada en el futuro", () => {
    assert.isUndefined(motivoNoAceptable({ ...FALTA, creada: AHORA + ADELANTO_MAXIMO_MS }, AHORA));
    assert.match(
      motivoNoAceptable({ ...FALTA, creada: AHORA + ADELANTO_MAXIMO_MS + 1 }, AHORA) ?? "",
      /futura/u,
    );
  });

  it("rechaza un punto propuesto fuera de España", () => {
    const motivo = motivoNoAceptable(
      {
        ...FALTA,
        cambio: { tipo: "falta", posicion: { longitud: 12, latitud: 41 }, companias: ["digi"] },
      },
      AHORA,
    );
    assert.match(motivo ?? "", /fuera de España/u);
  });

  it("una corroboración de una corrección publicada vale", () => {
    const corroboracion: Corroboracion = {
      id: "2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d",
      tipo: "corroboracion",
      esquema: 1,
      creada: AHORA,
      origen: "ficha",
      emplazamiento: "movistar-0802532",
      correccion: "1f0e2d3c-4b5a-4968-8776-655443322110",
    };
    assert.isUndefined(motivoNoAceptable(corroboracion, AHORA));
  });
});
