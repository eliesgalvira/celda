import { assert, describe, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";
import type {
  DataDrivenPropertyValueSpecification,
  LayerSpecification,
  LineLayerSpecification,
} from "maplibre-gl";

import { CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { conLaFoto } from "../pruebas/foto.ts";
import { estiloMapa, FUENTE_MAPA_BASE } from "./estilo.ts";
import { capasLimites, FUENTE_LIMITES, lineasDeLimites } from "./limites.ts";
import { capasSuelo } from "./suelo.ts";
import { capasVias, valorEnZoom } from "./vias.ts";

const capas = capasLimites("fuente", (token) => token);
const capa = (id: string): LayerSpecification => {
  const encontrada = capas.find((c) => c.id === id);
  if (encontrada === undefined) throw new Error(`Falta la capa ${id}`);
  return encontrada;
};
const linea = (id: string): LineLayerSpecification => {
  const encontrada = capa(id);
  if (encontrada.type !== "line") throw new Error(`${id} no es una capa de línea`);
  return encontrada;
};

/** El valor de una propiedad en `zoom`: un número fijo o una interpolación lineal por zoom. */
const enZoom = (
  valor: DataDrivenPropertyValueSpecification<number> | undefined,
  zoom: number,
  porDefecto: number,
): number => {
  if (valor === undefined) return porDefecto;
  if (!Array.isArray(valor)) return Predicate.isNumber(valor) ? valor : Number.NaN;
  assert.deepStrictEqual(valor.slice(0, 3), ["interpolate", ["linear"], ["zoom"]]);
  return valorEnZoom(valor.slice(3).map(Number), zoom, 1);
};

/** La opacidad de una capa en `zoom`, con la foto aérea apagada o encendida. */
const opacidad = (id: string, zoom: number, foto = false) =>
  enZoom(conLaFoto(linea(id).paint?.["line-opacity"], foto), zoom, 1);
const grosor = (id: string, zoom: number) => enZoom(linea(id).paint?.["line-width"], zoom, 1);

/** Si una capa de límites se ve en `zoom`: dentro de sus zooms y con opacidad. */
const seVe = (id: string, zoom: number): boolean =>
  zoom >= (capa(id).minzoom ?? 0) && opacidad(id, zoom) > 0;

describe("límites en el mapa", () => {
  it("pasa el fichero a líneas en grados, cada una con su tipo", () => {
    const lineas = lineasDeLimites({
      fuente: {
        atribucion: "Instituto Geográfico Nacional",
        producto: "Base de Datos de Límites Jurisdiccionales de España",
        licencia: "CC BY 4.0",
        enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
        fecha: "2026-08-10",
        huella: "sha256:0",
      },
      toleranciaMetros: 1000,
      unidadesPorGrado: 1000,
      comunidades: [[-1500, 40000, 250, -1000]],
      provincias: [
        [2040, 41000, 0, 10, 5, 10],
        [2060, 41020, 0, -20],
      ],
    });
    assert.deepStrictEqual(lineas, {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { limite: "provincia" },
          geometry: {
            type: "LineString",
            coordinates: [
              [2.04, 41],
              [2.04, 41.01],
              [2.045, 41.02],
            ],
          },
        },
        {
          type: "Feature",
          properties: { limite: "provincia" },
          geometry: {
            type: "LineString",
            coordinates: [
              [2.06, 41.02],
              [2.06, 41],
            ],
          },
        },
        {
          type: "Feature",
          properties: { limite: "comunidad" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-1.5, 40],
              [-1.25, 39],
            ],
          },
        },
      ],
    });
  });

  it("las comunidades van más gruesas y continuas; las provincias, más finas y discontinuas", () => {
    assert.strictEqual(linea("limites-comunidades").source, FUENTE_LIMITES);
    assert.strictEqual(linea("limites-provincias").source, FUENTE_LIMITES);
    assert.isUndefined(linea("limites-comunidades").paint?.["line-dasharray"]);
    assert.isDefined(linea("limites-provincias").paint?.["line-dasharray"]);
    for (let zoom = 4; zoom <= 18; zoom += 0.5) {
      assert.isAbove(
        grosor("limites-comunidades", zoom),
        grosor("limites-provincias", zoom),
        `zoom ${zoom}`,
      );
    }
  });

  it("comunidades y provincias, enteras hasta el zoom 11,5 y al 60 % desde el 12,5", () => {
    for (const id of ["limites-comunidades", "limites-provincias"]) {
      assert.strictEqual(opacidad(id, 4), 1, id);
      assert.strictEqual(opacidad(id, 11.5), 1, id);
      assert.closeTo(opacidad(id, 12.5), 0.6, 1e-9, id);
      assert.closeTo(opacidad(id, 18), 0.6, 1e-9, id);
    }
  });

  it("los municipios y el país salen del mapa base, sin las líneas del mar", () => {
    const municipios = linea("limites-municipios");
    const pais = linea("limites-pais");
    for (const c of [municipios, pais]) {
      assert.strictEqual(c.source, "fuente");
      assert.strictEqual(c["source-layer"], "boundary");
      assert.deepInclude<unknown>(c.filter, ["!=", ["get", "maritime"], 1]);
    }
    assert.deepInclude<unknown>(municipios.filter, ["==", ["get", "admin_level"], 8]);
    assert.deepInclude<unknown>(pais.filter, ["==", ["get", "admin_level"], 2]);
    // Los municipios entran del zoom 10,5 al 11,2.
    assert.isFalse(seVe("limites-municipios", 10.4));
    assert.strictEqual(opacidad("limites-municipios", 10.5), 0);
    assert.strictEqual(opacidad("limites-municipios", 11.2), 1);
  });

  it("con la foto aérea van todos en blanco; sin ella, con sus tokens", () => {
    for (const [id, token] of [
      ["limites-municipios", "mapa-limite-municipio"],
      ["limites-provincias", "mapa-limite-provincia"],
      ["limites-comunidades", "mapa-limite-comunidad"],
      ["limites-pais", "mapa-limite-pais"],
    ] as const) {
      const color = linea(id).paint?.["line-color"];
      assert.strictEqual(conLaFoto(color, true), "mapa-foto-linea", id);
      assert.strictEqual(conLaFoto(color, false), token, id);
    }
    assert.closeTo(opacidad("limites-comunidades", 9, true), 0.95, 1e-9);
    assert.closeTo(opacidad("limites-comunidades", 13, true), 0.7, 1e-9);
    assert.closeTo(opacidad("limites-provincias", 9, true), 0.8, 1e-9);
    assert.closeTo(opacidad("limites-provincias", 13, true), 0.55, 1e-9);
    assert.closeTo(opacidad("limites-municipios", 12, true), 0.7, 1e-9);
    assert.strictEqual(opacidad("limites-pais", 6, true), 1);
    assert.strictEqual(opacidad("limites-pais", 6), 1);
  });

  it("del zoom 5 al 14 siempre se ve algún límite de dentro de España", () => {
    for (let zoom = 5; zoom <= 14; zoom += 0.1) {
      assert.isTrue(
        ["limites-provincias", "limites-comunidades", "limites-municipios"].some((id) =>
          seVe(id, zoom),
        ),
        `zoom ${zoom.toFixed(1)}`,
      );
    }
  });

  it("el estilo los pone entre el suelo y las vías, con la fuente propia vacía", () => {
    const estilo = estiloMapa(() => "#000", CONTORNO_DE_PRUEBA);
    assert.deepStrictEqual<unknown>(estilo.sources[FUENTE_LIMITES], {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const ids = estilo.layers.map((c) => c.id);
    const desde = ids.indexOf("limites-municipios");
    const suelo = capasSuelo(FUENTE_MAPA_BASE, () => "#000").map((c) => c.id);
    const vias = capasVias(FUENTE_MAPA_BASE, () => "#000").map((c) => c.id);
    assert.deepStrictEqual(
      ids.slice(desde, desde + capas.length),
      capas.map((c) => c.id),
    );
    for (const id of suelo) assert.isBelow(ids.indexOf(id), desde, id);
    assert.strictEqual(ids[desde + capas.length], vias[0]);
  });
});
