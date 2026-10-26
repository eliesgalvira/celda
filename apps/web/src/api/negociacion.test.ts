import { assert, describe, it } from "@effect/vitest";

import { prefiereHtml, sinConsulta } from "./negociacion.ts";

describe("prefiereHtml", () => {
  it("es cierto para un navegador", () => {
    assert.isTrue(
      prefiereHtml(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
    );
    assert.isTrue(prefiereHtml("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
  });

  it("es falso para curl, para un agente que pide JSON y sin cabecera", () => {
    assert.isFalse(prefiereHtml("*/*"));
    assert.isFalse(prefiereHtml("application/json"));
    assert.isFalse(prefiereHtml("application/json, text/plain, */*"));
    assert.isFalse(prefiereHtml(null));
  });

  it("con text/html y JSON nombrados, gana el de más calidad, y el empate es para JSON", () => {
    assert.isFalse(prefiereHtml("text/html;q=0.5, application/json"));
    assert.isFalse(prefiereHtml("text/html, application/json"));
    assert.isTrue(prefiereHtml("application/json;q=0.5, text/html"));
    assert.isFalse(prefiereHtml("text/html;q=0"));
  });
});

describe("sinConsulta", () => {
  it("solo sin parámetros, aunque la URL acabe en ?", () => {
    assert.isTrue(sinConsulta(new URL("https://celda.prueba/api/emplazamientos")));
    assert.isTrue(sinConsulta(new URL("https://celda.prueba/api/emplazamientos?")));
    assert.isFalse(sinConsulta(new URL("https://celda.prueba/api/emplazamientos?lat=1")));
  });
});
