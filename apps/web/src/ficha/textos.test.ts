import type { Ficha } from "@celda/dominio/ficha";
import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";

import { compararConCapa } from "./marcaDeAgua.ts";
import {
  antetituloDe,
  textosDeOrigenes,
  textosMarca,
  textosOrigen,
  textoTramo,
  tituloDe,
} from "./textos.ts";

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
    const alDia = textosMarca(FICHA, compararConCapa(CAPA, CAPA));
    assert.strictEqual(textoPlano(alDia.titulo), "Datos de la ficha: 26 sept 2026");
    assert.isUndefined(alDia.detalle);
    // El título explica qué es: la versión de los datos o que la ficha va por delante del mapa.
    assert.deepStrictEqual(terminosDe([alDia.titulo]), ["version-de-los-datos"]);
    assert.deepStrictEqual(
      terminosDe([textosMarca(FICHA, compararConCapa(CAPA, otroDia)).titulo]),
      ["marca-de-agua"],
    );
  });

  it("el tramo de un expediente sale exacto, con coma decimal y sus dos rangos si los tiene", () => {
    const banda = (rangos: ReadonlyArray<{ desdeMhz: number; hastaMhz: number }>) => ({
      referencia: "B B -2300445",
      compania: "movistar" as const,
      rangos,
      mhz: null,
      anio: 2023,
    });
    assert.strictEqual(
      textoTramo(banda([{ desdeMhz: 925.1, hastaMhz: 935.1 }])),
      "925,1–935,1 MHz",
    );
    assert.strictEqual(
      textoTramo(
        banda([
          { desdeMhz: 1910, hastaMhz: 1915 },
          { desdeMhz: 2155, hastaMhz: 2170 },
        ]),
      ),
      "1910–1915 y 2155–2170 MHz",
    );
    assert.strictEqual(textoTramo(banda([])), "Sin tramo publicado");
  });

  it("una observación dice su código y desde cuándo; una corrección, que la da por desmontada", () => {
    const origen = {
      fuente: "registro-oficial" as const,
      clave: "VODAFONE ESPAÑA, S.A.U. - 086040",
      url: "https://geoportal.minetur.gob.es/",
      fecha: CAPA,
      afirma: "presente" as const,
    };
    const presente = textosOrigen(origen);
    assert.strictEqual(textoPlano(presente.fuente), "Registro oficial");
    assert.strictEqual(textoPlano(presente.detalle), "086040, desde el 26 sept 2026");
    assert.strictEqual(presente.textoEnlace, "Ver en el registro oficial");
    assert.strictEqual(presente.tono, "presente");
    const correccion = textosOrigen({ ...origen, fuente: "antenasmoviles", afirma: "desmontada" });
    assert.strictEqual(
      textoPlano(correccion.detalle),
      "086040, la da por desmontada desde el 26 sept 2026",
    );
    assert.strictEqual(correccion.tono, "correccion");
    assert.deepStrictEqual(terminosDe([correccion.fuente, correccion.detalle]), ["correccion"]);
  });

  it("en «de dónde salen los datos», el registro oficial y la corrección se subrayan una vez", () => {
    const origen = {
      fuente: "registro-oficial" as const,
      clave: "VODAFONE ESPAÑA, S.A.U. - 086040",
      url: "https://geoportal.minetur.gob.es/",
      fecha: CAPA,
      afirma: "presente" as const,
    };
    const desmontada = {
      ...origen,
      fuente: "antenasmoviles" as const,
      afirma: "desmontada" as const,
    };
    const estacion = (compania: "movistar" | "vodafone") => ({
      compania,
      codigos: ["086040"],
      bandas: [],
      origenes: [origen, desmontada],
    });
    const textos = textosDeOrigenes([estacion("movistar"), estacion("vodafone")]);
    assert.deepStrictEqual(terminosDe(textos.flat().flatMap((t) => [t.fuente, t.detalle])), [
      "registro-oficial",
      "correccion",
    ]);
  });

  it("el antetítulo explica qué es un emplazamiento", () => {
    assert.strictEqual(textoPlano(antetituloDe(FICHA)), "Emplazamiento");
    assert.deepStrictEqual(terminosDe([antetituloDe(FICHA)]), ["emplazamiento"]);
  });
});
