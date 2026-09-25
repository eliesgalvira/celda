import { assert, describe, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";
import type { StyleSpecification } from "maplibre-gl";

import { tokensDelTema } from "../pruebas/tema.ts";
import { leerOklch } from "./color.ts";
import { estiloMapa, TOKENS_MAPA } from "./estilo.ts";

const MARCA = "token:";

/** Los valores de todas las propiedades de color (`*-color`) de las capas del estilo. */
const coloresDelEstilo = (estilo: StyleSpecification) =>
  estilo.layers.flatMap((capa) =>
    Object.entries(capa.paint ?? {})
      .filter(([propiedad]) => propiedad.endsWith("-color"))
      .map(([propiedad, valor]) => ({ capa: capa.id, propiedad, valor })),
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
});
