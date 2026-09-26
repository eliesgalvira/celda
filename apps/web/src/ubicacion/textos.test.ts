import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import type { PuntoElegido } from "@celda/dominio/aportacion";
import { assert, describe, it } from "@effect/vitest";

import type { Referencia } from "./estado.ts";
import { nombreRumbo, textoDistancia, textosReferencia } from "./textos.ts";

const EMPLAZAMIENTO = { longitud: 2.113628, latitud: 41.388344 };
// Unos 340 m al suroeste del emplazamiento.
const CERCA = { longitud: 2.1109, latitud: 41.3861 };

const PUNTO: PuntoElegido = {
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f",
  tipo: "punto-elegido",
  esquema: 1,
  creada: Date.UTC(2026, 8, 26, 9),
  origen: "mapa",
  posicion: CERCA,
};

const gps = (precision: number): Referencia => ({
  tipo: "gps",
  lectura: { posicion: CERCA, precision, fecha: Date.UTC(2026, 8, 26, 10) },
});

describe("textos del punto de referencia", () => {
  it("con la ubicación GPS habla de ti y da su precisión", () => {
    const textos = textosReferencia(gps(25), EMPLAZAMIENTO);
    assert.strictEqual(textoPlano(textos.desde), "tu ubicación (±25 m)");
    assert.deepStrictEqual(terminosDe([textos.desde]), ["punto-de-referencia", "precision"]);
    assert.strictEqual(
      textos.relacion,
      "El emplazamiento está a 340 m de ti, hacia el noreste (42°).",
    );
    assert.isUndefined(textos.margen);
  });

  it("con un punto elegido habla del punto, nunca de ti", () => {
    const textos = textosReferencia({ tipo: "elegido", punto: PUNTO }, EMPLAZAMIENTO);
    assert.strictEqual(textoPlano(textos.desde), "el punto elegido");
    assert.strictEqual(
      textos.relacion,
      "El emplazamiento está a 340 m del punto, hacia el noreste (42°).",
    );
    assert.notMatch(`${textoPlano(textos.desde)} ${textos.relacion}`, /\b(ti|tu|tú|estás)\b/iu);
  });

  it("si el margen del GPS es grande frente a la distancia, avisa de que es aproximada", () => {
    const lejos = textosReferencia(gps(250), EMPLAZAMIENTO);
    assert.match(textoPlano(lejos.margen ?? []), /±250 m/u);
    // La precisión ya va subrayada en «Desde»: el margen no la repite.
    assert.deepStrictEqual(terminosDe([lejos.margen ?? []]), []);
    assert.isDefined(textosReferencia(gps(160), EMPLAZAMIENTO).margen);
  });

  it("encima del emplazamiento no inventa una dirección", () => {
    const textos = textosReferencia(
      { tipo: "elegido", punto: { ...PUNTO, posicion: EMPLAZAMIENTO } },
      EMPLAZAMIENTO,
    );
    assert.strictEqual(textos.relacion, "El emplazamiento está a 10 m del punto.");
  });
});

describe("textoDistancia", () => {
  it("redondea a decenas de metros y pasa a kilómetros desde el kilómetro", () => {
    assert.strictEqual(textoDistancia(3), "10 m");
    assert.strictEqual(textoDistancia(234), "230 m");
    assert.strictEqual(textoDistancia(994), "990 m");
    assert.strictEqual(textoDistancia(996), "1 km");
    assert.strictEqual(textoDistancia(1234), "1,2 km");
  });
});

describe("nombreRumbo", () => {
  it("nombra ocho direcciones y da la vuelta al pasar de 360°", () => {
    assert.deepStrictEqual([0, 45, 90, 135, 180, 225, 270, 315, 350, 360, -10].map(nombreRumbo), [
      "norte",
      "noreste",
      "este",
      "sureste",
      "sur",
      "suroeste",
      "oeste",
      "noroeste",
      "norte",
      "norte",
      "norte",
    ]);
  });
});
