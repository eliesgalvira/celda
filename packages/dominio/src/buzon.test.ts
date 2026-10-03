import { assert, describe, it } from "@effect/vitest";

import type { Corroboracion } from "./aportacion.ts";
import { distanciaMetros } from "./area.ts";
import {
  ADELANTO_MAXIMO_MS,
  diferenciaDeRumbo,
  DISTANCIA_MAXIMA_MEDIDA_M,
  motivoMedidaNoVerosimil,
  motivoNoAceptable,
} from "./buzon.ts";
import type { MedidaPropia } from "./medida.ts";

const AHORA = Date.UTC(2026, 9, 3, 12, 0);

/** Campus Nord y una medida a unos 150 m al este, en el sector de 120°... */
const MEDIDA: MedidaPropia = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  tipo: "propia",
  esquema: 1,
  creada: AHORA - 60_000,
  origen: "captura",
  punto: { longitud: 2.1155, latitud: 41.3878 },
  senal: { compania: "vodafone", red: "4g", mhz: 1800, rsrpDbm: -90, rsrqDb: -10, pci: 12 },
  unidaA: {
    emplazamiento: "movistar-0802532",
    posicion: { longitud: 2.113628, latitud: 41.388344 },
    azimut: 120,
  },
};

describe("diferenciaDeRumbo", () => {
  it("da la vuelta por el norte", () => {
    assert.strictEqual(diferenciaDeRumbo(350, 10), 20);
    assert.strictEqual(diferenciaDeRumbo(10, 350), 20);
    assert.strictEqual(diferenciaDeRumbo(0, 180), 180);
    assert.strictEqual(diferenciaDeRumbo(90, 90), 0);
  });
});

describe("motivoMedidaNoVerosimil", () => {
  it("acepta una medida cerca del emplazamiento y dentro de su sector", () => {
    assert.isUndefined(motivoMedidaNoVerosimil(MEDIDA));
    assert.isUndefined(
      motivoMedidaNoVerosimil({ ...MEDIDA, unidaA: { ...MEDIDA.unidaA, azimut: null } }),
    );
  });

  it("rechaza una medida a la espalda del sector al que dice estar unida", () => {
    const motivo = motivoMedidaNoVerosimil({
      ...MEDIDA,
      unidaA: { ...MEDIDA.unidaA, azimut: 300 },
    });
    assert.match(motivo ?? "", /sector/u);
  });

  it("junto al emplazamiento el rumbo no cuenta", () => {
    const junto = { ...MEDIDA, punto: { longitud: 2.11364, latitud: 41.38835 } };
    assert.isBelow(distanciaMetros(junto.punto, MEDIDA.unidaA.posicion), 15);
    assert.isUndefined(
      motivoMedidaNoVerosimil({ ...junto, unidaA: { ...MEDIDA.unidaA, azimut: 300 } }),
    );
  });

  it("rechaza una medida demasiado lejos del emplazamiento o fuera de España", () => {
    const lejos = { ...MEDIDA, punto: { longitud: 2.1701, latitud: 41.75 } };
    assert.isAbove(distanciaMetros(lejos.punto, MEDIDA.unidaA.posicion), DISTANCIA_MAXIMA_MEDIDA_M);
    assert.match(
      motivoMedidaNoVerosimil({ ...lejos, unidaA: { ...MEDIDA.unidaA, azimut: null } }) ?? "",
      /del emplazamiento/u,
    );
    assert.match(
      motivoMedidaNoVerosimil({ ...MEDIDA, punto: { longitud: 0, latitud: 0 } }) ?? "",
      /fuera de España/u,
    );
  });
});

describe("motivoNoAceptable", () => {
  it("rechaza una aportación creada en el futuro", () => {
    assert.isUndefined(motivoNoAceptable({ ...MEDIDA, creada: AHORA + ADELANTO_MAXIMO_MS }, AHORA));
    assert.match(
      motivoNoAceptable({ ...MEDIDA, creada: AHORA + ADELANTO_MAXIMO_MS + 1 }, AHORA) ?? "",
      /futura/u,
    );
  });

  it("rechaza un punto propuesto fuera de España", () => {
    const motivo = motivoNoAceptable(
      {
        id: "1f0e2d3c-4b5a-4968-8776-655443322110",
        tipo: "correccion-propuesta",
        esquema: 1,
        creada: AHORA,
        origen: "mapa",
        emplazamiento: null,
        cambio: { tipo: "falta", posicion: { longitud: 12, latitud: 41 }, companias: ["digi"] },
        nota: null,
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
