import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";

import { compararConCapa } from "./marcaDeAgua.ts";
import { textosBandas, textosMarca, textosOrigen, tituloDe } from "./textos.ts";

/** 01:44 en Barcelona. */
const CAPA = Date.UTC(2026, 8, 25, 23, 44, 53);

const FICHA: Ficha = {
  clave: "digi-0800027",
  posicion: { longitud: 2.17, latitud: 41.4 },
  direccion: "CL Rossello, 353. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: CAPA,
  version: CAPA,
};

describe("textos de la ficha", () => {
  it("el título es la calle y el número, sin el municipio ni la provincia", () => {
    assert.strictEqual(tituloDe(FICHA), "CL Rossello, 353");
    assert.strictEqual(tituloDe({ ...FICHA, direccion: "" }), "Emplazamiento sin dirección");
  });

  it("si la ficha va por delante del mapa el mismo día, las fechas llevan la hora", () => {
    const mismaNoche = CAPA + 80 * 60_000;
    assert.strictEqual(
      textosMarca(FICHA, compararConCapa(CAPA, mismaNoche)).detalle,
      "Esta ficha es del 26 sept 2026 a las 03:04 y el mapa, del 26 sept 2026 a las 01:44. " +
        "El marcador cambiará cuando se publique el mapa nuevo.",
    );
    const otroDia = CAPA + 86_400_000;
    assert.match(
      textosMarca(FICHA, compararConCapa(CAPA, otroDia)).detalle ?? "",
      /^Esta ficha es del 27 sept 2026 y el mapa, del 26 sept 2026\./u,
    );
    assert.deepStrictEqual(textosMarca(FICHA, compararConCapa(CAPA, CAPA)), {
      titulo: "Datos de la ficha: 26 sept 2026",
    });
  });

  it("las bandas salen una vez cada una, y la que no encaja con su tramo", () => {
    const banda = (mhz: 800 | 900 | null, desdeMhz: number) => ({
      referencia: `B B -${desdeMhz}`,
      compania: "movistar" as const,
      rangos: [{ desdeMhz, hastaMhz: desdeMhz + 10 }],
      mhz,
      anio: 2023,
    });
    assert.deepStrictEqual(textosBandas([banda(800, 852), banda(900, 935), banda(900, 940)]), [
      "800 MHz",
      "900 MHz",
    ]);
    assert.deepStrictEqual(textosBandas([banda(null, 1452)]), ["1452–1462 MHz"]);
  });

  it("una observación dice su código y desde cuándo; una corrección, que la da por desmontada", () => {
    const origen = {
      fuente: "registro-oficial" as const,
      clave: "VODAFONE ESPAÑA, S.A.U. - 086040",
      url: "https://geoportal.minetur.gob.es/",
      fecha: CAPA,
      afirma: "presente" as const,
    };
    assert.deepStrictEqual(textosOrigen(origen), {
      fuente: "Registro oficial",
      detalle: "086040, desde el 26 sept 2026",
      textoEnlace: "Ver en el registro oficial",
      tono: "presente",
    });
    const correccion = textosOrigen({ ...origen, fuente: "antenasmoviles", afirma: "desmontada" });
    assert.strictEqual(correccion.detalle, "086040, la da por desmontada desde el 26 sept 2026");
    assert.strictEqual(correccion.tono, "correccion");
  });
});
