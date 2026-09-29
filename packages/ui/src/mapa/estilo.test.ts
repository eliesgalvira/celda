import { assert, describe, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";
import type { StyleSpecification } from "maplibre-gl";

import { tokensDelTema } from "../pruebas/tema.ts";
import { leerOklch } from "./color.ts";
import {
  estiloMapa,
  filtroDeRotulosDeMunicipios,
  FUENTE_MAPA_BASE,
  RECURSOS_INICIALES_MAPA_BASE,
  ROTULOS_DE_MUNICIPIOS,
  TOKENS_MAPA,
} from "./estilo.ts";

const MARCA = "token:";

/**
 * Los valores de todas las propiedades de color (`*-color`) de las capas del estilo. De una
 * expresión `step`, el color de cada tramo: las posiciones pares desde la segunda.
 */
const coloresDelEstilo = (estilo: StyleSpecification) =>
  estilo.layers.flatMap((capa) =>
    Object.entries(capa.paint ?? {})
      .filter(([propiedad]) => propiedad.endsWith("-color"))
      .flatMap(([propiedad, valor]) =>
        (Array.isArray(valor) && valor[0] === "step"
          ? valor.filter((_, i) => i >= 2 && i % 2 === 0)
          : [valor]
        ).map((color) => ({ capa: capa.id, propiedad, valor: color })),
      ),
  );

describe("estiloMapa", () => {
  it("pinta el mapa solo con tokens del tema", () => {
    const pedidos = new Set<string>();
    const estilo = estiloMapa((token) => {
      pedidos.add(token);
      return `${MARCA}${token}`;
    });

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
    const estilo = estiloMapa(() => "#000");
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

  it("los rótulos de ciudades y pueblos dejan fuera, sin mirar mayúsculas, los que lleva Celda", () => {
    const capa = estiloMapa(() => "red").layers.find((c) => c.id === ROTULOS_DE_MUNICIPIOS);
    assert.isDefined(capa);
    assert.deepStrictEqual(
      capa !== undefined && "filter" in capa ? capa.filter : undefined,
      filtroDeRotulosDeMunicipios([]),
    );
    const deMunicipio = ["in", ["get", "class"], ["literal", ["city", "town"]]];
    assert.deepStrictEqual<unknown>(filtroDeRotulosDeMunicipios([]), deMunicipio);
    assert.deepStrictEqual<unknown>(filtroDeRotulosDeMunicipios(["L'Hospitalet de Llobregat"]), [
      "all",
      deMunicipio,
      [
        "!",
        [
          "in",
          ["downcase", ["to-string", ["get", "name"]]],
          ["literal", ["l'hospitalet de llobregat"]],
        ],
      ],
    ]);
  });
});
