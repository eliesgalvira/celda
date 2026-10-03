import { assert, describe, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";
import type { StyleSpecification } from "maplibre-gl";

import { CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { tokensDelTema } from "../pruebas/tema.ts";
import { leerOklch } from "./color.ts";
import {
  estiloMapa,
  FUENTE_MAPA_BASE,
  quitarRotulosDeMunicipios,
  RECURSOS_INICIALES_MAPA_BASE,
  TOKENS_MAPA,
} from "./estilo.ts";
import { CAPAS_DE_LUGARES, type MapaConRotulos, ZOOM_DE_FUERA } from "./rotulos.ts";

const MARCA = "token:";

/**
 * Los valores de todas las propiedades de color (`*-color`) de las capas del estilo. De una
 * expresión `step`, el color de cada tramo: las posiciones pares desde la segunda. De un `match`,
 * el de cada caso: las impares desde la tercera y la última, la de por defecto.
 */
const coloresDelEstilo = (estilo: StyleSpecification) =>
  estilo.layers.flatMap((capa) =>
    Object.entries(capa.paint ?? {})
      .filter(([propiedad]) => propiedad.endsWith("-color"))
      .flatMap(([propiedad, valor]) =>
        (Array.isArray(valor) && valor[0] === "step"
          ? valor.filter((_, i) => i >= 2 && i % 2 === 0)
          : Array.isArray(valor) && valor[0] === "match"
            ? valor.filter((_, i) => (i >= 3 && i % 2 === 1) || i === valor.length - 1)
            : [valor]
        ).map((color) => ({ capa: capa.id, propiedad, valor: color })),
      ),
  );

const estiloDePrueba = () => estiloMapa(() => "#000", CONTORNO_DE_PRUEBA);

/** Un mapa de prueba con las capas del estilo: guarda los filtros como MapLibre. */
const mapaDePrueba = (estilo: StyleSpecification | undefined) => {
  const filtros = new Map(
    (estilo?.layers ?? []).map((capa) => [capa.id, "filter" in capa ? capa.filter : undefined]),
  );
  const cambios: Array<string> = [];
  const mapa: MapaConRotulos = {
    getLayer: (capa) => (filtros.has(capa) ? {} : undefined),
    getFilter: (capa) => structuredClone(filtros.get(capa)),
    setFilter: (capa, filtro) => {
      cambios.push(capa);
      filtros.set(capa, filtro);
    },
  };
  return { mapa, filtros, cambios };
};

describe("estiloMapa", () => {
  it("pinta el mapa solo con tokens del tema", () => {
    const pedidos = new Set<string>();
    const estilo = estiloMapa((token) => {
      pedidos.add(token);
      return `${MARCA}${token}`;
    }, CONTORNO_DE_PRUEBA);

    const colores = coloresDelEstilo(estilo);
    assert.isAbove(colores.length, 0);
    for (const { capa, propiedad, valor } of colores) {
      assert.isTrue(
        Predicate.isString(valor) && valor.startsWith(MARCA),
        `${capa}.${propiedad} no sale de un token: ${String(valor)}`,
      );
    }
    assert.deepStrictEqual([...pedidos].toSorted(), [...TOKENS_MAPA].toSorted());
  });

  it("tiene cada token del mapa en OKLCH en el tema claro y en el oscuro", () => {
    for (const tema of ["claro", "oscuro"] as const) {
      const tokens = tokensDelTema(tema);
      for (const token of TOKENS_MAPA) {
        const valor = tokens.get(token);
        assert.isDefined(valor, `falta --${token} en el tema ${tema}`);
        assert.isNotNull(leerOklch(valor ?? ""), `--${token} no es OKLCH en el tema ${tema}`);
      }
    }
  });

  it("pide por adelantado el TileJSON y los glifos que usa la vista inicial", () => {
    const estilo = estiloDePrueba();
    const fuente = estilo.sources[FUENTE_MAPA_BASE];
    assert.isTrue(
      fuente?.type === "vector" && RECURSOS_INICIALES_MAPA_BASE.includes(fuente.url ?? ""),
    );
    // Los rótulos que se ven lejos, antes del zoom 13: sus glifos no pueden esperar a la tesela.
    const letras = estilo.layers.flatMap((capa) =>
      capa.type === "symbol" && (capa.minzoom ?? 0) < 13 ? (capa.layout?.["text-font"] ?? []) : [],
    );
    assert.isAbove(letras.length, 0);
    for (const letra of letras) {
      const glifos = (estilo.glyphs ?? "")
        .replace("{fontstack}", encodeURIComponent(String(letra)))
        .replace("{range}", "0-255");
      assert.include(RECURSOS_INICIALES_MAPA_BASE, glifos);
    }
  });

  it("rotula los lugares por importancia: la capa más importante, la última, se coloca antes", () => {
    const ids = estiloDePrueba().layers.map((capa) => capa.id);
    assert.deepStrictEqual(ids.slice(-CAPAS_DE_LUGARES.length), CAPAS_DE_LUGARES.toReversed());
    assert.deepStrictEqual(CAPAS_DE_LUGARES, [
      "lugares-capitales",
      "lugares-grandes",
      "lugares-ciudades",
      "lugares-pueblos-grandes",
      "lugares-pueblos",
      "lugares-aldeas",
    ]);
    const desde = new Map(
      estiloDePrueba().layers.map((capa) => [capa.id, capa.minzoom ?? 0] as const),
    );
    assert.deepStrictEqual(
      CAPAS_DE_LUGARES.map((id) => desde.get(id)),
      [4, 4.5, 7, 8, 10, 12],
    );
  });

  it("los rótulos de lugar no salen de fuera de España hasta el zoom 9 y Gibraltar, nunca", () => {
    const soloDeEspana = [
      "all",
      ["!=", ["get", "name"], "Gibraltar"],
      ["any", [">=", ["zoom"], ZOOM_DE_FUERA], ["within", CONTORNO_DE_PRUEBA]],
    ];
    assert.strictEqual(ZOOM_DE_FUERA, 9);
    for (const capa of estiloDePrueba().layers) {
      if (!CAPAS_DE_LUGARES.includes(capa.id)) continue;
      const filtro = "filter" in capa ? capa.filter : undefined;
      assert.deepStrictEqual<unknown>(
        Array.isArray(filtro) ? [filtro[0], filtro[1]?.[0], filtro[1]?.[1]] : undefined,
        ["all", "all", soloDeEspana],
        capa.id,
      );
    }
  });

  it("las capas de lugares dejan fuera, sin mirar mayúsculas, los municipios que lleva Celda", () => {
    const estilo = estiloDePrueba();
    const { mapa, filtros, cambios } = mapaDePrueba(estilo);
    const propios = new Map(
      CAPAS_DE_LUGARES.map((capa) => {
        const filtro = filtros.get(capa);
        return [capa, Array.isArray(filtro) ? filtro[1] : undefined] as const;
      }),
    );
    for (const capa of CAPAS_DE_LUGARES) {
      assert.deepStrictEqual<unknown>(filtros.get(capa), [
        "all",
        propios.get(capa),
        ["literal", true],
      ]);
    }

    quitarRotulosDeMunicipios(mapa, ["L'Hospitalet de Llobregat", "Badalona"]);
    assert.deepStrictEqual(cambios, CAPAS_DE_LUGARES);
    for (const capa of CAPAS_DE_LUGARES) {
      assert.deepStrictEqual<unknown>(filtros.get(capa), [
        "all",
        propios.get(capa),
        [
          "!",
          [
            "in",
            ["downcase", ["to-string", ["get", "name"]]],
            ["literal", ["l'hospitalet de llobregat", "badalona"]],
          ],
        ],
      ]);
    }

    // Sin zonas de municipio a la vista, cada capa vuelve a su filtro de partida.
    quitarRotulosDeMunicipios(mapa, []);
    for (const capa of CAPAS_DE_LUGARES) {
      assert.deepStrictEqual<unknown>(filtros.get(capa), [
        "all",
        propios.get(capa),
        ["literal", true],
      ]);
    }
  });

  it("antes de que el estilo tenga sus capas, quitar rótulos no hace nada", () => {
    const { mapa, cambios } = mapaDePrueba(undefined);
    quitarRotulosDeMunicipios(mapa, ["Badalona"]);
    assert.deepStrictEqual(cambios, []);
  });
});
