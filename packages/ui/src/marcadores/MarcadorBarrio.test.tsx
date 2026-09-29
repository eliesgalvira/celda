import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";

import { Ausencias, textoDeAusencias } from "./Ausencias.tsx";
import { MarcadorBarrio, medidaDeBarrio } from "./MarcadorBarrio.tsx";

describe("ausencias de un barrio", () => {
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

describe("MarcadorBarrio", () => {
  it("completo, enseña el nombre, el número y las ausencias, y es un botón que acerca", () => {
    let pulsado = 0;
    const { getByRole } = render(() => (
      <MarcadorBarrio
        x={200}
        y={120}
        forma="completa"
        barrio="la Dreta de l'Eixample"
        emplazamientos={94}
        ausentes={["digi"]}
        nombre="la Dreta de l'Eixample, 94 emplazamientos, sin Digi, acercar"
        onClick={() => {
          pulsado += 1;
        }}
      />
    ));

    const boton = getByRole("button", {
      name: "la Dreta de l'Eixample, 94 emplazamientos, sin Digi, acercar",
    });
    assert.include(boton.textContent ?? "", "la Dreta de l'Eixample");
    assert.include(boton.textContent ?? "", "94 emplazamientos");
    assert.include(boton.textContent ?? "", "sin");

    boton.focus();
    assert.strictEqual(document.activeElement, boton);
    fireEvent.click(boton);
    assert.strictEqual(pulsado, 1);
  });

  it("sin ausencias no dice «sin», y con cero emplazamientos lo dice con palabras", () => {
    const { getByRole } = render(() => (
      <>
        <MarcadorBarrio
          x={0}
          y={0}
          forma="completa"
          barrio="Sants"
          emplazamientos={19}
          ausentes={[]}
          nombre="Sants, 19 emplazamientos, acercar"
        />
        <MarcadorBarrio
          x={0}
          y={0}
          forma="completa"
          barrio="Vallbona"
          emplazamientos={0}
          ausentes={["movistar", "vodafone", "orange", "digi"]}
          nombre="Vallbona, ningún emplazamiento, acercar"
        />
      </>
    ));
    const sants = getByRole("button", { name: "Sants, 19 emplazamientos, acercar" });
    assert.notInclude(sants.textContent ?? "", "sin");
    const vallbona = getByRole("button", { name: "Vallbona, ningún emplazamiento, acercar" });
    assert.include(vallbona.textContent ?? "", "ningún emplazamiento");
  });

  it("compacto, enseña solo el número y la marca si falta alguna compañía", () => {
    const { getByRole } = render(() => (
      <MarcadorBarrio
        x={0}
        y={0}
        forma="compacta"
        barrio="la Clota"
        emplazamientos={1}
        ausentes={["vodafone", "orange", "digi"]}
        nombre="la Clota, 1 emplazamiento, sin Vodafone, Orange ni Digi, acercar"
      />
    ));
    const boton = getByRole("button", { name: /^la Clota, 1 emplazamiento/u });
    assert.strictEqual(boton.textContent, "1");
    assert.strictEqual(boton.getAttribute("data-forma"), "compacta");
  });

  it("la etiqueta completa ocupa más que la compacta, y más con ausencias y nombres largos", () => {
    const compacta = medidaDeBarrio("compacta", "Sants", 1);
    const corta = medidaDeBarrio("completa", "Sants", 0);
    const conAusencias = medidaDeBarrio("completa", "Sants", 1);
    const larga = medidaDeBarrio("completa", "Vallvidrera, el Tibidabo i les Planes", 1);
    assert.isAbove(corta.ancho, compacta.ancho);
    assert.isAbove(conAusencias.alto, corta.alto);
    assert.isAbove(larga.alto, conAusencias.alto);
    assert.isAtLeast(compacta.ancho, 44);
  });
});

describe("MarcadorBarrio de un municipio", () => {
  it("se ve como un barrio y lo dice en `data-zona`; sin ausencias no hay cinta ni marca", () => {
    const { getByRole } = render(() => (
      <>
        <MarcadorBarrio
          x={0}
          y={0}
          zona="municipio"
          forma="completa"
          barrio="Aiguafreda"
          emplazamientos={3}
          ausentes={[]}
          nombre="Aiguafreda, 3 emplazamientos, acercar"
        />
        <MarcadorBarrio
          x={0}
          y={0}
          zona="municipio"
          forma="compacta"
          barrio="Castellcir"
          emplazamientos={2}
          ausentes={[]}
          nombre="Castellcir, 2 emplazamientos, acercar"
        />
      </>
    ));
    const completo = getByRole("button", { name: "Aiguafreda, 3 emplazamientos, acercar" });
    assert.strictEqual(completo.getAttribute("data-zona"), "municipio");
    assert.notInclude(completo.textContent ?? "", "sin");
    const compacto = getByRole("button", { name: "Castellcir, 2 emplazamientos, acercar" });
    assert.strictEqual(compacto.textContent, "2");
    assert.isNull(compacto.querySelector(".rounded-full"));
  });
});
