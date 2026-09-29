import type { ResumenLeido } from "@celda/dominio/provincias";
import { CapaIlegible, VersionDistinta } from "@celda/dominio/capa";
import { textoPlano } from "@celda/dominio/glosario";
import { assert, describe, it } from "@effect/vitest";
import * as Exit from "effect/Exit";

import {
  creditoDeBarrios,
  creditoDeMunicipios,
  estadoDeCarga,
  estadoDeLaVista,
  textoDatosDelMapa,
} from "./estado.ts";
import { BARCELONA, estados, GIRONA, MUNDO, NOCHE, RESUMEN } from "./pruebasNacional.ts";
import { FUENTE_DE_BARRIOS, FUENTE_DE_MUNICIPIOS, resumenDePrueba } from "./pruebas.ts";
import {
  OrigenNoResponde,
  CapaNoDescargada,
  type FalloCapa,
  SinCapaPublicada,
} from "./servicio.ts";

const DE_PRUEBA = resumenDePrueba({
  version: "sitios@2026-09-25T23:44:53Z",
  fecha: 0,
  emplazamientos: [],
  barrios: [],
  fuenteDeBarrios: FUENTE_DE_BARRIOS,
});

describe("estado de la capa", () => {
  it("cada fallo de la carga tiene su motivo, y un defecto es un error interno", () => {
    const motivo = (salida: Exit.Exit<ResumenLeido, FalloCapa>) => {
      const estado = estadoDeCarga(salida);
      return estado.tipo === "fallo" ? estado.motivo : estado.tipo;
    };
    assert.strictEqual(motivo(Exit.succeed(DE_PRUEBA)), "lista");
    assert.strictEqual(motivo(Exit.fail(new SinCapaPublicada())), "sin-publicar");
    assert.strictEqual(motivo(Exit.fail(new OrigenNoResponde({ motivo: "503" }))), "sin-origen");
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

  it("el crédito de los límites de barrio lleva su autor, su fecha y su licencia", () => {
    assert.deepStrictEqual(creditoDeBarrios(FUENTE_DE_BARRIOS), {
      texto: "Ajuntament de Barcelona (nov 2024, CC BY 4.0)",
      enlace: FUENTE_DE_BARRIOS.enlace,
      detalle: "Límites de barrio de Open Data BCN, datos del 12 nov 2024",
    });
  });

  it("la fecha de los datos es la de Barcelona, no la de UTC", () => {
    // Las 23:44 UTC del 25 son la 1:44 del 26 en Barcelona.
    assert.strictEqual(
      textoPlano(textoDatosDelMapa(Date.UTC(2026, 8, 25, 23, 44, 53))),
      "Datos del mapa: 26 sept 2026",
    );
  });

  it("el crédito del IGN es el de una obra derivada, con su producto y su fecha", () => {
    assert.strictEqual(
      creditoDeMunicipios(FUENTE_DE_MUNICIPIOS).texto,
      "Obra derivada de Base de Datos de Límites Jurisdiccionales de España ago 2026 CC-BY 4.0 ign.es",
    );
  });

  it("con provincias de versiones distintas da las dos fechas, y el barrido si es posterior", () => {
    assert.strictEqual(
      textoPlano(textoDatosDelMapa(NOCHE, { hasta: NOCHE + 86_400_000 })),
      "Datos del mapa: 26 sept a 27 sept 2026",
    );
    assert.strictEqual(
      textoPlano(textoDatosDelMapa(NOCHE, { barrido: NOCHE + 2 * 86_400_000 })),
      "Datos: 26 sept 2026 · barrido 28 sept",
    );
    assert.strictEqual(
      textoPlano(textoDatosDelMapa(NOCHE, { barrido: NOCHE })),
      "Datos del mapa: 26 sept 2026",
    );
  });
});

describe("marca de agua de lo que se ve", () => {
  const cerca = {
    caja: {
      suroeste: { longitud: 2.3, latitud: 41.85 },
      noreste: { longitud: 2.7, latitud: 42 },
    },
    zoom: 10,
  };

  it("sin vista, o de lejos, la fecha del resumen", () => {
    assert.deepStrictEqual(estadoDeLaVista(RESUMEN, estados(), undefined), {
      tipo: "datos",
      fecha: NOCHE,
      hasta: NOCHE,
      barrido: null,
    });
    assert.strictEqual(estadoDeLaVista(RESUMEN, estados(), { caja: MUNDO, zoom: 5 }).tipo, "datos");
  });

  it("de cerca, dice qué provincia se está cargando y cuál no ha llegado", () => {
    assert.deepStrictEqual(
      estadoDeLaVista(
        RESUMEN,
        estados(["08", { tipo: "cargando" }], ["17", { tipo: "lista", provincia: GIRONA }]),
        cerca,
      ),
      { tipo: "cargando", provincias: [{ codigo: "08", nombre: "Barcelona" }] },
    );
    assert.deepStrictEqual(
      estadoDeLaVista(
        RESUMEN,
        estados(["08", { tipo: "cargando" }], ["17", { tipo: "fallo", motivo: "sin-descarga" }]),
        cerca,
      ),
      { tipo: "fallo", provincias: [{ codigo: "17", nombre: "Girona" }] },
    );
  });

  it("con todo lo que se ve cargado, su fecha y la de su último barrido", () => {
    const deOtraVersion = { ...GIRONA, fecha: NOCHE + 86_400_000 };
    assert.deepStrictEqual(
      estadoDeLaVista(
        RESUMEN,
        estados(
          ["08", { tipo: "lista", provincia: BARCELONA }],
          ["17", { tipo: "lista", provincia: deOtraVersion }],
        ),
        cerca,
      ),
      { tipo: "datos", fecha: NOCHE, hasta: NOCHE + 86_400_000, barrido: NOCHE },
    );
  });

  it("de cerca y fuera de lo barrido, dice que Celda aún no tiene datos de ahí", () => {
    const soria = {
      caja: {
        suroeste: { longitud: -2.6, latitud: 41.7 },
        noreste: { longitud: -2.4, latitud: 41.8 },
      },
      zoom: 11,
    };
    assert.deepStrictEqual(estadoDeLaVista(RESUMEN, estados(), soria), {
      tipo: "sin-datos",
      barridas: ["Caja de Barcelona"],
    });
  });
});
