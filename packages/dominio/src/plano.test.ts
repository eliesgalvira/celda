import { assert, describe, it } from "@effect/vitest";

import { type Coordenada, distanciaMetros, RADIO_TIERRA_METROS } from "./area.ts";
import {
  aPlano,
  cabeEnElPlano,
  desdePlano,
  errorDelPlano,
  LATITUD_DEL_PLANO,
  origenCerca,
} from "./plano.ts";

const PLAZA_CATALUNYA = { longitud: 2.1701, latitud: 41.3871 };
const CAMPUS_NORD = { longitud: 2.113412, latitud: 41.389278 };

describe("plano local", () => {
  it("pone el origen en (0, 0), el este a la derecha y el norte arriba", () => {
    assert.deepStrictEqual(aPlano(PLAZA_CATALUNYA, PLAZA_CATALUNYA), { este: 0, norte: 0 });
    const campus = aPlano(PLAZA_CATALUNYA, CAMPUS_NORD);
    assert.isBelow(campus.este, 0);
    assert.isAbove(campus.norte, 0);
  });

  it("mide en metros lo mismo que distanciaMetros", () => {
    const { este, norte } = aPlano(PLAZA_CATALUNYA, CAMPUS_NORD);
    assert.closeTo(Math.hypot(este, norte), distanciaMetros(PLAZA_CATALUNYA, CAMPUS_NORD), 5);
  });

  describe("con el origen cerca de lo que se mide", () => {
    /** Distancia sobre la esfera (haversine), la de referencia. */
    const haversine = (a: Coordenada, b: Coordenada): number => {
      const r = Math.PI / 180;
      const h =
        Math.sin(((b.latitud - a.latitud) * r) / 2) ** 2 +
        Math.cos(a.latitud * r) *
          Math.cos(b.latitud * r) *
          Math.sin(((b.longitud - a.longitud) * r) / 2) ** 2;
      return 2 * RADIO_TIERRA_METROS * Math.asin(Math.sqrt(h));
    };
    /** Error relativo de la distancia de `a` a `b` medida en el plano de `origen`. */
    const errorEnElPlano = (origen: Coordenada, a: Coordenada, b: Coordenada) => {
      const pa = aPlano(origen, a);
      const pb = aPlano(origen, b);
      const enPlano = Math.hypot(pb.este - pa.este, pb.norte - pa.norte);
      return Math.abs(enPlano / haversine(a, b) - 1);
    };
    /** Un punto a 1 km al este y otro a 1 km al nordeste: lo que más y lo que menos se deforma. */
    const vecinos = (p: Coordenada): ReadonlyArray<Coordenada> => {
      const porGrado = (RADIO_TIERRA_METROS * Math.PI) / 180;
      const este = 1000 / (porGrado * Math.cos((p.latitud * Math.PI) / 180));
      return [
        { longitud: p.longitud + este, latitud: p.latitud },
        { longitud: p.longitud + este * 0.7, latitud: p.latitud + (1000 * 0.7) / porGrado },
      ];
    };
    const BARCELONA_CENTRO = { longitud: 2.1405, latitud: 41.3925 };
    const LUGARES = {
      "Las Palmas de Gran Canaria": { longitud: -15.4363, latitud: 28.1235 },
      "A Coruña": { longitud: -8.4115, latitud: 43.3623 },
      Maó: { longitud: 4.2658, latitud: 39.8885 },
      // Lo más al norte de España: donde el error acotado es mayor.
      "Estaca de Bares": { longitud: -7.6853, latitud: 43.7897 },
    };

    it("una distancia conocida sale bien en Canarias, Galicia y Menorca", () => {
      for (const [lugar, p] of Object.entries(LUGARES)) {
        const origen = origenCerca(p);
        for (const q of vecinos(p)) {
          assert.isBelow(errorEnElPlano(origen, p, q), 0.0026, lugar);
          assert.isBelow(errorEnElPlano(origen, p, q), errorDelPlano(origen, p.latitud) + 1e-4);
        }
      }
    });

    it("con el origen en Barcelona, la misma distancia sale mal", () => {
      for (const [lugar, p] of Object.entries(LUGARES)) {
        const [alEste] = vecinos(p);
        if (alEste === undefined) continue;
        assert.isAbove(errorEnElPlano(BARCELONA_CENTRO, p, alEste), 0.02, lugar);
      }
      const canarias = LUGARES["Las Palmas de Gran Canaria"];
      assert.approximately(errorDelPlano(BARCELONA_CENTRO, canarias.latitud), 0.18, 0.01);
    });

    it("el error acotado vale para todo lo que queda a LATITUD_DEL_PLANO del origen", () => {
      for (const latitud of [27.6, 36, 40, 43.79]) {
        const origen = origenCerca({ longitud: -3, latitud });
        for (const desvio of [-LATITUD_DEL_PLANO, LATITUD_DEL_PLANO]) {
          assert.isBelow(errorDelPlano(origen, origen.latitud + desvio), 0.0026, `${latitud}`);
        }
      }
    });

    it("dos puntos de la misma casilla dan el mismo origen, y cabe lo que se ve", () => {
      const a = origenCerca({ longitud: 2.1101, latitud: 41.3001 });
      assert.deepStrictEqual(a, origenCerca({ longitud: 2.1999, latitud: 41.3999 }));
      assert.deepStrictEqual(a, { longitud: 2.15, latitud: 41.35 });
      assert.notDeepEqual(a, origenCerca({ longitud: 2.2001, latitud: 41.35 }));
      assert.deepStrictEqual(origenCerca({ longitud: -15.43, latitud: 28.12 }), {
        longitud: -15.45,
        latitud: 28.15,
      });
      assert.isTrue(cabeEnElPlano(a, { longitud: 3, latitud: 41.3 }));
      assert.isFalse(cabeEnElPlano(a, { longitud: 2.15, latitud: 41.19 }));
    });
  });

  it("vuelve al mismo punto del mapa", () => {
    const vuelta = desdePlano(PLAZA_CATALUNYA, aPlano(PLAZA_CATALUNYA, CAMPUS_NORD));
    assert.closeTo(vuelta.longitud, CAMPUS_NORD.longitud, 1e-12);
    assert.closeTo(vuelta.latitud, CAMPUS_NORD.latitud, 1e-12);
  });
});
