import { assert, describe, it } from "@effect/vitest";
import type { LayerSpecification } from "maplibre-gl";

import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { conLaFoto } from "../pruebas/foto.ts";
import { estiloMapa } from "./estilo.ts";
import { FOTO_AEREA } from "./expresiones.ts";
import {
  CAPA_FOTO,
  type EstadoConFoto,
  FUENTE_EDIFICIO,
  FUENTE_FOTO,
  dejarDePrepararFoto,
  ponerFotoAerea,
  prepararFotoAerea,
} from "./foto.ts";
import { CAPA_PORTALES } from "./rotulos.ts";

const estilo = estiloMapa((token) => `token:${token}`, CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA);
const ids = estilo.layers.map((capa) => capa.id);
const capa = (id: string): LayerSpecification | undefined => estilo.layers.find((c) => c.id === id);
const visibilidad = (id: string, encendida: boolean) =>
  conLaFoto(capa(id)?.layout?.visibility ?? "visible", encendida);
const pintura = (id: string, propiedad: string, encendida: boolean) =>
  conLaFoto(
    Object.entries(capa(id)?.paint ?? {}).find(([nombre]) => nombre === propiedad)?.[1],
    encendida,
  );

/** Las capas de rótulos del mapa base que se ven con la foto apagada. */
const ROTULOS = estilo.layers.filter(
  (c) =>
    c.type === "symbol" && "source" in c && c.source === "openmaptiles" && c.id !== CAPA_PORTALES,
);

describe("foto aérea en el estilo", () => {
  it("es la ortofoto PNOA del IGN por su TMS, en teselas de 256 hasta el zoom 19", () => {
    assert.deepStrictEqual(estilo.sources[FUENTE_FOTO], {
      type: "raster",
      tiles: ["https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg"],
      scheme: "tms",
      tileSize: 256,
      maxzoom: 19,
      bounds: [-18.4, 27.5, 4.5, 44],
    });
  });

  it("va apagada al abrir: el estado empieza en falso y su capa, escondida, no pide nada", () => {
    assert.deepStrictEqual<unknown>(estilo.state?.[FOTO_AEREA], { default: false });
    // La pone `ponerFotoAerea`, no el estado: así MapLibre no vacía su caché de teselas (#67).
    assert.strictEqual(capa(CAPA_FOTO)?.layout?.visibility, "none");
    // Tapa la tierra; el agua va encima, porque el mar del PNOA es casi negro.
    assert.isAbove(ids.indexOf(CAPA_FOTO), ids.indexOf("espacios-naturales"));
    assert.isBelow(ids.indexOf(CAPA_FOTO), ids.indexOf("agua"));
    assert.strictEqual(pintura("edificios", "fill-opacity", true)?.toString().endsWith("0"), true);
  });

  it("encendida, las vías son líneas finas y claras, sin borde, y las autopistas amarillas", () => {
    const deVias = ids.filter((id) => /^vias-(borde-)?[a-z]+$/u.test(id) && id !== "vias-foto");
    assert.isAbove(deVias.length, 10);
    for (const id of deVias) {
      assert.strictEqual(visibilidad(id, false), "visible", id);
      assert.strictEqual(visibilidad(id, true), "none", id);
    }
    assert.strictEqual(visibilidad("vias-foto", false), "none");
    assert.strictEqual(visibilidad("vias-foto", true), "visible");
    const colores = JSON.stringify(pintura("vias-foto", "line-color", true));
    assert.include(colores, "token:mapa-foto-linea");
    assert.include(colores, "token:mapa-foto-autopista");
  });

  it("encendida, los rótulos van en blanco con halo oscuro; apagada, como siempre", () => {
    assert.isAbove(ROTULOS.length, 10);
    for (const rotulo of ROTULOS) {
      if (rotulo.id === "numeros-de-carreteras") continue;
      assert.strictEqual(
        pintura(rotulo.id, "text-color", true),
        "token:mapa-foto-rotulo",
        rotulo.id,
      );
      assert.strictEqual(pintura(rotulo.id, "text-halo-color", true), "token:mapa-foto-halo");
      assert.notInclude(JSON.stringify(pintura(rotulo.id, "text-color", false)), "mapa-foto");
      assert.strictEqual(pintura(rotulo.id, "text-halo-color", false), "token:mapa-halo");
    }
    assert.strictEqual(
      pintura("numeros-de-carreteras", "text-halo-color", true),
      "token:mapa-foto-autopista",
    );
  });

  it("los números de portal solo salen con la foto, y por debajo del zoom 15 no se maquetan", () => {
    // Se quitan con el filtro y la capa sigue visible: así MapLibre deja los portales en las
    // teselas que parte, también en las pedidas con la foto apagada, y «Ver el edificio» los lee.
    const portales = capa(CAPA_PORTALES);
    const filtro = portales !== undefined && "filter" in portales ? portales.filter : undefined;
    assert.strictEqual(visibilidad(CAPA_PORTALES, false), "visible");
    assert.isFalse(conLaFoto(filtro, false));
    assert.isTrue(conLaFoto(filtro, true));
    assert.strictEqual(portales?.minzoom, 15);
  });

  it("el edificio resaltado tiene su fuente vacía y va encima de la zona y bajo los rótulos", () => {
    assert.deepStrictEqual(estilo.sources[FUENTE_EDIFICIO], {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const edificio = ids.indexOf("edificio-contorno");
    assert.isAbove(edificio, ids.indexOf("zona-vecinas"));
    assert.isBelow(edificio, ids.indexOf("nombres-de-calles"));
    // El número, justo encima de los portales: se coloca antes y tapa el mismo número de debajo.
    assert.strictEqual(ids.indexOf("edificio-numero"), ids.indexOf(CAPA_PORTALES) + 1);
  });

  it("preparada, la foto pide sus teselas transparente y el estado sigue apagado", () => {
    const estado: EstadoConFoto = {};
    const llamadas: Array<readonly [string, string | boolean]> = [];
    const mapa = {
      getGlobalState: () => estado,
      setGlobalStateProperty: (nombre: string, valor: boolean) => {
        if (nombre === FOTO_AEREA) estado[FOTO_AEREA] = valor;
        llamadas.push([nombre, valor]);
      },
      setLayoutProperty: (capa: string, propiedad: string, valor: string) => {
        llamadas.push([`${capa}.${propiedad}`, valor]);
      },
      setPaintProperty: (capa: string, propiedad: string, valor: number) => {
        llamadas.push([`${capa}.${propiedad}`, String(valor)]);
      },
    };
    prepararFotoAerea(mapa);
    dejarDePrepararFoto(mapa);
    prepararFotoAerea(mapa);
    ponerFotoAerea(mapa, true);
    // Ya enseñada, ni prepararla ni dejar de prepararla la tocan.
    prepararFotoAerea(mapa);
    dejarDePrepararFoto(mapa);
    assert.deepStrictEqual(llamadas, [
      [`${CAPA_FOTO}.raster-opacity`, "0"],
      [`${CAPA_FOTO}.visibility`, "visible"],
      [`${CAPA_FOTO}.visibility`, "none"],
      [`${CAPA_FOTO}.raster-opacity`, "0"],
      [`${CAPA_FOTO}.visibility`, "visible"],
      [FOTO_AEREA, true],
      [`${CAPA_FOTO}.visibility`, "visible"],
      [`${CAPA_FOTO}.raster-opacity`, "1"],
    ]);
  });

  it("encender y apagar cambia el estado del estilo y la capa de la foto, y solo si cambia", () => {
    const estado: EstadoConFoto = {};
    const llamadas: Array<readonly [string, string | boolean]> = [];
    const mapa = {
      getGlobalState: () => estado,
      setGlobalStateProperty: (nombre: string, valor: boolean) => {
        if (nombre === FOTO_AEREA) estado[FOTO_AEREA] = valor;
        llamadas.push([nombre, valor]);
      },
      setLayoutProperty: (capa: string, propiedad: string, valor: string) => {
        llamadas.push([`${capa}.${propiedad}`, valor]);
      },
      setPaintProperty: (capa: string, propiedad: string, valor: number) => {
        llamadas.push([`${capa}.${propiedad}`, String(valor)]);
      },
    };
    ponerFotoAerea(mapa, false);
    ponerFotoAerea(mapa, true);
    ponerFotoAerea(mapa, true);
    ponerFotoAerea(mapa, false);
    assert.deepStrictEqual(llamadas, [
      [FOTO_AEREA, true],
      [`${CAPA_FOTO}.visibility`, "visible"],
      [`${CAPA_FOTO}.raster-opacity`, "1"],
      [FOTO_AEREA, false],
      [`${CAPA_FOTO}.visibility`, "none"],
    ]);
  });
});
