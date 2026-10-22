import type { MedidaPropia } from "@celda/dominio/medida";
import { assert, describe, it } from "@effect/vitest";

import { AlmacenNoDisponible } from "../ubicacion/almacen.ts";
import {
  BuzonCerrado,
  BuzonSinRespuesta,
  EnvioNoValido,
  EnvioVetado,
  LimiteDelBuzon,
} from "./sincronizacion.ts";
import { cuantoFalta, haciaDonde, queSale, textosDelFallo } from "./textos.ts";

const AHORA = Date.UTC(2026, 9, 3, 12);

const MEDIDA: MedidaPropia = {
  tipo: "propia",
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  esquema: 1,
  creada: AHORA,
  origen: "captura",
  punto: { longitud: 2.1155, latitud: 41.3878 },
  senal: { compania: "vodafone", red: "4g", mhz: null, rsrpDbm: -90, rsrqDb: null, pci: null },
  unidaA: {
    emplazamiento: "movistar-0802532",
    posicion: { longitud: 2.113628, latitud: 41.388344 },
    azimut: null,
  },
};

describe("queSale", () => {
  it("de una medida, cada número que se envía y nada que no esté en ella", () => {
    const datos = queSale(MEDIDA);
    assert.deepStrictEqual(
      datos.map((d) => d.nombre),
      [
        "Compañía",
        "Tipo de red",
        "Potencia de la señal",
        "Dónde la tomaste",
        "Código del emplazamiento que daba servicio",
        "Posición del emplazamiento",
        "Creada",
        "Código al azar de esta aportación",
      ],
    );
  });
});

describe("textosDelFallo", () => {
  it("cada límite dice de quién es y cuándo reintentar, y que se queda en el dispositivo", () => {
    for (const [ambito, titulo] of [
      ["dispositivo", "Has enviado varias seguidas"],
      ["ip", "Muchas aportaciones desde tu red"],
      ["total", "El buzón está lleno por hoy"],
    ] as const) {
      const textos = textosDelFallo(
        new LimiteDelBuzon({ ambito, reintentarA: AHORA + 90 * 60_000 }),
        AHORA,
      );
      assert.strictEqual(textos.titulo, titulo);
      assert.match(textos.texto, /dentro de 2 horas/u);
      assert.match(textos.texto, /Sigue guardada en este dispositivo/u);
    }
  });

  it("el buzón cerrado o sin respuesta guardan la aportación; un veto y un rechazo lo dicen", () => {
    assert.match(textosDelFallo(new BuzonCerrado(), AHORA).texto, /Sigue guardada/u);
    assert.match(
      textosDelFallo(new BuzonSinRespuesta({ motivo: "red" }), AHORA).texto,
      /falle la conexión\. Sigue guardada/u,
    );
    assert.match(textosDelFallo(new EnvioVetado({ que: "ip" }), AHORA).texto, /esta red/u);
    assert.match(
      textosDelFallo(new EnvioNoValido({ motivo: "la medida está fuera de España" }), AHORA).texto,
      /fuera de España/u,
    );
    const sinAlmacen = textosDelFallo(
      new AlmacenNoDisponible({ motivo: "IndexedDB ha rechazado la operación" }),
      AHORA,
    ).texto;
    assert.match(sinAlmacen, /no deja guardarla antes de enviarla/u);
    // El error del navegador es técnico: no se enseña.
    assert.notInclude(sinAlmacen, "IndexedDB");
  });
});

describe("cuantoFalta y haciaDonde", () => {
  it("redondea hacia arriba y nombra el rumbo", () => {
    assert.strictEqual(cuantoFalta(1), "1 min");
    assert.strictEqual(cuantoFalta(59 * 60_000), "59 min");
    assert.strictEqual(cuantoFalta(60 * 60_000 + 1), "2 horas");
    const desde = { longitud: 2, latitud: 41 };
    assert.strictEqual(haciaDonde(desde, { longitud: 2.01, latitud: 41 }), "al este");
    assert.strictEqual(haciaDonde(desde, { longitud: 2, latitud: 41.01 }), "al norte");
  });
});
