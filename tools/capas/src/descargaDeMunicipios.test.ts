// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { LimitesDeMunicipios, PadronDeMunicipios } from "@celda/dominio/municipio";
import {
  clienteDePrueba,
  NO_HAY_ROBOTS,
  type Peticion,
  type Respuesta,
} from "@celda/ingesta/pruebas/http";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { descargarMunicipios, fechaDeCabecera, leerCanalDelIgn } from "./descargaDeMunicipios.ts";
import { GML_MUNICIPIOS, GML_PROVINCIAS } from "./municipios.ts";
import {
  AVISO_DE_PRUEBA,
  canalDePrueba,
  CSV_DE_PRUEBA,
  GML_MUNICIPIOS_DE_PRUEBA,
  GML_PROVINCIAS_DE_PRUEBA,
  zipDe,
} from "./pruebas.ts";

const decodificarLimites = Schema.decodeSync(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarPadron = Schema.decodeSync(Schema.fromJsonString(PadronDeMunicipios));

const CANAL = "/atom/dataset_feeds/lin_lim_mun.es.xml";
const ZIP = "/CentroDescargas/documentos/atom/au/lineas_limite_gml.zip";
const AVISO = "/dyngs/AYU/index.htm?cid=125";
const CSV = "/jaxiT3/files/t/es/csv_bdsc/29005.csv";

interface Fuentes {
  readonly canal?: string;
  readonly robotsIne?: Respuesta;
  readonly aviso?: string;
  readonly csv?: string;
}

/**
 * Descarga con los sitios de prueba en una carpeta temporal, `veces` seguidas. Devuelve cómo
 * acabó la última, las peticiones de todas y qué quedó escrito.
 */
const descargar = (fuentes: Fuentes = {}, veces = 1) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const carpeta = yield* fs.makeTempDirectoryScoped();
    const zip = yield* zipDe([
      [GML_MUNICIPIOS, GML_MUNICIPIOS_DE_PRUEBA],
      [GML_PROVINCIAS, GML_PROVINCIAS_DE_PRUEBA],
    ]);
    const responder = (url: URL): Respuesta => {
      const ruta = `${url.pathname}${url.search}`;
      if (url.host === "www.ine.es" && ruta === "/robots.txt") {
        return fuentes.robotsIne ?? { estado: 200, cuerpo: "User-agent: *\nDisallow: /cgi-bin/\n" };
      }
      if (ruta === "/robots.txt") return NO_HAY_ROBOTS;
      if (url.host === "www.ign.es" && ruta === CANAL) {
        return { estado: 200, cuerpo: fuentes.canal ?? canalDePrueba() };
      }
      if (url.host === "centrodedescargas.cnig.es" && ruta === ZIP) {
        return { estado: 200, cuerpo: new Uint8Array(zip) };
      }
      if (url.host === "www.ine.es" && ruta === AVISO) {
        return { estado: 200, cuerpo: fuentes.aviso ?? AVISO_DE_PRUEBA };
      }
      if (url.host === "www.ine.es" && ruta === CSV) {
        return {
          estado: 200,
          cuerpo: fuentes.csv ?? CSV_DE_PRUEBA,
          cabeceras: { "last-modified": "Thu, 11 Dec 2025 10:00:09 GMT" },
        };
      }
      return { estado: 404, cuerpo: "" };
    };
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const opciones = {
      municipios: `${carpeta}/municipios.json`,
      padron: `${carpeta}/padron.json`,
      cache: `${carpeta}/cache`,
      pausa: Duration.zero,
    };
    const una = Effect.result(
      descargarMunicipios(opciones).pipe(Effect.provide(clienteDePrueba(peticiones, responder))),
    );
    let salida = yield* una;
    for (let vez = 1; vez < veces; vez++) salida = yield* una;
    const leer = (ruta: string) => fs.readFileString(ruta).pipe(Effect.orElseSucceed(() => ""));
    const hechas = yield* Ref.get(peticiones);
    return {
      fallo: Result.isFailure(salida) ? salida.failure._tag : undefined,
      rutas: hechas.map((p) => p.ruta),
      agentes: hechas.map((p) => p.userAgent ?? ""),
      municipios: yield* leer(opciones.municipios),
      padron: yield* leer(opciones.padron),
      cache: yield* fs.readDirectory(opciones.cache).pipe(Effect.orElseSucceed(() => [])),
    };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("orden municipios", () => {
  it("lee del canal del IGN el producto, los derechos, la fecha y el ZIP", () => {
    assert.deepStrictEqual(
      leerCanalDelIgn(canalDePrueba()),
      Result.succeed({
        producto: "Base de Datos de Límites Jurisdiccionales de España",
        licencia: "CC BY 4.0 ign.es",
        fecha: "2026-08-10",
        zip: "https://centrodedescargas.cnig.es/CentroDescargas/documentos/atom/au/lineas_limite_gml.zip",
      }),
    );
    assert.isTrue(Result.isFailure(leerCanalDelIgn("<feed><title>Otro</title></feed>")));
  });

  it("lee la fecha de una cabecera HTTP", () => {
    assert.strictEqual(fechaDeCabecera("Thu, 11 Dec 2025 10:00:09 GMT"), "2025-12-11");
    assert.isUndefined(fechaDeCabecera("ayer"));
  });

  it.effect("descarga, comprueba licencias y fechas, y guarda los límites y el padrón", () =>
    Effect.gen(function* () {
      const { fallo, rutas, agentes, municipios, padron, cache } = yield* descargar();
      assert.isUndefined(fallo);
      // Primero el robots.txt de cada sitio; el ZIP, después de comprobar la licencia del canal.
      assert.deepStrictEqual(rutas, [
        "/robots.txt",
        CANAL,
        "/robots.txt",
        ZIP,
        "/robots.txt",
        AVISO,
        CSV,
      ]);
      for (const agente of agentes) assert.match(agente, /^Celda \(generador de capas;/u);

      const limites = decodificarLimites(municipios);
      assert.strictEqual(limites.fuente.fecha, "2026-08-10");
      assert.strictEqual(limites.fuente.licencia, "CC BY 4.0");
      assert.match(limites.fuente.huella, /^sha256:[0-9a-f]{64}$/u);
      assert.deepStrictEqual(
        limites.territorios.map((t) => t.codigo),
        ["08001", "08002", "34070953005", "34205454001"],
      );
      const leido = decodificarPadron(padron);
      assert.deepStrictEqual(leido.fuente, {
        atribucion: "INE",
        licencia: "CC BY 4.0",
        enlace: "https://www.ine.es/jaxiT3/Tabla.htm?t=29005",
        publicada: "2025-12-11",
        referencia: "2025-01-01",
      });
      assert.deepStrictEqual(cache, ["lineas_limite_gml-2026-08-10.zip"]);
    }),
  );

  it.effect("con el ZIP de la misma fecha en la caché no lo vuelve a pedir", () =>
    Effect.gen(function* () {
      const { fallo, rutas } = yield* descargar({}, 2);
      assert.isUndefined(fallo);
      assert.strictEqual(rutas.filter((r) => r === ZIP).length, 1);
      assert.lengthOf(rutas, 7 + 5);
    }),
  );

  it.effect("si el canal ya no dice CC BY 4.0, para antes de pedir el ZIP y no escribe nada", () =>
    Effect.gen(function* () {
      const salida = yield* descargar({ canal: canalDePrueba("Todos los derechos reservados") });
      assert.strictEqual(salida.fallo, "FuenteDeMunicipiosCambiada");
      assert.deepStrictEqual(salida.rutas, ["/robots.txt", CANAL]);
      assert.strictEqual(salida.municipios, "");
      assert.strictEqual(salida.padron, "");
    }),
  );

  it.effect("si el aviso legal del INE ya no dice CC BY 4.0, no pide el padrón", () =>
    Effect.gen(function* () {
      const salida = yield* descargar({ aviso: "<p>Todos los derechos reservados</p>" });
      assert.strictEqual(salida.fallo, "FuenteDeMunicipiosCambiada");
      assert.notInclude(salida.rutas, CSV);
      assert.strictEqual(salida.municipios, "");
    }),
  );

  it.effect("respeta el robots.txt del INE", () =>
    Effect.gen(function* () {
      const salida = yield* descargar({
        robotsIne: { estado: 200, cuerpo: "User-agent: *\nDisallow: /jaxiT3/\n" },
      });
      assert.strictEqual(salida.fallo, "ProhibidoPorRobots");
      assert.notInclude(salida.rutas, CSV);
      assert.strictEqual(salida.padron, "");
    }),
  );

  it.effect("si un municipio de los límites no está en el padrón, falla sin escribir nada", () =>
    Effect.gen(function* () {
      const sinB = CSV_DE_PRUEBA.split("\r\n")
        .filter((fila) => !fila.startsWith("08002"))
        .join("\r\n");
      const salida = yield* descargar({ csv: sinB });
      assert.strictEqual(salida.fallo, "MunicipiosIlegibles");
      assert.strictEqual(salida.municipios, "");
      assert.strictEqual(salida.padron, "");
    }),
  );
});
