import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";

import {
  cajaDeZona,
  MarcadorZona,
  type MarcadorZonaProps,
  textoDeEmplazamientos,
  textoDeProvincia,
} from "./MarcadorZona.tsx";

const montar = (cambios: Partial<MarcadorZonaProps> = {}) => {
  let pulsado = 0;
  const pantalla = render(() => (
    <MarcadorZona
      x={200}
      y={120}
      zona="municipio"
      forma="completa"
      nombreDeZona="Terrassa"
      emplazamientos={118}
      nombre="Terrassa, 118 emplazamientos, acercar"
      onClick={() => {
        pulsado += 1;
      }}
      {...cambios}
    />
  ));
  const boton = pantalla.getByRole("button");
  /** El número que se ve dentro del hexágono, o `undefined` si no lleva. */
  const numero = () => boton.querySelector("svg + span")?.textContent ?? undefined;
  /** El nombre que se ve debajo del hexágono, o `undefined` si no lleva. */
  const nombreVisible = () => boton.querySelector(".cinta")?.textContent ?? undefined;
  return { ...pantalla, boton, numero, nombreVisible, pulsados: () => pulsado };
};

describe("MarcadorZona", () => {
  it("completa: el hexágono con su número y el nombre debajo, y acerca", () => {
    const { boton, numero, nombreVisible, pulsados } = montar();
    assert.strictEqual(boton.getAttribute("aria-label"), "Terrassa, 118 emplazamientos, acercar");
    assert.isNotNull(boton.querySelector("svg polygon"));
    assert.strictEqual(numero(), "118");
    assert.strictEqual(nombreVisible(), "Terrassa");
    // Solo se ve lo que hay: ni «sin» ni logos de compañías que falten (ADR 0024).
    assert.strictEqual(boton.textContent, "118Terrassa");
    assert.isNull(boton.querySelector("svg[viewBox='0 0 40 40'], svg use"));
    boton.focus();
    assert.strictEqual(document.activeElement, boton);
    fireEvent.click(boton);
    assert.strictEqual(pulsados(), 1);
  });

  it("provincias, municipios y barrios son el mismo hexágono oscuro, y lo dicen en `data-zona`", () => {
    for (const zona of ["provincia", "municipio", "barrio"] as const) {
      const { boton, numero, nombreVisible } = montar({ zona, nombreDeZona: "Sants" });
      assert.strictEqual(boton.getAttribute("data-zona"), zona);
      assert.include(
        boton.querySelector("[data-hexagono]")?.getAttribute("class"),
        "fill-superficie-invertida",
      );
      assert.strictEqual(numero(), "118");
      assert.strictEqual(nombreVisible(), "Sants");
    }
  });

  it("el nombre es el de un área: en versalitas espaciadas, en una cinta, no como un rótulo", () => {
    // «VALÈNCIA» bajo el hexágono de la provincia y «València» sobre la ciudad se leen como dos
    // cosas: la provincia y su capital (ADR 0024).
    const { boton } = montar({ zona: "provincia", nombreDeZona: "València" });
    const nombre = boton.querySelector(".cinta");
    assert.strictEqual(nombre?.textContent, "València");
    const clases = nombre?.getAttribute("class") ?? "";
    assert.include(clases, "[font-variant-caps:all-small-caps]");
    assert.include(clases, "tracking-[0.12em]");
    // Ya no es la letra de las etiquetas, monoespaciada.
    assert.notInclude(clases, "font-mono");
    // Los rótulos del mapa base van sin fondo y con halo; el nombre de Celda, sobre su cinta.
    assert.notInclude(clases, "halo");
    assert.include(clases, "bg-superficie-alta");
  });

  it("de lejos el hexágono encoge y se aclara, y la cinta va siempre a 0,85 justo debajo", () => {
    const lejos = montar({ tamano: "lejos" });
    assert.strictEqual(lejos.boton.getAttribute("data-tamano"), "lejos");
    const hexagono = lejos.boton.querySelector("svg")?.parentElement?.parentElement;
    assert.include(hexagono?.getAttribute("class"), "scale-[0.62]");
    assert.include(lejos.boton.querySelector("svg")?.getAttribute("class"), "opacity-82");
    const cinta = lejos.boton.querySelector(".cinta")?.parentElement;
    assert.include(cinta?.getAttribute("class"), "scale-85");
    assert.include(cinta?.getAttribute("class"), "top-[calc(50%+17.36px)]");
    // El número sigue opaco y en su sitio, y el botón no encoge.
    assert.strictEqual(lejos.numero(), "118");
    assert.include(lejos.boton.getAttribute("class"), "w-[50px]");
    const cerca = montar({ tamano: "normal" });
    assert.notInclude(cerca.boton.querySelector("svg")?.getAttribute("class"), "opacity");
    assert.include(
      cerca.boton.querySelector(".cinta")?.parentElement?.getAttribute("class"),
      "scale-85",
    );
  });

  it("un barrio vacío va en claro con un 0", () => {
    const vallbona = montar({ zona: "barrio", nombreDeZona: "Vallbona", emplazamientos: 0 });
    assert.strictEqual(vallbona.numero(), "0");
    assert.include(
      vallbona.boton.querySelector("[data-hexagono]")?.getAttribute("class"),
      "fill-superficie ",
    );
    assert.strictEqual(textoDeEmplazamientos(0), "ningún emplazamiento");
    assert.strictEqual(textoDeEmplazamientos(1), "1 emplazamiento");
  });

  it("compacta: solo el hexágono con su número, sin marca en el borde", () => {
    const { boton, numero, nombreVisible } = montar({ forma: "compacta" });
    assert.strictEqual(boton.getAttribute("data-forma"), "compacta");
    assert.strictEqual(numero(), "118");
    assert.isUndefined(nombreVisible());
    assert.strictEqual(boton.textContent, "118");
    assert.isNull(boton.querySelector(".rounded-full"));
  });

  it("una provincia a medias dice que es solo una parte; sin cubrir, que aún no está, sin número", () => {
    const parcial = montar({ zona: "provincia", cobertura: "parcial" });
    assert.include(parcial.boton.textContent, "solo una parte");
    assert.strictEqual(parcial.boton.getAttribute("data-cobertura"), "parcial");
    const sinCubrir = montar({ zona: "provincia", cobertura: "ninguna", emplazamientos: 0 });
    assert.include(sinCubrir.boton.textContent, "aún no está");
    assert.notMatch(sinCubrir.boton.textContent ?? "", /\d/u);
    // Solo las provincias llevan cobertura.
    assert.isNull(montar().boton.getAttribute("data-cobertura"));
  });

  it("mientras llega la capa de una provincia late y lo dice; si falla, también", () => {
    const { boton } = montar({ zona: "provincia", carga: "cargando" });
    assert.strictEqual(boton.getAttribute("aria-busy"), "true");
    assert.include(boton.textContent, "cargando…");
    assert.strictEqual(textoDeProvincia("entera", "fallo"), "no ha llegado");
    assert.strictEqual(textoDeProvincia("entera", "resumen"), "");
  });
});

describe("lo que ocupa una zona", () => {
  it("compacta, el hexágono de 50 × 56 centrado en su punto", () => {
    assert.deepStrictEqual(cajaDeZona("compacta", "Sants"), {
      izquierda: -25,
      arriba: -28,
      derecha: 25,
      abajo: 28,
    });
  });

  it("completa, el nombre debajo y nada al lado; un nombre largo, dos líneas, a 0,85", () => {
    const corta = cajaDeZona("completa", "Sants");
    const larga = cajaDeZona("completa", "Vallvidrera, el Tibidabo i les Planes");
    const provincia = cajaDeZona("completa", "Sants", true);
    assert.isAbove(corta.abajo, 28);
    // Arriba, lo que el hexágono; a los lados, centrada en él: no hay nada a su derecha.
    assert.strictEqual(corta.arriba, -28);
    assert.strictEqual(corta.derecha, -corta.izquierda);
    // La cinta mide como mucho 152 px, y se dibuja a 0,85.
    assert.closeTo(larga.derecha, 76 * 0.85, 1e-9);
    assert.isAbove(larga.abajo, corta.abajo);
    assert.isAbove(provincia.abajo, corta.abajo);
  });

  it("con el hexágono encogido, la caja es la del hexágono a su escala y la cinta, a 0,85", () => {
    assert.deepStrictEqual(cajaDeZona("compacta", "Sants", false, "lejos"), {
      izquierda: -25 * 0.62,
      arriba: -28 * 0.62,
      derecha: 25 * 0.62,
      abajo: 28 * 0.62,
    });
    const normal = cajaDeZona("completa", "Valladolid");
    const lejos = cajaDeZona("completa", "Valladolid", false, "lejos");
    // La cinta mide lo mismo: solo sube lo que encoge el hexágono.
    assert.closeTo(lejos.derecha, normal.derecha, 1e-9);
    assert.closeTo(normal.abajo - lejos.abajo, 28 * (1 - 0.62), 1e-9);
  });
});
