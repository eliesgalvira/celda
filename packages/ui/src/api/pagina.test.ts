import { assert, describe, it } from "@effect/vitest";

import tema from "../tema.css?raw";
import { leerTokens } from "../tokens.ts";
import { estiloDeLaPagina, paginaDeLaApi } from "./pagina.ts";

const datos = {
  documentacion: "https://github.com/eliesgalvira/celda/blob/main/docs/api.md",
  codigo: "https://github.com/eliesgalvira/celda",
  radioMaximoKm: 50,
  limiteMaximo: 50,
  consultasPorMinuto: 60,
};

describe("la página de la API", () => {
  it("la hoja de estilo lleva los valores de tema.css de los dos temas", () => {
    const [claro = "", oscuro = ""] = estiloDeLaPagina(tema).split(
      "@media (prefers-color-scheme: dark)",
    );
    assert.include(claro, `--superficie: ${leerTokens(tema, "claro").get("superficie")};`);
    assert.include(claro, `--fuente-titulo: ${leerTokens(tema, "claro").get("fuente-titulo")};`);
    assert.include(oscuro, `--superficie: ${leerTokens(tema, "oscuro").get("superficie")};`);
    assert.include(oscuro, `--primario-fg: ${leerTokens(tema, "oscuro").get("primario-fg")};`);
  });

  it("falla si a tema.css le falta un token que usa", () => {
    assert.throws(() => estiloDeLaPagina(":root {\n  --tinta: red;\n}"), /--superficie/u);
  });

  it("es un documento en castellano con su título, su hoja y el logo de la marca", () => {
    const html = paginaDeLaApi(datos);
    assert.include(html, '<html lang="es">');
    assert.include(html, "<title>API de Celda</title>");
    assert.include(html, '<link rel="stylesheet" href="/iconos/api.css">');
    assert.include(html, '<img src="/iconos/favicon.svg" alt="">');
  });

  it("enlaza la documentación, el código y el mapa, y dice los límites de la consulta", () => {
    const html = paginaDeLaApi(datos);
    assert.include(html, `<a href="${datos.documentacion}">Documentación completa</a>`);
    assert.include(html, `<a href="${datos.codigo}">Código en GitHub (0BSD)</a>`);
    assert.include(html, '<a href="https://celda.elies.site/">El mapa</a>');
    assert.include(html, "Hasta 50 km. Si no se pone, 1 km.");
    assert.include(html, "de 1 a 50. Si no se pone, 20.");
    assert.include(html, "60 consultas por minuto desde cada IP.");
    assert.include(
      html,
      "<code>movistar</code>, <code>vodafone</code>, <code>orange</code>, <code>digi</code> o <code>yoigo</code>",
    );
  });

  it("sin JavaScript, el botón de copiar no aparece", () => {
    assert.include(paginaDeLaApi(datos), '<button type="button" hidden>Copiar</button>');
  });
});
