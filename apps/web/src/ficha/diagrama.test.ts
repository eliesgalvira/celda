import { terminosDe, textoPlano } from "@celda/dominio/glosario";
import { diagramaSector } from "@celda/sim/diagramaSector";
import { assert, describe, it } from "@effect/vitest";

import {
  lobulosDe,
  MALLA_DIAGRAMA,
  orientacionDe,
  paramsDiagrama,
  RUMBOS_DIAGRAMA,
  textosDiagrama,
} from "./diagrama.ts";

describe("diagrama de radiación del panel", () => {
  it("sin ninguna estimación, la orientación es la supuesta y lo dice", () => {
    const orientacion = orientacionDe([]);
    assert.deepStrictEqual(orientacion, { tipo: "supuesta", azimuts: [0, 120, 240] });
    const textos = textosDiagrama(orientacion);
    assert.deepStrictEqual(textos.leyenda, ["Sector 1 · 0°", "Sector 2 · 120°", "Sector 3 · 240°"]);
    assert.match(
      textoPlano(textos.notas[0] ?? []),
      /^La orientación es supuesta\. Ninguna fuente publica/u,
    );
    assert.include(textoPlano(textos.notas[0] ?? []), "0°, 120° y 240°");
    assert.match(
      textos.descripcion,
      /^Este diagrama se calcula con un modelo de antena típica y muestra 3 sectores con orientación supuesta/u,
    );
    // Una orientación supuesta no lleva margen: no es una estimación.
    assert.notInclude(textos.leyenda.join(" "), "±");
  });

  it("con azimuts estimados, cada uno lleva su margen de ±15°", () => {
    const textos = textosDiagrama(orientacionDe([40, 160, 280]));
    assert.deepStrictEqual(textos.leyenda, [
      "Sector 1 · 40° ±15°",
      "Sector 2 · 160° ±15°",
      "Sector 3 · 280° ±15°",
    ]);
    assert.strictEqual(
      textoPlano(textos.notas[0] ?? []),
      "La orientación es una estimación, con ±15° de margen.",
    );
    assert.include(textos.descripcion, "orientación estimada a 40°, 160° y 280°, ±15°");
  });

  it("dice que es un modelo sin dar su identificador interno", () => {
    const textos = textosDiagrama(orientacionDe([]));
    assert.notProperty(textos, "modelo");
    assert.notMatch(
      [textos.titulo, textos.descripcion, ...textos.notas.map(textoPlano)].join(" "),
      /diagrama-sector|\bv\d/u,
    );
    assert.include(textoPlano(textos.notas.at(-1) ?? []), "haz de 65°");
    // La orientación, los sectores y el modelo se subrayan una vez entre todas las notas.
    assert.deepStrictEqual(terminosDe(textos.notas), ["azimut", "sector", "modelo"]);
  });

  it("cada lóbulo lleva la ganancia de su sector en cada rumbo del diagrama", () => {
    const orientacion = orientacionDe([]);
    const resultado = diagramaSector.ejecutar(paramsDiagrama(orientacion), MALLA_DIAGRAMA);
    const lobulos = lobulosDe(orientacion, resultado);
    assert.lengthOf(lobulos, 3);
    for (const [k, lobulo] of lobulos.entries()) {
      assert.strictEqual(lobulo.ganancia.length, RUMBOS_DIAGRAMA.length);
      // En su propio eje, 0 dB.
      const eje = RUMBOS_DIAGRAMA.indexOf(orientacion.azimuts[k] ?? -1);
      assert.closeTo(lobulo.ganancia[eje] ?? Number.NaN, 0, 1e-9);
    }
  });
});
