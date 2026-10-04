import type { Compania } from "@celda/dominio/compania";
import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";
import { flush } from "solid-js";

import { leerOklch } from "../mapa/color.ts";
import { tokensDelTema } from "../pruebas/tema.ts";
import { idDeLogo, LogoCompanias, SimbolosDeLogos } from "./LogoCompanias.tsx";
import { DIBUJOS_DE_COMPANIAS } from "./logosDeCompanias.ts";
import digi from "./logos/digi.svg?raw";
import movistar from "./logos/movistar.svg?raw";
import orange from "./logos/orange.svg?raw";
import vodafone from "./logos/vodafone.svg?raw";

/** Los ficheros oficiales de `logos/`, de las compañías que enseñan su logo. */
const FICHEROS: Readonly<Partial<Record<Compania, string>>> = { movistar, vodafone, orange, digi };

/** El color de la compañía en su fichero oficial (el del isotipo, el círculo o el cuadrado). */
const COLOR_OFICIAL: Readonly<Partial<Record<Compania, string>>> = {
  movistar: "#06f",
  vodafone: "#e60000",
  orange: "#ff7900",
  digi: "#002bff",
};

const COMPANIAS: ReadonlyArray<Compania> = ["movistar", "vodafone", "orange", "digi", "yoigo"];

/** Los trazos `d` de los `<path>` de un fichero SVG. */
const trazosDelFichero = (svg: string): ReadonlyArray<string> =>
  Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/gu), (encontrado) => encontrado[1] ?? "");

const canal = (hex: string, i: number): number => {
  const largo = hex.length === 4 ? 1 : 2;
  const trozo = hex.slice(1 + i * largo, 1 + (i + 1) * largo);
  return Number.parseInt(largo === 1 ? trozo + trozo : trozo, 16) / 255;
};

const montar = (companias: ReadonlyArray<Compania>) => {
  const { container } = render(() => <LogoCompanias companias={companias} tamano={34} />);
  flush();
  const svg = container.querySelector("svg");
  assert.isNotNull(svg);
  return svg;
};

/** Las clases de relleno de los trazos de un logo oficial, en orden. */
const clasesDeTrazos = (logo: Element) =>
  Array.from(logo.querySelectorAll("path"), (path) => path.getAttribute("class"));

describe("logos de las compañías", () => {
  it("cada trazo está tal cual en el fichero oficial de su compañía", () => {
    for (const compania of COMPANIAS) {
      const dibujo = DIBUJOS_DE_COMPANIAS[compania];
      const fichero = FICHEROS[compania];
      if (dibujo.tipo === "nombre") {
        assert.isUndefined(fichero, `${compania} no tiene logo y no lleva fichero`);
        continue;
      }
      assert.isDefined(fichero, compania);
      const trazos = trazosDelFichero(fichero ?? "");
      for (const trazo of dibujo.trazos) {
        assert.isTrue(
          trazos.some((delFichero) => delFichero.includes(trazo.d)),
          `${compania}: un trazo no sale de logos/${compania}.svg`,
        );
      }
    }
  });

  it("Yoigo va con su nombre: sus condiciones no dejan enseñar su logo", () => {
    assert.deepStrictEqual(DIBUJOS_DE_COMPANIAS.yoigo, { tipo: "nombre", texto: "yoigo" });
  });

  it("el color de cada compañía es el de su fichero oficial, y el tema oscuro no lo cambia", () => {
    const claro = tokensDelTema("claro");
    const oscuro = tokensDelTema("oscuro");
    for (const [compania, hex] of Object.entries(COLOR_OFICIAL)) {
      const color = leerOklch(claro.get(`compania-${compania}`) ?? "");
      assert.isNotNull(color, compania);
      const canales = [color?.r ?? -1, color?.g ?? -1, color?.b ?? -1];
      canales.forEach((valor, i) => {
        assert.closeTo(valor, canal(hex, i), 1 / 255, compania);
      });
    }
    for (const compania of COMPANIAS) {
      assert.isFalse(oscuro.has(`compania-${compania}`), compania);
    }
  });

  it("Movistar: la M en blanco sobre un círculo de su azul", () => {
    const svg = montar(["movistar"]);
    assert.strictEqual(svg.querySelector("circle")?.getAttribute("class"), "fill-movistar");
    const logo = svg.querySelector("svg");
    assert.isNotNull(logo);
    assert.strictEqual(logo?.getAttribute("viewBox"), "0 0 72 72");
    assert.deepStrictEqual(clasesDeTrazos(logo ?? svg), ["fill-compania-tinta"]);
  });

  it("Orange: su cuadrado naranja con la barra blanca, sobre blanco", () => {
    const svg = montar(["orange"]);
    assert.strictEqual(svg.querySelector("circle")?.getAttribute("class"), "fill-compania-tinta");
    const logo = svg.querySelector("svg");
    assert.deepStrictEqual(clasesDeTrazos(logo ?? svg), ["fill-orange", "fill-compania-tinta"]);
    // Cuadrado: tan alto como ancho.
    assert.strictEqual(logo?.getAttribute("width"), logo?.getAttribute("height"));
  });

  it("Yoigo: su nombre en blanco sobre su color, sin logo", () => {
    const svg = montar(["yoigo"]);
    assert.strictEqual(svg.querySelector("circle")?.getAttribute("class"), "fill-yoigo");
    assert.isNull(svg.querySelector("svg"));
    assert.strictEqual(svg.querySelector("text")?.textContent, "yoigo");
  });

  it("compartido: una porción por compañía, en su orden, cada una con su logo", () => {
    const svg = montar(["movistar", "orange", "vodafone"]);
    const porciones = Array.from(svg.children).filter(
      (hijo) => hijo.tagName === "path" && hijo.getAttribute("d")?.startsWith("M20,20") === true,
    );
    assert.deepStrictEqual(
      porciones.map((porcion) => porcion.getAttribute("class")),
      ["fill-movistar", "fill-compania-tinta", "fill-vodafone"],
    );
    const logos = Array.from(svg.querySelectorAll("g > svg"), (logo) =>
      Array.from(logo.querySelectorAll("path"), (path) => path.getAttribute("d")),
    );
    const trazos = (compania: Compania) => {
      const dibujo = DIBUJOS_DE_COMPANIAS[compania];
      return dibujo.tipo === "logo" ? dibujo.trazos.map((trazo) => trazo.d) : [];
    };
    assert.deepStrictEqual(logos, [trazos("movistar"), trazos("orange"), trazos("vodafone")]);
    assert.lengthOf(svg.querySelectorAll("line"), 3, "un radio blanco entre cada dos porciones");
  });

  it("compartido con Yoigo: su porción lleva su nombre", () => {
    const svg = montar(["vodafone", "yoigo"]);
    assert.lengthOf(svg.querySelectorAll("g > svg"), 1);
    assert.strictEqual(svg.querySelector("g > text")?.textContent, "yoigo");
  });

  it("los símbolos: uno por combinación, con el identificador que usa cada marcador", () => {
    const combinaciones: ReadonlyArray<ReadonlyArray<Compania>> = [
      ["movistar"],
      ["movistar", "digi"],
      ["vodafone", "orange", "yoigo"],
    ];
    const { container } = render(() => (
      <SimbolosDeLogos logos={combinaciones.map((companias) => ({ companias }))} />
    ));
    flush();
    assert.deepStrictEqual(
      Array.from(container.querySelectorAll("symbol"), (simbolo) => simbolo.id),
      ["celda-logo-movistar", "celda-logo-movistar-digi", "celda-logo-vodafone-orange-yoigo"],
    );
    assert.strictEqual(idDeLogo([]), "celda-logo-ninguna");
  });

  it("con un filtro, el compartido apaga las porciones de las compañías que no están en él", () => {
    const { container } = render(() => (
      <SimbolosDeLogos
        logos={[
          { companias: ["movistar", "vodafone"], resaltadas: ["vodafone"] },
          { companias: ["movistar", "vodafone"], resaltadas: ["movistar", "vodafone"] },
          { companias: ["digi"], resaltadas: ["digi"] },
        ]}
      />
    ));
    flush();
    const simbolos = Array.from(container.querySelectorAll("symbol"));
    assert.deepStrictEqual(
      simbolos.map((simbolo) => simbolo.id),
      ["celda-logo-movistar-vodafone--vodafone", "celda-logo-movistar-vodafone", "celda-logo-digi"],
    );
    const apagadas = (simbolo: Element | undefined) =>
      Array.from(simbolo?.querySelectorAll(".opacity-30") ?? []).length;
    // La porción de Movistar y su logo.
    assert.strictEqual(apagadas(simbolos[0]), 2);
    assert.strictEqual(apagadas(simbolos[1]), 0);
    assert.strictEqual(idDeLogo(["movistar", "vodafone"], ["vodafone"]), simbolos[0]?.id);
    assert.strictEqual(idDeLogo(["digi"], ["digi"]), "celda-logo-digi");
  });
});
