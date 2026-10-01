import type { Compania } from "@celda/dominio/compania";
import { assert, describe, it } from "@effect/vitest";

import type { Elemento, ElementoBarrio, ElementoMunicipio } from "./agrupacion.ts";
import { formasDeEtiquetas } from "./etiquetas.ts";
import { nombreDeBarrio, nombreDeMunicipio } from "./marcadores.ts";

/** Un barrio cuya etiqueta cae en el píxel (x, 100) de una proyección de prueba. */
const barrio = (
  codigo: string,
  x: number,
  emplazamientos: number,
  ausentes: ReadonlyArray<Compania> = [],
): ElementoBarrio => ({
  tipo: "barrio",
  clave: `b:${codigo}`,
  posicion: { longitud: x, latitud: 0 },
  resumen: {
    barrio: { codigo, nombre: `Barrio ${codigo}`, etiqueta: { longitud: x, latitud: 0 } },
    emplazamientos,
    ausentes,
  },
});

const proyectar = (e: Elemento) => ({ x: e.posicion.longitud, y: 100 });
const formasDeBarrios = (barrios: ReadonlyArray<ElementoBarrio>) =>
  formasDeEtiquetas(barrios, proyectar);

describe("forma de las zonas de barrio", () => {
  it("las que caben sin pisarse van completas", () => {
    const formas = formasDeBarrios([barrio("01", 0, 5), barrio("02", 400, 3)]);
    assert.deepStrictEqual(
      [...formas],
      [
        ["b:01", "completa"],
        ["b:02", "completa"],
      ],
    );
  });

  it("si dos se pisan, la del barrio con más emplazamientos va completa y la otra, compacta", () => {
    const formas = formasDeBarrios([
      barrio("01", 0, 5),
      barrio("02", 60, 30, ["digi"]),
      barrio("03", 120, 1),
    ]);
    assert.strictEqual(formas.get("b:02"), "completa");
    assert.strictEqual(formas.get("b:01"), "compacta");
    assert.strictEqual(formas.get("b:03"), "compacta");
  });

  it("ningún barrio se queda sin dibujar, aunque su forma compacta pise otra", () => {
    const encima = [barrio("01", 0, 5), barrio("02", 1, 5), barrio("03", 2, 5)];
    const formas = formasDeBarrios(encima);
    assert.strictEqual(formas.size, 3);
    // A igualdad de emplazamientos, manda el código: la forma no baila de una vez a otra.
    assert.strictEqual(formas.get("b:01"), "completa");
    assert.deepStrictEqual(formasDeBarrios(encima.toReversed()), formas);
  });

  it("el nombre no tapa una agrupación ni un emplazamiento: si los pisaría, va compacta", () => {
    const debajo: Elemento = {
      tipo: "agrupacion",
      clave: "a:1",
      posicion: { longitud: 0, latitud: 0 },
      cuantos: 4,
    };
    // La agrupación cae 60 px por debajo del centro del barrio, donde va su nombre.
    const formas = formasDeEtiquetas([barrio("01", 0, 5), debajo], (e) =>
      e.tipo === "agrupacion" ? { x: 0, y: 160 } : proyectar(e),
    );
    assert.strictEqual(formas.get("b:01"), "compacta");
    assert.isFalse(formas.has("a:1"));
    // Lejos, cabe entera.
    const lejos = formasDeEtiquetas([barrio("01", 0, 5), debajo], (e) =>
      e.tipo === "agrupacion" ? { x: 300, y: 100 } : proyectar(e),
    );
    assert.strictEqual(lejos.get("b:01"), "completa");
  });
});

describe("nombre accesible de un barrio", () => {
  it("dice lo que se ve en la etiqueta y qué hace al pulsarla", () => {
    assert.strictEqual(
      nombreDeBarrio(barrio("07", 0, 94, ["digi"]).resumen),
      "Barrio 07, 94 emplazamientos, sin Digi, acercar",
    );
    assert.strictEqual(
      nombreDeBarrio(barrio("18", 0, 19).resumen),
      "Barrio 18, 19 emplazamientos, acercar",
    );
    assert.strictEqual(
      nombreDeBarrio(barrio("56", 0, 0, ["movistar", "vodafone"]).resumen),
      "Barrio 56, ningún emplazamiento, sin Movistar ni Vodafone, acercar",
    );
  });
});

/** Un municipio cuya etiqueta cae en el píxel (x, 100) de una proyección de prueba. */
const municipio = (
  codigo: string,
  nombre: string,
  x: number,
  emplazamientos: number,
  ausentes: ReadonlyArray<Compania> = [],
): ElementoMunicipio => ({
  tipo: "municipio",
  clave: `m:${codigo}`,
  posicion: { longitud: x, latitud: 0 },
  resumen: {
    municipio: {
      codigo,
      nombre,
      etiqueta: { longitud: x, latitud: 0 },
      habitantes: 1000,
      areaKm2: 10,
      emplazamientos,
      companias: [],
    },
    emplazamientos,
    ausentes,
    caja: undefined,
  },
});

describe("forma de las zonas de municipio", () => {
  it("se reparten como las de barrio: la de más emplazamientos va completa", () => {
    const formas = formasDeEtiquetas(
      [municipio("08279", "Terrassa", 0, 118, ["digi"]), municipio("08184", "Rubí", 60, 40)],
      proyectar,
    );
    assert.strictEqual(formas.get("m:08279"), "completa");
    assert.strictEqual(formas.get("m:08184"), "compacta");
  });
});

describe("nombre accesible de un municipio", () => {
  it("dice lo que se ve en la etiqueta: con 10 emplazamientos o más, sus ausencias", () => {
    assert.strictEqual(
      nombreDeMunicipio(municipio("08279", "Terrassa", 0, 118, ["digi"]).resumen),
      "Terrassa, 118 emplazamientos, sin Digi, acercar",
    );
    assert.strictEqual(
      nombreDeMunicipio(municipio("08014", "Aiguafreda", 0, 3).resumen),
      "Aiguafreda, 3 emplazamientos, acercar",
    );
    assert.strictEqual(
      nombreDeMunicipio(municipio("08056", "Castellcir", 0, 0).resumen),
      "Castellcir, ningún emplazamiento, acercar",
    );
  });
});
