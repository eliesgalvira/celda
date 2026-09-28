import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { versionDeCapa } from "./capa.ts";
import type { Ficha } from "./ficha.ts";
import { generarLote, leerLote } from "./loteDeFichas.ts";
import { indexarMunicipios, type LimitesDeMunicipios } from "./municipio.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15, 3);
const VERSION = versionDeCapa(NOCHE);

const CAMPUS_NORD: Ficha = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [
    {
      compania: "movistar",
      codigos: ["0802532"],
      bandas: [
        {
          referencia: "B B -2300445",
          compania: "movistar",
          rangos: [{ desdeMhz: 778, hastaMhz: 788 }],
          mhz: 700,
          anio: 2023,
        },
      ],
      origenes: [
        {
          fuente: "registro-oficial",
          clave: "TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532",
          url: "https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802532",
          fecha: NOCHE,
          afirma: "presente",
        },
      ],
    },
  ],
  datosDel: NOCHE,
  version: NOCHE,
};
const PEDRALBES: Ficha = {
  ...CAMPUS_NORD,
  clave: "orange-CATR0228A",
  direccion: "PZ EUSEBI GÜELL, 1. BARCELONA, BARCELONA",
  estado: "corregido",
};

describe("lote de fichas", () => {
  it("va en la carpeta de su versión, con la versión como primera clave", () => {
    const lote = generarLote(VERSION, 3, [CAMPUS_NORD]);
    assert.strictEqual(lote.fichero, "fichas@2026-09-26T02:15:03Z/3.json");
    assert.isTrue(lote.contenido.startsWith(`{"version":"${VERSION}","lote":3,`));
  });

  it("las mismas fichas dan siempre los mismos bytes, en el orden que lleguen", () => {
    const una = generarLote(VERSION, 0, [PEDRALBES, CAMPUS_NORD]);
    const otra = generarLote(VERSION, 0, [CAMPUS_NORD, PEDRALBES]);
    assert.strictEqual(otra.contenido, una.contenido);
  });

  it("se lee de vuelta con todas sus fichas, ordenadas por clave", () => {
    const lote = generarLote(VERSION, 0, [PEDRALBES, CAMPUS_NORD]);
    assert.deepStrictEqual(
      leerLote(lote.contenido, VERSION, 0),
      Result.succeed({ version: VERSION, lote: 0, fichas: [CAMPUS_NORD, PEDRALBES] }),
    );
  });

  it("no da por bueno un lote de otra versión, de otro número o dañado", () => {
    const lote = generarLote(VERSION, 0, [CAMPUS_NORD]);
    const otraVersion = leerLote(lote.contenido, versionDeCapa(NOCHE + 86_400_000), 0);
    assert.isTrue(Result.isFailure(otraVersion) && otraVersion.failure._tag === "VersionDistinta");
    const otroLote = leerLote(lote.contenido, VERSION, 1);
    assert.isTrue(Result.isFailure(otroLote) && otroLote.failure._tag === "CapaIlegible");
    const cortado = leerLote(lote.contenido.slice(0, 90), VERSION, 0);
    assert.isTrue(Result.isFailure(cortado) && cortado.failure._tag === "CapaIlegible");
    const html = leerLote("<!doctype html>", VERSION, 0);
    assert.isTrue(Result.isFailure(html) && html.failure._tag === "CapaIlegible");
  });

  it("con los límites de municipios, cada ficha lleva su lugar y el lote cita la fuente una vez", () => {
    const municipios: LimitesDeMunicipios = {
      fuente: {
        atribucion: "Instituto Geográfico Nacional",
        producto: "Base de Datos de Límites Jurisdiccionales de España",
        licencia: "CC BY 4.0",
        enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
        fecha: "2026-08-10",
        huella: "sha256:prueba",
      },
      toleranciaMetros: 50,
      unidadesPorGrado: 100,
      provincias: [
        { codigo: "08", nombre: "Barcelona", etiqueta: { longitud: 2.1, latitud: 41.4 } },
      ],
      territorios: [
        {
          codigo: "08019",
          tipo: "municipio",
          nombre: "Barcelona",
          provincia: "08",
          etiqueta: { longitud: 2.1, latitud: 41.4 },
          areaKm2: 101,
          poligonos: [[[0]]],
        },
      ],
      arcos: [[200, 4100, 100, 0, 0, 100, -100, 0, 0, -100]],
    };
    const fuera: Ficha = { ...PEDRALBES, posicion: { longitud: 10, latitud: 50 } };
    const lote = generarLote(VERSION, 0, [fuera, CAMPUS_NORD], indexarMunicipios(municipios));
    assert.strictEqual(lote.contenido.split('"fuenteDeLugares"').length, 2);
    assert.strictEqual(lote.contenido.split('"producto"').length, 2);

    const leido = Result.getOrThrow(leerLote(lote.contenido, VERSION, 0));
    assert.deepStrictEqual(
      leido.fichas.map((f) => f.lugar),
      [
        {
          municipio: { codigo: "08019", nombre: "Barcelona" },
          provincia: { codigo: "08", nombre: "Barcelona" },
          fuente: municipios.fuente,
        },
        { municipio: null, provincia: null, fuente: municipios.fuente },
      ],
    );
    // Sin límites, el lote es el de antes, byte a byte.
    assert.notInclude(generarLote(VERSION, 0, [CAMPUS_NORD]).contenido, "lugar");
  });
});
