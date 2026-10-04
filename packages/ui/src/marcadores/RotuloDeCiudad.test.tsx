import { assert, describe, it } from "@effect/vitest";
import { render } from "@solidjs/testing-library";

import { CapaDeRotulos, RotuloDeCiudad } from "./RotuloDeCiudad.tsx";

describe("RotuloDeCiudad", () => {
  const montar = (conFoto: boolean, importancia: "capital" | "ciudad" = "ciudad") => {
    const contenedor = document.createElement("div");
    document.body.append(contenedor);
    render(() => (
      <CapaDeRotulos contenedor={contenedor}>
        <RotuloDeCiudad
          x={120.04}
          y={80}
          texto="València"
          tamano={13.5}
          importancia={importancia}
          conFoto={conFoto}
        />
      </CapaDeRotulos>
    ));
    const rotulo = contenedor.querySelector<HTMLElement>("[data-rotulo]");
    return { contenedor, rotulo };
  };

  it("es el nombre de una población, en caja normal, centrado en su punto y con su tamaño", () => {
    const { contenedor, rotulo } = montar(false);
    assert.strictEqual(rotulo?.textContent, "València");
    const clases = rotulo?.getAttribute("class") ?? "";
    assert.notInclude(clases, "small-caps");
    assert.include(clases, "font-rotulo");
    assert.include(clases, "text-rotulo-ciudad");
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

  it("las capitales van en negrita; sobre la foto, en blanco con halo oscuro", () => {
    assert.include(montar(false, "capital").rotulo?.getAttribute("class"), "font-bold");
    const sobreLaFoto = montar(true).rotulo?.getAttribute("class") ?? "";
    assert.include(sobreLaFoto, "text-rotulo-foto");
    assert.include(sobreLaFoto, "--mapa-foto-halo");
    assert.notInclude(sobreLaFoto, "text-rotulo-ciudad");
  });
});
