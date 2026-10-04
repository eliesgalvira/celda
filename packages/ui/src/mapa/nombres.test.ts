import {
  CONTORNO_DE_LA_COMUNITAT_VALENCIANA,
  enLaComunitatValenciana,
} from "@celda/dominio/comunitatValenciana";
import { nombreDelMapaBase, type LugarDeOpenStreetMap } from "@celda/dominio/nombreDeLugar";
import { assert, describe, it } from "@effect/vitest";
import {
  createExpression,
  featureFilter,
  type ICanonicalTileID,
} from "@maplibre/maplibre-gl-style-spec";

import { CONTORNO_DE_ESPANA } from "./espana.ts";
import { estiloMapa, FUENTE_MAPA_BASE } from "./estilo.ts";
import { textoDeRotulo } from "./expresiones.ts";
import { nombreDelRotulo } from "./nombres.ts";
import { CAPA_PORTALES, CAPAS_DE_LUGARES, MUNICIPIOS_DE_CELDA } from "./rotulos.ts";

/**
 * El estilo con los contornos de verdad, evaluado con la especificación de estilos de MapLibre:
 * lo que escribiría cada rótulo y si lo deja ver el filtro de su capa.
 */
const ESTILO = estiloMapa(() => "#000", CONTORNO_DE_ESPANA, CONTORNO_DE_LA_COMUNITAT_VALENCIANA);
const TEXTO = nombreDelRotulo(CONTORNO_DE_LA_COMUNITAT_VALENCIANA);
const capaDeLugares = ESTILO.layers.find((capa) => capa.id === CAPAS_DE_LUGARES[0]);
const FILTRO =
  capaDeLugares !== undefined && "filter" in capaDeLugares ? capaDeLugares.filter : undefined;

/** El texto de un rótulo como cadena, que es lo que da `nombreDelRotulo`. */
const TEXTO_COMO_CADENA: Parameters<typeof createExpression>[2] = {
  type: "string",
  "property-type": "data-driven",
  expression: { interpolated: false, parameters: ["zoom", "feature"] },
  transition: false,
};

/** La tesela `z/x/y`, como la da MapLibre a una expresión. */
const teselaCanonica = (z: number, x: number, y: number): ICanonicalTileID => ({
  z,
  x,
  y,
  key: `${z}/${x}/${y}`,
  equals: (otra) => otra.z === z && otra.x === x && otra.y === y,
  url: () => "",
  isChildOf: (padre) =>
    padre.z < z && x >> (z - padre.z) === padre.x && y >> (z - padre.z) === padre.y,
  getTilePoint: (coordenada) => ({
    x: (coordenada.x * 2 ** z - x) * EXTENSION,
    y: (coordenada.y * 2 ** z - y) * EXTENSION,
  }),
  toString: () => `${z}/${x}/${y}`,
});

/** Las unidades de una tesela vectorial. */
const EXTENSION = 8192;

/** Un punto en una tesela del zoom 10, con sus coordenadas dentro de ella, como lo ve MapLibre. */
const enTesela = (longitud: number, latitud: number) => {
  const z = 10;
  const n = 2 ** z;
  const x = ((longitud + 180) / 360) * n;
  const seno = Math.sin((latitud * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI)) * n;
  return {
    canonical: teselaCanonica(z, Math.floor(x), Math.floor(y)),
    punto: {
      x: Math.round((x - Math.floor(x)) * EXTENSION),
      y: Math.round((y - Math.floor(y)) * EXTENSION),
    },
  };
};

/** Las propiedades de un lugar de OpenMapTiles que mira el estilo. */
type PropiedadesDeLugar = {
  readonly name: string;
  readonly "name:latin": string;
  readonly "name:es"?: string;
  readonly class: string;
  readonly capital: number;
};

/** `name:latin` va siempre, como en OpenMapTiles, y `name:es` si lo hay. */
const propiedadesDe = (lugar: LugarDeOpenStreetMap): PropiedadesDeLugar => {
  const comunes = {
    name: lugar.name,
    "name:latin": lugar.latin ?? lugar.name,
    class: "city",
    capital: 4,
  };
  return lugar.es === undefined ? comunes : { ...comunes, "name:es": lugar.es };
};

const rasgo = (lugar: LugarDeOpenStreetMap, longitud: number, latitud: number) => {
  const { canonical, punto } = enTesela(longitud, latitud);
  return {
    canonical,
    rasgo: { type: 1 as const, properties: propiedadesDe(lugar), geometry: [[punto]] },
  };
};

/** Lo que escribe el rótulo de un lugar en (`longitud`, `latitud`), según el estilo. */
const rotulo = (lugar: LugarDeOpenStreetMap, longitud: number, latitud: number): string => {
  const expresion = createExpression(TEXTO, "text-field", TEXTO_COMO_CADENA);
  if (expresion.result === "error")
    return assert.fail(expresion.value.map((e) => e.message).join());
  const { canonical, rasgo: lugarEnTesela } = rasgo(lugar, longitud, latitud);
  return String(expresion.value.evaluate({ zoom: 10 }, lugarEnTesela, {}, canonical));
};

/** Si el filtro de la capa de lugares deja ver el lugar con estos municipios de Celda. */
const seVe = (
  lugar: LugarDeOpenStreetMap,
  longitud: number,
  latitud: number,
  municipiosDeCelda: ReadonlyArray<string>,
): boolean => {
  const filtro = featureFilter(FILTRO, "filter", { [MUNICIPIOS_DE_CELDA]: municipiosDeCelda });
  const { canonical, rasgo: lugarEnTesela } = rasgo(lugar, longitud, latitud);
  return filtro.filter({ zoom: 10 }, lugarEnTesela, canonical);
};

/** Lugares de OpenStreetMap con su punto y el rótulo que tienen que llevar. */
const CASOS: ReadonlyArray<readonly [LugarDeOpenStreetMap, number, number, string]> = [
  [{ name: "Alacant / Alicante", es: "Alicante" }, -0.481, 38.3452, "Alacant"],
  [{ name: "Elx / Elche", es: "Elche" }, -0.6982, 38.2669, "Elx"],
  [{ name: "Sagunt / Sagunto", es: "Sagunto" }, -0.2717, 39.6797, "Sagunt"],
  [{ name: "Alcoi / Alcoy", es: "Alcoy" }, -0.4738, 38.6984, "Alcoi"],
  [
    { name: "Castelló de la Plana / Castellón de la Plana", es: "Castellón de la Plana" },
    -0.0513,
    39.9864,
    "Castelló de la Plana",
  ],
  [{ name: "València", es: "Valencia" }, -0.3763, 39.4699, "València"],
  [{ name: "Donostia / San Sebastián", es: "San Sebastián" }, -1.9812, 43.3128, "San Sebastián"],
  [{ name: "Pamplona / Iruña", es: "Pamplona" }, -1.6432, 42.8169, "Pamplona"],
  [{ name: "Arrasate / Mondragón", es: "Mondragón" }, -2.4986, 43.0647, "Mondragón"],
  [{ name: "Burlada / Burlata", es: "Burlada" }, -1.6167, 42.8256, "Burlada"],
  [{ name: "Vitoria-Gasteiz", es: "Vitoria" }, -2.6727, 42.8467, "Vitoria-Gasteiz"],
  [{ name: "Estella-Lizarra", es: "Estella" }, -2.0272, 42.6716, "Estella-Lizarra"],
  [{ name: "Girona", es: "Gerona" }, 2.8214, 41.9794, "Girona"],
  [{ name: "A Coruña", es: "La Coruña" }, -8.4115, 43.3623, "A Coruña"],
  [
    { name: "Peñacerrada / Urizaharra", es: "Peñacerrada" },
    -2.7141,
    42.6448,
    "Peñacerrada-Urizaharra",
  ],
  [{ name: "Tanger ⵟⴰⵏⵊⴰ طنجة", es: "Tánger", latin: "Tanger" }, -5.8129, 35.7806, "Tánger"],
  [{ name: "الناظور", latin: "Nador" }, -2.9335, 35.1681, "Nador"],
];

describe("nombre de los rótulos del mapa base", () => {
  it("el estilo escribe lo mismo que `nombreDelMapaBase`, en una sola forma y por su posición", () => {
    assert.isDefined(TEXTO);
    for (const [lugar, longitud, latitud, esperado] of CASOS) {
      const enLaComunitat = enLaComunitatValenciana({ longitud, latitud });
      assert.strictEqual(rotulo(lugar, longitud, latitud), esperado, lugar.name);
      assert.strictEqual(nombreDelMapaBase(lugar, enLaComunitat), esperado, lugar.name);
      assert.notInclude(esperado, "/");
    }
  });

  it("solo los rótulos de lugar escriben el nombre de lugar; las vías, el agua y los demás, su `name`", () => {
    const conTexto = ESTILO.layers.flatMap((capa) =>
      capa.type === "symbol" && capa.source === FUENTE_MAPA_BASE && capa.layout !== undefined
        ? [[capa.id, capa["source-layer"], capa.layout["text-field"]] as const]
        : [],
    );
    const deLugar = conTexto.filter(([, capa]) => capa === "place");
    assert.deepStrictEqual(
      deLugar.map(([id]) => id).toSorted(),
      [...CAPAS_DE_LUGARES, "barrios"].toSorted(),
    );
    for (const [id, , texto] of deLugar) assert.deepStrictEqual(texto, textoDeRotulo(TEXTO), id);
    for (const [id, capa, texto] of conTexto) {
      if (capa === "place" || id === "numeros-de-carreteras" || id === CAPA_PORTALES) continue;
      assert.deepStrictEqual(texto, ["get", "name"], id);
    }
  });

  it("cada capa de lugares escribe, dentro de su `format`, lo mismo que el nombre de lugar", () => {
    for (const id of [...CAPAS_DE_LUGARES, "barrios"]) {
      const capa = ESTILO.layers.find((otra) => otra.id === id);
      const texto = capa?.type === "symbol" ? capa.layout?.["text-field"] : undefined;
      // Sin tipo esperado: el `format` da un texto con formato, que se escribe con `String`.
      const expresion = createExpression(texto, "text-field", null);
      if (expresion.result === "error")
        return assert.fail(expresion.value.map((e) => e.message).join());
      for (const [lugar, longitud, latitud, esperado] of CASOS) {
        const { canonical, rasgo: enTesela } = rasgo(lugar, longitud, latitud);
        assert.strictEqual(
          String(expresion.value.evaluate({ zoom: 10 }, enTesela, {}, canonical)),
          esperado,
          `${id}: ${lugar.name}`,
        );
      }
    }
  });

  it("una vía con la barra dentro de su nombre sale entera", () => {
    const via = "Carretera Pamplona / Iruña - Tudela";
    for (const id of ["nombres-de-avenidas", "nombres-de-calles"]) {
      const capa = ESTILO.layers.find((otra) => otra.id === id);
      const texto = capa?.type === "symbol" ? capa.layout?.["text-field"] : undefined;
      const expresion = createExpression(texto, "text-field", TEXTO_COMO_CADENA);
      if (expresion.result === "error")
        return assert.fail(expresion.value.map((e) => e.message).join());
      const { canonical, rasgo: enTesela } = rasgo({ name: via }, -1.6, 42.75);
      assert.strictEqual(
        String(expresion.value.evaluate({ zoom: 14 }, enTesela, {}, canonical)),
        via,
        id,
      );
    }
  });

  it("los pueblos con la barra siguen en una sola forma", () => {
    assert.strictEqual(
      rotulo({ name: "Burlada / Burlata", es: "Burlada" }, -1.6167, 42.8256),
      "Burlada",
    );
    assert.strictEqual(
      rotulo({ name: "Sagunt / Sagunto", es: "Sagunto" }, -0.2717, 39.6797),
      "Sagunt",
    );
  });

  it("un municipio que es zona de Celda quita su rótulo aunque OpenStreetMap lo escriba con barra", () => {
    const donostia: LugarDeOpenStreetMap = {
      name: "Donostia / San Sebastián",
      es: "San Sebastián",
    };
    const alacant: LugarDeOpenStreetMap = { name: "Alacant / Alicante", es: "Alicante" };
    assert.isTrue(seVe(donostia, -1.9812, 43.3128, []));
    assert.isFalse(seVe(donostia, -1.9812, 43.3128, ["san sebastián", "alacant"]));
    assert.isFalse(seVe(alacant, -0.481, 38.3452, ["san sebastián", "alacant"]));
    assert.isTrue(seVe({ name: "Bilbao" }, -2.9253, 43.2627, ["san sebastián", "alacant"]));
  });
});
