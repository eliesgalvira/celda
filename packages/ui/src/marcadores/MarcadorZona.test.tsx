import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";

import { Ausencias, textoDeAusencias } from "./Ausencias.tsx";
import {
  cajaDeZona,
  MarcadorZona,
  type MarcadorZonaProps,
  textoDeEmplazamientos,
  textoDeProvincia,
} from "./MarcadorZona.tsx";

describe("ausencias de una zona", () => {
  it("el lector de pantalla oye «sin Vodafone ni Digi», y se ve cada logo entero con su marca", () => {
    // Dentro de un botón sin nombre propio, el nombre sale de lo que oye el lector de pantalla.
    const { getByRole } = render(() => (
      <button type="button">
        <Ausencias companias={["vodafone", "digi"]} />
      </button>
    ));

    const ausencias = getByRole("button", { name: "sin Vodafone ni Digi" });
    // Un logo entero por compañía, sin tachar: su dibujo es el mismo que en un marcador.
    const logos = ausencias.querySelectorAll("svg[viewBox='0 0 40 40']");
    assert.lengthOf(logos, 2);
    for (const logo of logos) {
      assert.strictEqual(logo.getAttribute("width"), "20");
      assert.isNull(logo.querySelector("line[stroke-width='3'], [data-tachado]"));
      // La marca de ausencia va al lado del logo, no dentro de su dibujo.
      assert.isNotNull(logo.parentElement?.querySelector(":scope > span[aria-hidden='true']"));
    }
  });

  it("se nombran con comas y «ni» antes de la última", () => {
    assert.strictEqual(textoDeAusencias([]), "");
    assert.strictEqual(textoDeAusencias(["digi"]), "sin Digi");
    assert.strictEqual(
      textoDeAusencias(["movistar", "vodafone", "digi"]),
      "sin Movistar, Vodafone ni Digi",
    );
  });
});

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
      ausentes={["digi"]}
      nombre="Terrassa, 118 emplazamientos, sin Digi, acercar"
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
  const nombreVisible = () => boton.querySelector(".cinta.font-mono")?.textContent ?? undefined;
  return { ...pantalla, boton, numero, nombreVisible, pulsados: () => pulsado };
};

describe("MarcadorZona", () => {
  it("completa: el hexágono con su número, el nombre debajo y las ausencias, y acerca", () => {
    const { boton, numero, nombreVisible, pulsados } = montar();
    assert.strictEqual(
      boton.getAttribute("aria-label"),
      "Terrassa, 118 emplazamientos, sin Digi, acercar",
    );
    assert.isNotNull(boton.querySelector("svg polygon"));
    assert.strictEqual(numero(), "118");
    assert.strictEqual(nombreVisible(), "Terrassa");
    assert.include(boton.textContent, "sin");
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

  it("el nombre va en la letra de las etiquetas, en una cinta, no como un rótulo del mapa", () => {
    const { boton } = montar();
    const nombre = boton.querySelector(".cinta.font-mono");
    assert.isNotNull(nombre);
    // Los rótulos del mapa base van sin fondo y con halo; el nombre de Celda, sobre su cinta.
    assert.notInclude(nombre?.getAttribute("class"), "halo");
    assert.include(nombre?.getAttribute("class"), "bg-superficie-alta");
  });

  it("sin ausencias no dice «sin»; un barrio vacío va en claro con un 0", () => {
    const sants = montar({ zona: "barrio", ausentes: [], emplazamientos: 19 });
    assert.notInclude(sants.boton.textContent, "sin");
    const vallbona = montar({
      zona: "barrio",
      nombreDeZona: "Vallbona",
      emplazamientos: 0,
      ausentes: [],
    });
    assert.strictEqual(vallbona.numero(), "0");
    assert.include(
      vallbona.boton.querySelector("[data-hexagono]")?.getAttribute("class"),
      "fill-superficie ",
    );
    assert.strictEqual(textoDeEmplazamientos(0), "ningún emplazamiento");
    assert.strictEqual(textoDeEmplazamientos(1), "1 emplazamiento");
  });

  it("compacta: solo el hexágono con su número, y la marca si falta alguna compañía", () => {
    const { boton, numero, nombreVisible } = montar({ forma: "compacta" });
    assert.strictEqual(boton.getAttribute("data-forma"), "compacta");
    assert.strictEqual(numero(), "118");
    assert.isUndefined(nombreVisible());
    assert.strictEqual(boton.textContent, "118");
    assert.isNotNull(boton.querySelector(".rounded-full"));
    const sinMarca = montar({ forma: "compacta", ausentes: [] });
    assert.isNull(sinMarca.boton.querySelector(".rounded-full"));
  });

  it("una provincia a medias dice que es solo una parte; sin cubrir, que aún no está, sin número", () => {
    const parcial = montar({ zona: "provincia", cobertura: "parcial", ausentes: [] });
    assert.include(parcial.boton.textContent, "solo una parte");
    assert.strictEqual(parcial.boton.getAttribute("data-cobertura"), "parcial");
    const sinCubrir = montar({
      zona: "provincia",
      cobertura: "ninguna",
      emplazamientos: 0,
      ausentes: [],
    });
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
    assert.deepStrictEqual(cajaDeZona("compacta", "Sants", 3), {
      izquierda: -25,
      arriba: -28,
      derecha: 25,
      abajo: 28,
    });
  });

  it("completa, el nombre debajo y las ausencias a la derecha; un nombre largo, dos líneas", () => {
    const corta = cajaDeZona("completa", "Sants", 0);
    const conAusencias = cajaDeZona("completa", "Sants", 2);
    const larga = cajaDeZona("completa", "Vallvidrera, el Tibidabo i les Planes", 0);
    const provincia = cajaDeZona("completa", "Sants", 0, true);
    assert.isAbove(corta.abajo, 28);
    assert.isAbove(conAusencias.derecha, corta.derecha);
    assert.strictEqual(conAusencias.izquierda, corta.izquierda);
    assert.isAbove(larga.abajo, corta.abajo);
    assert.isAtMost(larga.derecha - larga.izquierda, 152);
    assert.isAbove(provincia.abajo, corta.abajo);
  });
});
