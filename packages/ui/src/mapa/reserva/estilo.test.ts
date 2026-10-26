import { assert, describe, it } from "@effect/vitest";
import { diff, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import * as Predicate from "effect/Predicate";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../../pruebas/contorno.ts";
import { estiloMapa, FUENTE_MAPA_BASE, TOKENS_MAPA } from "../estilo.ts";
import { FOTO_AEREA } from "../expresiones.ts";
import { FUENTE_LIMITES } from "../limites.ts";
import { FUENTE_LINEA_AL_PUNTO } from "../lineaAlPunto.ts";
import { CAPA_FOTO, FUENTE_EDIFICIO } from "../foto.ts";
import {
  CAPA_PORTALES,
  CAPAS_DE_LUGARES,
  LETRAS_DE_LEJOS,
  MUNICIPIOS_DE_CELDA,
  ZOOM_DE_FUERA,
} from "../rotulos.ts";
import { CAPA_EDIFICIOS } from "../suelo.ts";
import { CAPA_HUECOS } from "../huecos.ts";
import { conLoDeCelda, estiloDeReserva, FUENTE_RESERVA, GLIFOS_RESERVA } from "./estilo.ts";
import { CAPAS_DE_CIUDADES_DE_RESERVA } from "./rotulos.ts";

const MARCA = "token:";
const RESERVA = estiloDeReserva((token) => `${MARCA}${token}`, CONTORNO_DE_PRUEBA);
const PRINCIPAL = estiloMapa(
  (token) => `${MARCA}${token}`,
  CONTORNO_DE_PRUEBA,
  COMUNITAT_DE_PRUEBA,
);

/** Si una capa es del callejero: el fondo o una que lee las teselas de `fuente`. */
const delCallejero = (fuente: string) => (capa: LayerSpecification) =>
  capa.type === "background" || ("source" in capa && capa.source === fuente);

/** Un valor de una propiedad del estilo: un literal, una lista o una expresión. */
type ValorDelEstilo =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<ValorDelEstilo>
  | { readonly [clave: string]: ValorDelEstilo };

/** Todas las cadenas que lleva un valor, dentro de expresiones y listas. */
const cadenas = (valor: ValorDelEstilo): ReadonlyArray<string> =>
  Predicate.isString(valor)
    ? [valor]
    : Predicate.isObjectOrArray(valor)
      ? Object.values(valor).flatMap(cadenas)
      : [];

describe("estilo del mapa base de reserva", () => {
  it("es un estilo válido para MapLibre", () => {
    assert.deepStrictEqual(
      validateStyleMin(estiloDeReserva(() => "#123456", CONTORNO_DE_PRUEBA)).map(
        (error) => error.message,
      ),
      [],
    );
  });

  it("pinta solo con tokens del tema, y con todos los del suelo, las vías y los rótulos", () => {
    const colores = RESERVA.layers.flatMap((capa) =>
      Object.entries(capa.paint ?? {}).flatMap(([propiedad, valor]) =>
        propiedad.endsWith("-color") ? cadenas(valor).map((cadena) => [capa.id, cadena]) : [],
      ),
    );
    const usados = new Set<string>();
    for (const [capa, cadena] of colores) {
      assert.notMatch(cadena ?? "", /^(#|rgb|hsl|oklch)/u, `${capa ?? ""} lleva un color suelto`);
      if (cadena?.startsWith(MARCA) === true) usados.add(cadena.slice(MARCA.length));
    }
    // El único que no usa es el de los hospitales: el IGN no da su recinto.
    const sinUsar = TOKENS_MAPA.filter((token) => !usados.has(token));
    assert.deepStrictEqual(sinUsar, ["mapa-hospital"]);
  });

  it("no pide nada a OpenFreeMap: las teselas y los glifos salen del IGN, y no hay iconos", () => {
    const texto = JSON.stringify(RESERVA);
    assert.notInclude(texto, "openfreemap");
    assert.strictEqual(RESERVA.glyphs, GLIFOS_RESERVA);
    assert.isUndefined(RESERVA.sprite);
    const fuente = RESERVA.sources[FUENTE_RESERVA];
    assert.isTrue(
      fuente?.type === "vector" &&
        (fuente.tiles ?? []).every((url) => url.startsWith("https://vt-mapabase.idee.es/")),
    );
    assert.isUndefined(RESERVA.sources[FUENTE_MAPA_BASE]);
  });

  it("los rótulos usan las letras del principal, que el IGN tiene con el mismo nombre", () => {
    const letras = new Set(
      RESERVA.layers.flatMap((capa) => {
        const letra = capa.type === "symbol" ? capa.layout?.["text-font"] : undefined;
        return Array.isArray(letra) ? letra.filter(Predicate.isString) : [];
      }),
    );
    assert.deepStrictEqual([...letras].toSorted(), [...LETRAS_DE_LEJOS].toSorted());
  });

  it("tiene las capas de Celda del principal, en el mismo orden, y las que la web busca", () => {
    const deCelda = (estilo: StyleSpecification, fuente: string) =>
      estilo.layers.filter((capa) => !delCallejero(fuente)(capa)).map((capa) => capa.id);
    assert.deepStrictEqual(deCelda(RESERVA, FUENTE_RESERVA), deCelda(PRINCIPAL, FUENTE_MAPA_BASE));
    const ids = RESERVA.layers.map((capa) => capa.id);
    for (const id of [CAPA_EDIFICIOS, CAPA_PORTALES, CAPA_FOTO, CAPAS_DE_LUGARES[0] ?? ""]) {
      assert.include(ids, id);
    }
    assert.deepStrictEqual(RESERVA.state, PRINCIPAL.state);
    assert.strictEqual(new Set(ids).size, ids.length, "hay capas con el mismo nombre");
  });

  it("tiene los mismos límites que el principal: los del fichero de Celda y, del IGN, los municipios", () => {
    const limites = (estilo: StyleSpecification) =>
      estilo.layers.filter((capa) => capa.id.startsWith("limites-"));
    // Las fronteras entre otros países no las da el IGN: la de España sale del fichero de Celda.
    const principal = limites(PRINCIPAL).filter((capa) => capa.id !== "limites-paises");
    const reserva = limites(RESERVA);
    assert.deepStrictEqual(
      reserva.map((capa) => capa.id),
      principal.map((capa) => capa.id),
    );
    for (const [deReserva, delPrincipal] of reserva.map(
      (capa, k) => [capa, principal[k]] as const,
    )) {
      assert.deepStrictEqual(deReserva.paint, delPrincipal?.paint, deReserva.id);
      if (deReserva.type === "line" && deReserva.source === FUENTE_RESERVA) {
        assert.strictEqual(deReserva["source-layer"], "linea_limite_lin");
      } else {
        assert.deepStrictEqual(deReserva, delPrincipal);
      }
    }
    assert.deepStrictEqual(RESERVA.sources[FUENTE_LIMITES], PRINCIPAL.sources[FUENTE_LIMITES]);
  });

  it("no rotula nada de fuera de España de lejos", () => {
    const deFuera = RESERVA.layers.find((capa) => capa.id === "lugares-de-fuera");
    assert.isAtLeast(deFuera?.minzoom ?? 0, ZOOM_DE_FUERA);
  });
});

/** El estilo principal como lo tiene un mapa en marcha: con lo que la web le ha ido poniendo. */
const principalEnMarcha = (): StyleSpecification => {
  const estilo = structuredClone(PRINCIPAL);
  const linea = estilo.sources[FUENTE_LINEA_AL_PUNTO];
  if (linea?.type === "geojson") {
    linea.data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [2.15, 41.39],
              [2.152, 41.391],
            ],
          },
        },
      ],
    };
  }
  const edificio = estilo.sources[FUENTE_EDIFICIO];
  if (edificio?.type === "geojson") edificio.data = { type: "FeatureCollection", features: [] };
  // Una capa de Celda con otra opacidad.
  return {
    ...estilo,
    layers: estilo.layers.map((capa) =>
      capa.id === FUENTE_LINEA_AL_PUNTO && capa.type === "line"
        ? { ...capa, paint: { ...capa.paint, "line-opacity": 0.85 } }
        : capa,
    ),
  };
};

describe("pasar al mapa base de reserva", () => {
  it("como el principal, las ciudades se colocan sin pintarse sobre los huecos de los marcadores (ADR 0024)", () => {
    const ids = RESERVA.layers.map((capa) => capa.id);
    const huecos = ids.indexOf(CAPA_HUECOS);
    assert.isAbove(huecos, ids.indexOf("lugares-pueblos"));
    assert.isAbove(huecos, ids.indexOf("lugares-de-fuera"));
    for (const id of CAPAS_DE_CIUDADES_DE_RESERVA) {
      assert.isAbove(ids.indexOf(id), huecos, id);
      const capa = RESERVA.layers.find((c) => c.id === id);
      assert.isTrue(capa?.type === "symbol" && capa.paint?.["text-opacity"] === 0, id);
    }
    // Al pasar a la reserva, los huecos siguen entre los pueblos y las ciudades.
    const siguiente = conLoDeCelda(principalEnMarcha(), RESERVA).layers.map((capa) => capa.id);
    assert.isBelow(siguiente.indexOf(CAPA_HUECOS), siguiente.indexOf("lugares-ciudades"));
    assert.isAbove(siguiente.indexOf(CAPA_HUECOS), siguiente.indexOf("lugares-pueblos"));
  });

  it("solo cambia el callejero: lo de Celda se queda como está", () => {
    const anterior = principalEnMarcha();
    const siguiente = conLoDeCelda(anterior, RESERVA);
    const cambios = diff(anterior, siguiente);
    const ordenes = new Set(cambios.map((cambio) => cambio.command));

    // No vuelve a cargar todo ni vacía las fuentes de Celda ni toca el estado.
    for (const orden of ["setStyle", "setGeoJSONSourceData", "setGlobalState"] as const) {
      assert.isFalse(ordenes.has(orden), orden);
    }
    const deCelda = new Set(
      anterior.layers
        .filter((capa) => !delCallejero(FUENTE_MAPA_BASE)(capa))
        .map((capa) => capa.id),
    );
    for (const cambio of cambios) {
      const [primero] = cambio.args;
      const id = Predicate.isString(primero)
        ? primero
        : Predicate.isObject(primero) && "id" in primero
          ? String(primero.id)
          : undefined;
      if (cambio.command === "addSource" || cambio.command === "removeSource") {
        assert.include([FUENTE_MAPA_BASE, FUENTE_RESERVA], id, cambio.command);
      } else if (id !== undefined && cambio.command !== "setGlyphs") {
        assert.isFalse(deCelda.has(id), `${cambio.command} ${id}`);
      }
    }
    assert.isTrue(ordenes.has("setGlyphs"));
    assert.isTrue(ordenes.has("removeSource"));
  });

  it("las capas y las fuentes de Celda conservan lo que la web les puso", () => {
    const anterior = principalEnMarcha();
    const siguiente = conLoDeCelda(anterior, RESERVA);
    assert.deepStrictEqual(
      siguiente.sources[FUENTE_LINEA_AL_PUNTO],
      anterior.sources[FUENTE_LINEA_AL_PUNTO],
    );
    const cambiada = siguiente.layers.find((capa) => capa.id === FUENTE_LINEA_AL_PUNTO);
    assert.isTrue(cambiada?.type === "line" && cambiada.paint?.["line-opacity"] === 0.85);
    assert.deepStrictEqual(siguiente.state, {
      [MUNICIPIOS_DE_CELDA]: { default: [] },
      [FOTO_AEREA]: { default: false },
    });
  });
});
