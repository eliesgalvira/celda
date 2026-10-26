import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";

import { LaminaMuda } from "./Deslizable.tsx";
import { RotuloDeCiudad } from "./RotuloDeCiudad.tsx";

describe("RotuloDeCiudad", () => {
  const montar = (conFoto: boolean, importancia: "capital" | "ciudad" = "ciudad") => {
    const contenedor = document.createElement("div");
    document.body.append(contenedor);
    render(() => (
      <LaminaMuda contenedor={contenedor} salto={{ x: 0, y: 0 }}>
        <RotuloDeCiudad
          x={120.04}
          y={80}
          texto="València"
          tamano={13.5}
          importancia={importancia}
          conFoto={conFoto}
        />
      </LaminaMuda>
    ));
    const rotulo = contenedor.querySelector<HTMLElement>("[data-rotulo]");
    return { contenedor, rotulo };
  };

  it("es el nombre de una población, centrado en su punto y con su tamaño", () => {
    const { contenedor, rotulo } = montar(false);
    assert.strictEqual(rotulo?.textContent, "València");
    assert.include(
      rotulo?.getAttribute("style"),
      "translate(120.0px, 80.0px) translate(-50%, -50%)",
    );
    assert.include(rotulo?.getAttribute("style"), "font-size: 13.5px");
    // La lámina no se lee ni recoge gestos: el mapa base tampoco se lee.
    const lamina = contenedor.firstElementChild;
    assert.strictEqual(lamina?.getAttribute("aria-hidden"), "true");
    assert.include(lamina?.getAttribute("class"), "pointer-events-none");
  });

  it("las capitales y los rótulos sobre la foto se distinguen de los demás", () => {
    const clases = (conFoto: boolean, importancia?: "capital") =>
      montar(conFoto, importancia).rotulo?.className;
    assert.notStrictEqual(clases(false, "capital"), clases(false));
    assert.notStrictEqual(clases(true), clases(false));
  });
});
