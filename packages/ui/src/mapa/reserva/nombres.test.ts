import { nombreDelIgn } from "@celda/dominio/nombreDeLugar";
import { assert, describe, it } from "@effect/vitest";
import {
  createExpression,
  type ExpressionSpecification,
  featureFilter,
} from "@maplibre/maplibre-gl-style-spec";

import { CONTORNO_DE_PRUEBA } from "../../pruebas/contorno.ts";
import { MUNICIPIOS_DE_CELDA } from "../rotulos.ts";
import { estiloDeReserva } from "./estilo.ts";
import { NOMBRE_DEL_IGN } from "./nombres.ts";

/** El texto de un rótulo como cadena. */
const TEXTO_COMO_CADENA: Parameters<typeof createExpression>[2] = {
  type: "string",
  "property-type": "data-driven",
  expression: { interpolated: false, parameters: ["zoom", "feature"] },
  transition: false,
};

/** Un lugar del IGN, con lo que traen sus teselas. */
const lugar = (nombre: string, clase = "capital_municipio", esp?: number) => ({
  type: 1 as const,
  properties: esp === undefined ? { nombre, clase } : { nombre, clase, esp },
  geometry: [[{ x: 10, y: 10 }]],
});

/** Lo que escribe la expresión con un lugar que se llama `nombre`. */
const escribe = (expresion: ExpressionSpecification, nombre: string): string => {
  const compilada = createExpression(expresion, "text-field", TEXTO_COMO_CADENA);
  if (compilada.result === "error")
    return assert.fail(compilada.value.map((e) => e.message).join());
  return String(compilada.value.evaluate({ zoom: 12 }, lugar(nombre), {}));
};

const ESTILO = estiloDeReserva(() => "#000", CONTORNO_DE_PRUEBA);

/** Si la capa `id` deja ver un lugar, con estos municipios de Celda. */
const seVe = (
  id: string,
  rasgo: ReturnType<typeof lugar>,
  municipiosDeCelda: ReadonlyArray<string> = [],
): boolean => {
  const capa = ESTILO.layers.find((otra) => otra.id === id);
  const filtro = capa !== undefined && "filter" in capa ? capa.filter : undefined;
  assert.isDefined(filtro, id);
  return featureFilter(filtro, "filter", { [MUNICIPIOS_DE_CELDA]: municipiosDeCelda }).filter(
    { zoom: 12 },
    rasgo,
  );
};

/** Nombres como los trae el IGN, de cerca y de lejos. */
const NOMBRES = [
  "San Sebastián",
  "Donostia",
  "Donostia/San Sebastián",
  "Pamplona",
  "Iruña",
  "Alacant",
  "Alicante",
  "Alacant/Alicante",
  "Elx/Elche",
  "Castelló de la Plana",
  "Castellón de la Plana",
  "Vitoria-Gasteiz",
  "Girona",
  "A Coruña",
  "L'Hospitalet de Llobregat",
  "Cataluña/Catalunya",
  "Ceuta (ESP)",
  "Porto (Oporto)",
];

describe("nombre de los rótulos del mapa base de reserva", () => {
  it("el estilo escribe lo mismo que `nombreDelIgn` y quita lo mismo", () => {
    for (const nombre of NOMBRES) {
      const esperado = nombreDelIgn(nombre);
      assert.strictEqual(seVe("lugares-pueblos", lugar(nombre)), esperado !== undefined, nombre);
      if (esperado === undefined) continue;
      assert.strictEqual(escribe(NOMBRE_DEL_IGN, nombre), esperado, nombre);
      assert.notInclude(esperado, "/");
    }
  });

  it("de un bilingüe que el IGN rotula dos veces se ve una forma, la del nombre de lugar", () => {
    assert.isTrue(seVe("lugares-pueblos", lugar("San Sebastián")));
    assert.isFalse(seVe("lugares-pueblos", lugar("Donostia")));
    assert.isTrue(seVe("lugares-grandes", lugar("Alacant", "capital_provincia")));
    assert.isFalse(seVe("lugares-grandes", lugar("Alicante", "capital_provincia")));
  });

  it("un municipio que es zona de Celda quita su rótulo, también el que llega con barra", () => {
    const zonas = ["san sebastián", "alacant"];
    assert.isFalse(seVe("lugares-pueblos", lugar("San Sebastián"), zonas));
    assert.isFalse(
      seVe("lugares-ciudades", lugar("Alacant/Alicante", "nucleo_poblacion", 1), zonas),
    );
    assert.isTrue(seVe("lugares-pueblos", lugar("Bilbao"), zonas));
  });

  it("lo de fuera sale sin el exónimo y nunca Gibraltar", () => {
    assert.strictEqual(escribe(NOMBRE_DEL_IGN, "Porto (Oporto)"), "Porto");
    assert.strictEqual(escribe(NOMBRE_DEL_IGN, "Andorra la Vella"), "Andorra la Vella");
    assert.isTrue(seVe("lugares-de-fuera", lugar("Porto (Oporto)", "nucleo_poblacion", 0)));
    assert.isFalse(seVe("lugares-de-fuera", lugar("Gibraltar", "nucleo_poblacion", 0)));
    assert.isFalse(seVe("lugares-de-fuera", lugar("Gibraltar (RU)", "nucleo_poblacion", 0)));
    // La capa de contexto lo trae como de España.
    assert.isFalse(seVe("lugares-grandes-lejos", lugar("Gibraltar", "nucleo_poblacion", 1)));
    // Lo de España no sale en la capa de fuera, ni lo de fuera en las de España.
    assert.isFalse(seVe("lugares-de-fuera", lugar("Girona", "nucleo_poblacion", 1)));
    assert.isFalse(seVe("lugares-ciudades", lugar("Perpignan (Perpiñán)", "nucleo_poblacion", 0)));
  });
});
