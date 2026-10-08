import { assert, describe, it } from "@effect/vitest";
import type { AllPaintProperties } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "maplibre-gl";

import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { type Tema, tokensDelTema } from "../pruebas/tema.ts";
import { comoRgb, leerOklch } from "./color.ts";
import { coloresDelTema, estiloMapa, TOKENS_MAPA } from "./estilo.ts";
import { estiloDeReserva } from "./reserva/estilo.ts";
import { pasarDeTema } from "./tema.ts";
import type { ColorDeToken } from "./tokens.ts";

/** Los colores de un tema tal como los lee la web del documento: en `rgb()`. */
const colorDelTema = (tema: Tema): ColorDeToken => {
  const tokens = tokensDelTema(tema);
  return (token) => {
    const rgb = leerOklch(tokens.get(token) ?? "");
    assert.isNotNull(rgb, `--${token} en el tema ${tema}`);
    return rgb === null ? "" : comoRgb(rgb);
  };
};

const CLARO = colorDelTema("claro");
const OSCURO = colorDelTema("oscuro");

type Valor = AllPaintProperties[keyof AllPaintProperties];

/** La pintura de cada capa del estilo, propiedad a propiedad. */
const pinturaDe = (estilo: StyleSpecification) =>
  new Map(
    estilo.layers.map((capa) => [
      capa.id,
      // SAFETY: la pintura de una capa solo lleva propiedades de pintura de MapLibre.
      new Map(Object.entries(capa.paint ?? {}) as Array<[string, Valor]>),
    ]),
  );

/** Un mapa de prueba con la pintura de cada capa del estilo, que guarda lo que se le pone. */
const mapaDePrueba = (estilo: StyleSpecification) => {
  const pintura = pinturaDe(estilo);
  const cambios: Array<string> = [];
  return {
    pintura,
    cambios,
    getLayer: (capa: string) => pintura.get(capa),
    setPaintProperty: <P extends keyof AllPaintProperties>(
      capa: string,
      propiedad: P,
      valor: AllPaintProperties[P],
    ) => {
      cambios.push(`${capa}.${propiedad}`);
      pintura.get(capa)?.set(propiedad, valor);
    },
  };
};

const ESTILOS = {
  principal: (color: ColorDeToken) => estiloMapa(color, CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA),
  reserva: (color: ColorDeToken) => estiloDeReserva(color, CONTORNO_DE_PRUEBA),
};

describe("pasarDeTema", () => {
  for (const [callejero, estilo] of Object.entries(ESTILOS)) {
    it(`deja el mapa ${callejero} pintado como el estilo del otro tema, y de vuelta`, () => {
      const mapa = mapaDePrueba(estilo(CLARO));
      pasarDeTema(mapa, estilo(CLARO), estilo(OSCURO));
      assert.deepStrictEqual(mapa.pintura, pinturaDe(estilo(OSCURO)));
      assert.isAbove(mapa.cambios.length, 0);
      pasarDeTema(mapa, estilo(OSCURO), estilo(CLARO));
      assert.deepStrictEqual(mapa.pintura, pinturaDe(estilo(CLARO)));
    });
  }

  it("solo cambia colores: ni opacidades, ni grosores, ni lo que la web ha cambiado", () => {
    const mapa = mapaDePrueba(ESTILOS.principal(CLARO));
    // La silueta ya fundida, como la deja `levantarSilueta`.
    const silueta = mapa.pintura.get("silueta-espana");
    assert.isDefined(silueta);
    silueta?.set("fill-opacity", 0);
    pasarDeTema(mapa, ESTILOS.principal(CLARO), ESTILOS.principal(OSCURO));
    assert.strictEqual(mapa.pintura.get("silueta-espana")?.get("fill-opacity"), 0);
    for (const cambio of mapa.cambios) {
      assert.match(cambio, /-color$/u, cambio);
    }
  });

  it("con el mismo tema no cambia nada", () => {
    const mapa = mapaDePrueba(ESTILOS.principal(OSCURO));
    pasarDeTema(mapa, ESTILOS.principal(OSCURO), ESTILOS.principal(OSCURO));
    assert.deepStrictEqual(mapa.cambios, []);
  });

  it("se salta las capas que el mapa no tiene", () => {
    const completo = ESTILOS.principal(CLARO);
    const mapa = mapaDePrueba({ ...completo, layers: completo.layers.slice(0, 3) });
    pasarDeTema(mapa, completo, ESTILOS.principal(OSCURO));
    const tocadas = new Set(mapa.cambios.map((cambio) => cambio.split(".")[0]));
    const puestas = new Set(completo.layers.slice(0, 3).map((capa) => capa.id));
    for (const capa of tocadas) assert.isTrue(puestas.has(capa ?? ""), capa);
  });
});

describe("coloresDelTema", () => {
  it("lee todos los tokens del mapa de una vez y no cambia aunque luego cambie el documento", () => {
    const elemento = document.createElement("div");
    document.body.append(elemento);
    const claro = tokensDelTema("claro");
    for (const token of TOKENS_MAPA) {
      elemento.style.setProperty(`--${token}`, claro.get(token) ?? "");
    }
    const leidos = coloresDelTema(elemento);
    elemento.style.setProperty("--mapa-fondo", tokensDelTema("oscuro").get("mapa-fondo") ?? "");
    assert.strictEqual(leidos("mapa-fondo"), CLARO("mapa-fondo"));
    assert.strictEqual(coloresDelTema(elemento)("mapa-fondo"), OSCURO("mapa-fondo"));
    elemento.remove();
  });
});
