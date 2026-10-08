import { assert, describe, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";
import type { StyleSpecification } from "maplibre-gl";

import { COMUNITAT_DE_PRUEBA, CONTORNO_DE_PRUEBA } from "../pruebas/contorno.ts";
import { tokensDelTema } from "../pruebas/tema.ts";
import { comoRgb, leerOklch } from "./color.ts";
import {
  estiloMapa,
  FUENTE_MAPA_BASE,
  quitarRotulosDeMunicipios,
  RECURSOS_INICIALES_MAPA_BASE,
  TOKENS_MAPA,
} from "./estilo.ts";
import { nombreDelRotulo } from "./nombres.ts";
import { estiloDeReserva } from "./reserva/estilo.ts";
import {
  CAPA_HUECOS,
  crearImagenesDeHuecos,
  type HuecosEnGeoJson,
  imagenDeHueco,
  puestaDeHuecos,
} from "./huecos.ts";
import {
  CAPAS_DE_CIUDADES,
  CAPAS_DE_LUGARES,
  tamanoDeRotulo,
  type MapaConRotulos,
  MUNICIPIOS_DE_CELDA,
  ZOOM_DE_FUERA,
} from "./rotulos.ts";

const MARCA = "token:";

/**
 * Los colores que puede dar una expresión: de un `step`, el de cada tramo; de un `match` y de un
 * `case`, el de cada caso y el de por defecto, que pueden ser otra expresión.
 */
const salidas = (
  valor:
    | StyleSpecification["layers"][number]["paint"]
    | ReadonlyArray<unknown>
    | string
    | number
    | boolean
    | null
    | undefined,
): ReadonlyArray<unknown> => {
  if (!Array.isArray(valor)) return [valor];
  const [operador] = valor;
  const indices =
    operador === "step"
      ? valor.flatMap((_, i) => (i >= 2 && i % 2 === 0 ? [i] : []))
      : operador === "match"
        ? valor.flatMap((_, i) => ((i >= 3 && i % 2 === 1) || i === valor.length - 1 ? [i] : []))
        : operador === "case"
          ? valor.flatMap((_, i) => ((i >= 2 && i % 2 === 0) || i === valor.length - 1 ? [i] : []))
          : undefined;
  return indices === undefined ? [valor] : indices.flatMap((i) => salidas(valor[i]));
};

/** Los valores de todas las propiedades de color (`*-color`) de las capas del estilo. */
const coloresDelEstilo = (estilo: StyleSpecification) =>
  estilo.layers.flatMap((capa) =>
    Object.entries(capa.paint ?? {})
      .filter(([propiedad]) => propiedad.endsWith("-color"))
      .flatMap(([propiedad, valor]) =>
        salidas(valor).map((color) => ({ capa: capa.id, propiedad, valor: color })),
      ),
  );

const estiloDePrueba = () => estiloMapa(() => "#000", CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA);

/** Un mapa de prueba con las capas del estilo: guarda el estado como MapLibre. */
const mapaDePrueba = (estilo: StyleSpecification | undefined) => {
  const capas = new Set((estilo?.layers ?? []).map((capa) => capa.id));
  const estado = new Map<string, ReadonlyArray<string>>();
  const mapa: MapaConRotulos = {
    getLayer: (capa) => (capas.has(capa) ? {} : undefined),
    setGlobalStateProperty: (nombre, valor) => {
      estado.set(nombre, valor);
    },
  };
  return { mapa, estado };
};

describe("estiloMapa", () => {
  it("pinta el mapa solo con tokens del tema", () => {
    const pedidos = new Set<string>();
    const estilo = estiloMapa(
      (token) => {
        pedidos.add(token);
        return `${MARCA}${token}`;
      },
      CONTORNO_DE_PRUEBA,
      COMUNITAT_DE_PRUEBA,
    );

    const colores = coloresDelEstilo(estilo);
    assert.isAbove(colores.length, 0);
    for (const { capa, propiedad, valor } of colores) {
      assert.isTrue(
        Predicate.isString(valor) && valor.startsWith(MARCA),
        `${capa}.${propiedad} no sale de un token: ${String(valor)}`,
      );
    }
    assert.deepStrictEqual([...pedidos].toSorted(), [...TOKENS_MAPA].toSorted());
  });

  it("tiene cada token del mapa en OKLCH en el tema claro y en el oscuro", () => {
    for (const tema of ["claro", "oscuro"] as const) {
      const tokens = tokensDelTema(tema);
      for (const token of TOKENS_MAPA) {
        const valor = tokens.get(token);
        assert.isDefined(valor, `falta --${token} en el tema ${tema}`);
        assert.isNotNull(leerOklch(valor ?? ""), `--${token} no es OKLCH en el tema ${tema}`);
      }
    }
  });

  it("en los dos temas, nada de lo que dibuja el mapa sale del mismo color que el fondo", () => {
    // Una vía, un edificio o el agua del color del fondo dejarían el mapa en blanco o en negro.
    // Los halos sí llevan el color del fondo, y la silueta de España mientras carga, el del suelo.
    const marcados = (estilo: StyleSpecification) =>
      coloresDelEstilo(estilo).filter(({ propiedad }) => !propiedad.endsWith("halo-color"));
    const conMarca = (token: string) => `${MARCA}${token}`;
    const usados = new Set(
      [
        ...marcados(estiloMapa(conMarca, CONTORNO_DE_PRUEBA, COMUNITAT_DE_PRUEBA)),
        ...marcados(estiloDeReserva(conMarca, CONTORNO_DE_PRUEBA)),
      ].flatMap(({ valor }) =>
        Predicate.isString(valor) && valor !== conMarca("mapa-fondo")
          ? [valor.slice(MARCA.length)]
          : [],
      ),
    );
    assert.isAbove(usados.size, 30);
    for (const tema of ["claro", "oscuro"] as const) {
      const tokens = tokensDelTema(tema);
      const rgb = (token: string) => {
        const color = leerOklch(tokens.get(token) ?? "");
        return color === null ? "" : comoRgb(color);
      };
      for (const token of usados) {
        assert.notStrictEqual(
          rgb(token),
          rgb("mapa-fondo"),
          `--${token} es del color del fondo en el tema ${tema}`,
        );
      }
    }
  });

  it("pide por adelantado el TileJSON y los glifos que usa la vista inicial", () => {
    const estilo = estiloDePrueba();
    const fuente = estilo.sources[FUENTE_MAPA_BASE];
    assert.isTrue(
      fuente?.type === "vector" && RECURSOS_INICIALES_MAPA_BASE.includes(fuente.url ?? ""),
    );
    // Los rótulos que se ven lejos, antes del zoom 13: sus glifos no pueden esperar a la tesela.
    const letras = estilo.layers.flatMap((capa) =>
      capa.type === "symbol" && (capa.minzoom ?? 0) < 13 ? (capa.layout?.["text-font"] ?? []) : [],
    );
    assert.isAbove(letras.length, 0);
    for (const letra of letras) {
      const glifos = (estilo.glyphs ?? "")
        .replace("{fontstack}", encodeURIComponent(String(letra)))
        .replace("{range}", "0-255");
      assert.include(RECURSOS_INICIALES_MAPA_BASE, glifos);
    }
  });

  it("rotula los lugares por importancia: la capa más importante, la última, se coloca antes", () => {
    const ids = estiloDePrueba().layers.map((capa) => capa.id);
    // Entre los pueblos y las ciudades, los huecos de los marcadores de Celda (ADR 0024).
    assert.deepStrictEqual(ids.slice(-CAPAS_DE_LUGARES.length - 1), [
      "lugares-aldeas",
      "lugares-pueblos",
      "lugares-pueblos-grandes",
      CAPA_HUECOS,
      "lugares-ciudades",
      "lugares-grandes",
      "lugares-capitales",
    ]);
    assert.deepStrictEqual(CAPAS_DE_LUGARES, [
      "lugares-capitales",
      "lugares-grandes",
      "lugares-ciudades",
      "lugares-pueblos-grandes",
      "lugares-pueblos",
      "lugares-aldeas",
    ]);
    const desde = new Map(
      estiloDePrueba().layers.map((capa) => [capa.id, capa.minzoom ?? 0] as const),
    );
    assert.deepStrictEqual(
      CAPAS_DE_LUGARES.map((id) => desde.get(id)),
      [4, 4.5, 7, 8, 10, 12],
    );
  });

  it("los rótulos de lugar no salen de fuera de España hasta el zoom 9 y Gibraltar, nunca", () => {
    const soloDeEspana = [
      "all",
      ["!=", ["get", "name"], "Gibraltar"],
      ["any", [">=", ["zoom"], ZOOM_DE_FUERA], ["within", CONTORNO_DE_PRUEBA]],
    ];
    assert.strictEqual(ZOOM_DE_FUERA, 9);
    for (const capa of estiloDePrueba().layers) {
      if (!CAPAS_DE_LUGARES.includes(capa.id)) continue;
      const filtro = "filter" in capa ? capa.filter : undefined;
      assert.deepStrictEqual<unknown>(
        Array.isArray(filtro) ? filtro.slice(0, 2) : undefined,
        ["all", soloDeEspana],
        capa.id,
      );
    }
  });

  it("las capas de lugares dejan fuera, sin mirar mayúsculas, los municipios que lleva Celda", () => {
    const estilo = estiloDePrueba();
    // Se compara lo que escribe el rótulo, en una sola forma (`nombres.test.ts`).
    const sinLosDeCelda = [
      "!",
      [
        "in",
        ["downcase", nombreDelRotulo(COMUNITAT_DE_PRUEBA)],
        ["global-state", MUNICIPIOS_DE_CELDA],
      ],
    ];
    assert.deepStrictEqual<unknown>(estilo.state?.[MUNICIPIOS_DE_CELDA], { default: [] });
    for (const capa of estilo.layers) {
      if (!CAPAS_DE_LUGARES.includes(capa.id)) continue;
      const filtro = "filter" in capa ? capa.filter : undefined;
      assert.deepStrictEqual<unknown>(
        Array.isArray(filtro) ? filtro.at(-1) : undefined,
        sinLosDeCelda,
      );
    }

    const { mapa, estado } = mapaDePrueba(estilo);
    quitarRotulosDeMunicipios(mapa, ["L'Hospitalet de Llobregat", "Badalona"]);
    assert.deepStrictEqual(estado.get(MUNICIPIOS_DE_CELDA), [
      "l'hospitalet de llobregat",
      "badalona",
    ]);
    quitarRotulosDeMunicipios(mapa, []);
    assert.deepStrictEqual(estado.get(MUNICIPIOS_DE_CELDA), []);
  });

  it("antes de que el estilo tenga sus capas, quitar rótulos no hace nada", () => {
    const { mapa, estado } = mapaDePrueba(undefined);
    quitarRotulosDeMunicipios(mapa, ["Badalona"]);
    assert.strictEqual(estado.size, 0);
  });
});

describe("rótulos de ciudad por encima de los datos (ADR 0024)", () => {
  const capas = new Map(estiloDePrueba().layers.map((capa) => [capa.id, capa] as const));
  const simbolo = (id: string) => {
    const capa = capas.get(id);
    return capa?.type === "symbol" ? capa : undefined;
  };

  it("las ciudades se colocan sin pintarse, y los pueblos se pintan como siempre", () => {
    assert.deepStrictEqual(CAPAS_DE_CIUDADES, [
      "lugares-capitales",
      "lugares-grandes",
      "lugares-ciudades",
    ]);
    for (const id of CAPAS_DE_CIUDADES)
      assert.strictEqual(simbolo(id)?.paint?.["text-opacity"], 0, id);
    for (const id of ["lugares-pueblos-grandes", "lugares-pueblos", "lugares-aldeas"]) {
      assert.isUndefined(simbolo(id)?.paint?.["text-opacity"], id);
    }
  });

  it("el tamaño de la letra de una copia es el que pinta MapLibre a ese zoom", () => {
    assert.strictEqual(tamanoDeRotulo("lugares-capitales", 2, 5), 14);
    assert.strictEqual(tamanoDeRotulo("lugares-capitales", 4, 8), 15);
    assert.strictEqual(tamanoDeRotulo("lugares-grandes", 6, 6.5), 12.5);
    assert.strictEqual(tamanoDeRotulo("lugares-ciudades", 99, 3), 12);
    assert.strictEqual(tamanoDeRotulo("lugares-ciudades", 99, 13), 15.5);
    // La expresión del estilo dice lo mismo en sus paradas.
    assert.deepStrictEqual<unknown>(simbolo("lugares-grandes")?.layout?.["text-size"], [
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      11.5,
      8,
      13.5,
      11,
      16,
    ]);
  });

  it("los huecos son iconos transparentes que ocupan su sitio, sin apartarse", () => {
    const huecos = simbolo(CAPA_HUECOS);
    assert.strictEqual(huecos?.layout?.["icon-allow-overlap"], true);
    assert.strictEqual(huecos?.layout?.["icon-ignore-placement"], false);
    assert.deepStrictEqual<unknown>(huecos?.paint, { "icon-opacity": 0 });
  });

  it("cada hueco pide una imagen de su tamaño en las unidades de su escala, redondeada a 4 px", () => {
    assert.strictEqual(
      imagenDeHueco({ longitud: 0, latitud: 0, ancho: 31, alto: 34.7, escala: 0.62 }),
      "hueco:52x56",
    );
    const pedidas: Array<string> = [];
    const imagenes = new Map<string, { width: number; height: number; data: Uint8Array }>();
    let resolver: ((id: string) => void) | undefined;
    crearImagenesDeHuecos({
      setMissingStyleImageResolver: (nuevo) => {
        resolver = nuevo;
      },
      hasImage: (id) => imagenes.has(id),
      addImage: (id, imagen) => {
        pedidas.push(id);
        imagenes.set(id, imagen);
      },
    });
    resolver?.("hueco:52x56");
    resolver?.("hueco:52x56");
    resolver?.("otro-icono");
    assert.deepStrictEqual(pedidas, ["hueco:52x56"]);
    assert.deepStrictEqual(imagenes.get("hueco:52x56"), {
      width: 52,
      height: 56,
      data: new Uint8Array(52 * 56 * 4),
    });
  });

  it("poner los mismos huecos otra vez no toca el mapa", () => {
    const puestas: Array<HuecosEnGeoJson> = [];
    const poner = puestaDeHuecos((datos) => puestas.push(datos));
    const huecos = [{ longitud: 2.1, latitud: 41.4, ancho: 44, alto: 50, escala: 1 }];
    poner(huecos);
    poner([...huecos]);
    assert.lengthOf(puestas, 1);
    assert.deepStrictEqual(puestas[0]?.features[0]?.properties, {
      imagen: "hueco:44x52",
      escala: 1,
    });
    poner([]);
    assert.lengthOf(puestas, 2);
  });
});
