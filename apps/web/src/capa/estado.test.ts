import { CapaIlegible, type CapaLeida, VersionDistinta } from "@celda/dominio/capa";
import { textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";
import * as Exit from "effect/Exit";

import { estadoDeCarga, textoDatosDelMapa } from "./estado.ts";
import { FUENTE_DE_BARRIOS } from "./pruebas.ts";
import {
  BackendNoResponde,
  CapaNoDescargada,
  type FalloCapa,
  SinCapaPublicada,
} from "./servicio.ts";

const CAPA: CapaLeida = {
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: 0,
  emplazamientos: [],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
};

describe("estado de la capa", () => {
  it("cada fallo de la carga tiene su motivo, y un defecto es un error interno", () => {
    const motivo = (salida: Exit.Exit<CapaLeida, FalloCapa>) => {
      const estado = estadoDeCarga(salida);
      return estado.tipo === "fallo" ? estado.motivo : estado.tipo;
    };
    assert.strictEqual(motivo(Exit.succeed(CAPA)), "lista");
    assert.strictEqual(motivo(Exit.fail(new SinCapaPublicada())), "sin-publicar");
    assert.strictEqual(motivo(Exit.fail(new BackendNoResponde({ motivo: "503" }))), "sin-backend");
    assert.strictEqual(
      motivo(Exit.fail(new CapaNoDescargada({ url: "u", motivo: "404" }))),
      "sin-descarga",
    );
    assert.strictEqual(motivo(Exit.fail(new CapaIlegible({ motivo: "cortada" }))), "danada");
    assert.strictEqual(
      motivo(Exit.fail(new VersionDistinta({ esperada: "a", encontrada: "b" }))),
      "danada",
    );
    assert.strictEqual(motivo(Exit.die("se ha roto")), "interno");
  });

  it("la fecha de los datos es la de Barcelona, no la de UTC", () => {
    // Las 23:44 UTC del 25 son la 1:44 del 26 en Barcelona.
    assert.strictEqual(
      textoPlano(textoDatosDelMapa(Date.UTC(2026, 8, 25, 23, 44, 53))),
      "Datos del mapa: 26 sept 2026",
    );
  });
});
