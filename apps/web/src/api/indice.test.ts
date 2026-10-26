import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { DOCUMENTACION } from "./http.ts";
import { indice, noEncontrada } from "./indice.ts";
import { ErrorEnJson, IndiceEnJson } from "./respuesta.ts";

const comoIndice = Schema.decodeUnknownSync(IndiceEnJson);
const comoError = Schema.decodeUnknownSync(ErrorEnJson);

describe("GET /api", () => {
  it("dice qué rutas hay, con ejemplos en el origen de la petición, y dónde está la documentación", async () => {
    const respuesta = indice(new Request("https://celda.prueba/api"));
    assert.strictEqual(respuesta.status, 200);
    assert.strictEqual(respuesta.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.strictEqual(respuesta.headers.get("Access-Control-Allow-Origin"), "*");
    const cuerpo = comoIndice(await respuesta.text());
    assert.strictEqual(cuerpo.documentacion, DOCUMENTACION);
    assert.deepStrictEqual(
      cuerpo.rutas.map((ruta) => ruta.ruta),
      ["/api/emplazamientos", "/capas/vigente.json"],
    );
    assert.isTrue(cuerpo.rutas.every((ruta) => ruta.ejemplo.startsWith("https://celda.prueba/")));
  });

  it("un navegador que abre /api recibe la página; un agente, el índice en JSON", async () => {
    const navegador = indice(
      new Request("https://celda.prueba/api", {
        headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      }),
    );
    assert.strictEqual(navegador.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert.strictEqual(navegador.headers.get("Vary"), "Accept");
    const agente = indice(
      new Request("https://celda.prueba/api", { headers: { accept: "application/json" } }),
    );
    assert.strictEqual(agente.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.strictEqual(agente.headers.get("Vary"), "Accept");
    assert.strictEqual(agente.headers.get("Cache-Control"), "private, max-age=300");
  });

  it("una ruta que no existe contesta 404 en JSON, sin caché", async () => {
    const respuesta = noEncontrada();
    assert.strictEqual(respuesta.status, 404);
    assert.strictEqual(respuesta.headers.get("Cache-Control"), "no-store");
    const cuerpo = comoError(await respuesta.text());
    assert.strictEqual(cuerpo.error, "no-encontrado");
    assert.include(cuerpo.mensaje, DOCUMENTACION);
  });
});
