import { assert, describe, it } from "@effect/vitest";
import { fireEvent, render } from "@solidjs/testing-library";

import {
  MarcadorProvincia,
  type MarcadorProvinciaProps,
  medidaDeProvincia,
  textoDeProvincia,
} from "./MarcadorProvincia.tsx";

const montar = (cambios: Partial<MarcadorProvinciaProps> = {}) => {
  let pulsado = 0;
  const pantalla = render(() => (
    <MarcadorProvincia
      x={100}
      y={100}
      forma="completa"
      provincia="Barcelona"
      emplazamientos={5049}
      cobertura="entera"
      carga="resumen"
      ausentes={["yoigo"]}
      nombre="Barcelona, acercar"
      onClick={() => {
        pulsado += 1;
      }}
      {...cambios}
    />
  ));
  return { ...pantalla, pulsados: () => pulsado };
};

describe("MarcadorProvincia", () => {
  it("cubierta y completa, enseña su número, su nombre y sus ausencias, y acerca al pulsarla", () => {
    const { getByRole, pulsados } = montar();
    const boton = getByRole("button", { name: "Barcelona, acercar" });
    assert.include(boton.textContent, "5049");
    assert.include(boton.textContent, "Barcelona");
    assert.include(boton.textContent, "sin Yoigo");
    assert.strictEqual(boton.getAttribute("data-cobertura"), "entera");
    fireEvent.click(boton);
    assert.strictEqual(pulsados(), 1);
  });

  it("a medias dice que es solo una parte; sin cubrir, que aún no está y va sin número", () => {
    assert.include(
      montar({ cobertura: "parcial", ausentes: [] }).container.textContent,
      "solo una parte",
    );
    const sinCubrir = montar({ cobertura: "ninguna", emplazamientos: 0, ausentes: [] });
    assert.include(sinCubrir.container.textContent, "aún no está");
    assert.notMatch(sinCubrir.container.textContent ?? "", /\d/u);
  });

  it("mientras llega su capa late y lo dice; si falla, también", () => {
    const cargando = montar({ carga: "cargando" });
    const boton = cargando.getByRole("button");
    assert.strictEqual(boton.getAttribute("aria-busy"), "true");
    assert.include(boton.textContent, "cargando…");
    assert.strictEqual(textoDeProvincia("entera", "fallo"), "no ha llegado");
    assert.strictEqual(textoDeProvincia("entera", "resumen"), "");
  });

  it("compacta es solo el hexágono, y la medida de la completa crece con las ausencias", () => {
    const { container } = montar({ forma: "compacta" });
    assert.notInclude(container.textContent, "Barcelona");
    assert.deepStrictEqual(medidaDeProvincia("compacta", 3), { ancho: 50, alto: 56 });
    assert.isAbove(medidaDeProvincia("completa", 4).alto, medidaDeProvincia("completa", 0).alto);
  });
});
