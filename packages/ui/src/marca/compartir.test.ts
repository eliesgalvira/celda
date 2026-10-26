import { assert, describe, it } from "@effect/vitest";

import { leerOklch } from "../mapa/color.ts";
import { CONTORNO_DE_ESPANA } from "../mapa/espana.ts";
import tema from "../tema.css?raw";
import { leerTokens } from "../tokens.ts";
import { COMPARTIR } from "./alCompartir.ts";
import {
  coloresAlCompartir,
  type DatosAlCompartir,
  pixelesAlCompartir,
  pngAlCompartir,
} from "./compartir.ts";

const colores = coloresAlCompartir(tema, "oscuro");

const conPuntos = (puntos: ReadonlyArray<readonly [number, number]>): DatosAlCompartir => ({
  contorno: CONTORNO_DE_ESPANA,
  limites: {
    fuente: {
      atribucion: "IGN",
      producto: "prueba",
      licencia: "CC BY 4.0",
      enlace: "",
      fecha: "2026-08-10",
      huella: "",
    },
    toleranciaMetros: 1000,
    unidadesPorGrado: 1000,
    pais: [],
    comunidades: [],
    provincias: [],
  },
  longitud: puntos.map(([longitud]) => longitud),
  latitud: puntos.map(([, latitud]) => latitud),
});

const sinPuntos = pixelesAlCompartir(conPuntos([]), colores);

/** Cuántos píxeles cambia un punto respecto de la imagen sin puntos. */
const pixelesQueCambia = (punto: readonly [number, number]): number => {
  const con = pixelesAlCompartir(conPuntos([punto]), colores);
  let distintos = 0;
  for (let i = 0; i < con.length; i += 4) if (con[i] !== sinPuntos[i]) distintos += 1;
  return distintos;
};

describe("imagen para compartir", () => {
  it("los colores salen de los tokens del tema", () => {
    const punto = leerOklch(leerTokens(tema, "oscuro").get("mapa-punto") ?? "");
    assert.deepStrictEqual(colores.punto, punto);
    assert.notDeepEqual(coloresAlCompartir(tema, "claro").tierra, colores.tierra);
  });

  it("Barcelona y Tenerife salen; Madrid queda bajo la marca, sin punto encima", () => {
    assert.isAbove(pixelesQueCambia([2.17, 41.39]), 0, "Barcelona");
    assert.isAbove(pixelesQueCambia([-16.25, 28.47]), 0, "Santa Cruz de Tenerife");
    assert.strictEqual(pixelesQueCambia([-3.7, 40.42]), 0, "Madrid");
    assert.strictEqual(pixelesQueCambia([-30, 40]), 0, "en el Atlántico, fuera de los encuadres");
  });

  it("es un PNG de 1200 × 630 con paleta y de menos de 300 KB con 40.000 emplazamientos", () => {
    // Puntos repartidos por la península con una secuencia fija, más dispersos que los de verdad.
    let semilla = 1;
    const azar = () => {
      semilla = (semilla * 48_271) % 2_147_483_647;
      return semilla / 2_147_483_647;
    };
    const puntos = Array.from(
      { length: 40_000 },
      () => [-9 + azar() * 12, 36.5 + azar() * 7] as const,
    );
    const png = pngAlCompartir(conPuntos(puntos), colores);
    const vista = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.strictEqual(vista.getUint32(16), COMPARTIR.ancho);
    assert.strictEqual(vista.getUint32(20), COMPARTIR.alto);
    assert.strictEqual(png[25], 3, "tipo de color: con paleta");
    assert.isBelow(png.length, 300_000);
  });
});
