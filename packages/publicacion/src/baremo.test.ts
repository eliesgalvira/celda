import {
  compararMedida,
  EMPLAZAMIENTOS_MINIMOS,
  enLaRecta,
  FORMATO_DEL_BAREMO,
  ficheroDeBaremo,
  generarBaremo,
  leerBaremo,
  type RectaDelBaremo,
} from "@celda/dominio/baremo";
import type { MedidaDeExposicion } from "@celda/dominio/exposicion";
import type { EstacionDeFicha, Ficha } from "@celda/dominio/ficha";
import { generarLoteDeProvincia } from "@celda/dominio/provincias";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { AlmacenDeFicheros } from "./almacen.ts";
import { sha256 } from "./almacenes/firma.ts";
import {
  baremoDeProvincia,
  type MedidaDeZona,
  medidasDeFichas,
  montarBaremos,
  rectaMediana,
} from "./baremo.ts";

const VERSION = "sitios@2026-10-20T22:30:02Z";

/** Números pseudoaleatorios reproducibles entre 0 y 1 (Park y Miller). */
const aleatorios = (semilla: number) => {
  let estado = semilla;
  return () => {
    estado = (estado * 48_271) % 2_147_483_647;
    return estado / 2_147_483_647;
  };
};

const sumaDeDesviaciones = (
  puntos: ReadonlyArray<{ x: number; y: number }>,
  recta: RectaDelBaremo,
) => puntos.reduce((suma, p) => suma + Math.abs(p.y - enLaRecta(recta, p.x)), 0);

/** La menor suma de desviaciones entre todas las rectas por dos puntos: una de ellas es la mejor. */
const sumaMinimaPorFuerzaBruta = (puntos: ReadonlyArray<{ x: number; y: number }>) => {
  let minima = Number.POSITIVE_INFINITY;
  for (const a of puntos) {
    for (const b of puntos) {
      if (a.x === b.x) continue;
      const pendiente = (b.y - a.y) / (b.x - a.x);
      const suma = sumaDeDesviaciones(puntos, { nivel: a.y - pendiente * a.x, pendiente });
      minima = Math.min(minima, suma);
    }
  }
  return minima;
};

describe("rectaMediana", () => {
  it("da la menor suma de desviaciones posible, como la búsqueda por fuerza bruta", () => {
    const azar = aleatorios(7);
    for (let caso = 0; caso < 200; caso++) {
      const cuantos = 2 + Math.floor(azar() * 14);
      // Distancias repetidas, como en el registro, que las da en metros enteros.
      const puntos = Array.from({ length: cuantos }, () => ({
        x: Math.log10(1 + Math.floor(azar() * 6) * 20),
        y: -20 * azar() + (azar() < 0.15 ? -40 : 0),
      }));
      const recta = rectaMediana(puntos);
      const esperada =
        new Set(puntos.map((p) => p.x)).size < 2 ? undefined : sumaMinimaPorFuerzaBruta(puntos);
      if (esperada === undefined) continue;
      assert.closeTo(sumaDeDesviaciones(puntos, recta), esperada, 1e-9, `caso ${caso}`);
    }
  });

  it("sigue a la mayoría y no se mueve por unas pocas medidas extremas", () => {
    const puntos = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((x) => ({ x, y: 4 - 3 * x }));
    const conExtremas = [...puntos, { x: 0.5, y: 60 }, { x: 2.5, y: -50 }];
    const recta = rectaMediana(conExtremas);
    assert.closeTo(recta.pendiente, -3, 1e-12);
    assert.closeTo(recta.nivel, 4, 1e-12);
  });

  it("con una sola distancia es horizontal, a la altura de la mediana", () => {
    assert.deepStrictEqual(
      rectaMediana([
        { x: 1, y: 3 },
        { x: 1, y: -2 },
        { x: 1, y: 7 },
      ]),
      { nivel: 3, pendiente: 0 },
    );
  });
});

const medida = (
  distanciaMetros: number,
  acimutGrados: number,
  microvatiosPorCm2: number,
): MedidaDeExposicion => ({ distanciaMetros, acimutGrados, microvatiosPorCm2 });

const estacion = (
  compania: EstacionDeFicha["compania"],
  medidas: ReadonlyArray<MedidaDeExposicion>,
): EstacionDeFicha => ({
  compania,
  codigos: ["1"],
  bandas: [],
  bandasSinLeer: false,
  origenes: [],
  medidasDeExposicion: medidas,
});

/** El lugar de un emplazamiento de la provincia de Barcelona, en `municipio` o en ninguno. */
const enBarcelona = (municipio: string | null): NonNullable<Ficha["lugar"]> => ({
  municipio: municipio === null ? null : { codigo: municipio, nombre: `Municipio ${municipio}` },
  provincia: { codigo: "08", nombre: "Barcelona" },
});

const ficha = (
  clave: string,
  lugar: Ficha["lugar"],
  estaciones: ReadonlyArray<EstacionDeFicha>,
): Ficha => {
  const sinLugar: Ficha = {
    clave,
    posicion: { longitud: 2.0, latitud: 41.3 },
    direccion: "CL PRUEBA, 1. GAVÀ, BARCELONA",
    municipio: "GAVÀ",
    estado: "verificado",
    confianza: "media",
    conflictos: [],
    estaciones,
    datosDel: 0,
    version: 0,
  };
  return lugar === undefined ? sinLugar : { ...sinLugar, lugar };
};

describe("medidasDeFichas", () => {
  it("cuenta una vez la medida que publican dos compañías del mismo emplazamiento", () => {
    const comun = medida(55, 227, 2.15456);
    const medidas = medidasDeFichas([
      ficha("a", enBarcelona("08089"), [
        estacion("orange", [comun, medida(80, 25, 0.53487)]),
        estacion("vodafone", [comun, medida(69, 188, 0.46219)]),
      ]),
    ]);
    assert.deepStrictEqual(
      medidas.map((m) => m.microvatiosPorCm2),
      [2.15456, 0.53487, 0.46219],
    );
    assert.isTrue(medidas.every((m) => m.provincia === "08" && m.municipio === "08089"));
  });

  it("deja fuera las fichas sin provincia y lleva sin municipio las de un territorio compartido", () => {
    const enElMar = [estacion("orange", [medida(5, 0, 1)])];
    const sinProvincia = ficha("mar", { municipio: null, provincia: null }, enElMar);
    const sinLugar = ficha("viejo", undefined, enElMar);
    const compartido = ficha("monte", enBarcelona(null), [
      estacion("movistar", [medida(30, 90, 0.2)]),
    ]);
    const medidas = medidasDeFichas([sinProvincia, sinLugar, compartido]);
    assert.deepStrictEqual(medidas, [
      {
        provincia: "08",
        municipio: null,
        emplazamiento: "monte",
        distanciaMetros: 30,
        microvatiosPorCm2: 0.2,
      },
    ]);
  });
});

/**
 * Una provincia sintética: `emplazamientos` por municipio, cinco medidas por emplazamiento a
 * distancias de 5 a 100 m, que siguen `nivel + pendiente · log10(d)` en dB con un ruido que se
 * abre cerca de la antena.
 */
const provincia = (
  municipios: ReadonlyArray<readonly [string, number]>,
  recta = { nivel: -3, pendiente: -4 },
  semilla = 11,
): ReadonlyArray<MedidaDeZona> => {
  const azar = aleatorios(semilla);
  return municipios.flatMap(([municipio, emplazamientos]) =>
    Array.from({ length: emplazamientos }, (_, e) =>
      Array.from({ length: 5 }, () => {
        const distancia = 5 + Math.round(azar() * 95);
        const ruido = (azar() + azar() + azar() - 1.5) * (12 - 4 * Math.log10(distancia));
        const db = enLaRecta(recta, Math.log10(distancia)) + ruido;
        return {
          provincia: "08",
          municipio,
          emplazamiento: `${municipio}-${e}`,
          distanciaMetros: distancia,
          microvatiosPorCm2: Number((10 ** (db / 10)).toFixed(5)),
        };
      }),
    ).flat(),
  );
};

describe("baremoDeProvincia", () => {
  it("encuentra la caída con la distancia y compara cada medida con lo típico a su distancia", () => {
    const baremo = baremoDeProvincia(
      VERSION,
      "08",
      provincia([
        ["08019", 400],
        ["08089", 60],
      ]),
    );
    assert.closeTo(baremo.tipica.pendiente, -4, 0.6);
    assert.closeTo(baremo.tipica.nivel, -3, 1);
    assert.isNotNull(baremo.zonaProvincial);
    const zona = baremo.zonaProvincial ?? assert.fail("sin zona provincial");
    assert.strictEqual(zona.emplazamientos, 460);
    assert.strictEqual(zona.medidas, 2300);
    assert.lengthOf(zona.cortes, 99);
    assert.deepStrictEqual(
      zona.cortes.toSorted((a, b) => a - b),
      zona.cortes,
    );

    // Lo típico a 50 m es la recta, y algo diez veces más alto queda arriba del todo.
    const tipica = 10 ** (enLaRecta(baremo.tipica, Math.log10(50)) / 10);
    const enLaTipica = compararMedida(baremo, zona, {
      distanciaMetros: 50,
      microvatiosPorCm2: tipica,
    });
    assert.closeTo(enLaTipica.masAltaQue, 50, 5);
    assert.closeTo(enLaTipica.tipica / tipica, 1, 0.15);
    assert.isAtLeast(
      compararMedida(baremo, zona, { distanciaMetros: 50, microvatiosPorCm2: tipica * 10 })
        .masAltaQue,
      95,
    );
    // A la misma distancia, más valor nunca queda más abajo.
    const valores = [0, 0.001, 0.01, 0.1, 1, 10];
    const puestos = valores.map(
      (v) => compararMedida(baremo, zona, { distanciaMetros: 20, microvatiosPorCm2: v }).masAltaQue,
    );
    assert.deepStrictEqual(
      puestos.toSorted((a, b) => a - b),
      puestos,
    );
    assert.strictEqual(puestos[0], 0);
  });

  it("las medidas de la zona quedan repartidas: de cada 100, cada puesto lo ocupa una", () => {
    const medidas = provincia([["08019", 300]]);
    const baremo = baremoDeProvincia(VERSION, "08", medidas);
    const zona = baremo.zonaProvincial ?? assert.fail("sin zona provincial");
    const puestos = medidas.map((m) => compararMedida(baremo, zona, m).masAltaQue);
    const media = puestos.reduce((s, p) => s + p, 0) / puestos.length;
    assert.closeTo(media, 49.5, 2);
    assert.closeTo(puestos.filter((p) => p >= 95).length / puestos.length, 0.05, 0.02);
  });

  it(`un municipio es zona con medidas de ${EMPLAZAMIENTOS_MINIMOS} emplazamientos, y no con uno menos`, () => {
    const baremo = baremoDeProvincia(
      VERSION,
      "08",
      provincia([
        ["08019", EMPLAZAMIENTOS_MINIMOS],
        ["08089", EMPLAZAMIENTOS_MINIMOS - 1],
      ]),
    );
    assert.deepStrictEqual(
      baremo.municipios.map((m) => [m.codigo, m.emplazamientos]),
      [["08019", EMPLAZAMIENTOS_MINIMOS]],
    );
    const pocos = baremoDeProvincia(
      VERSION,
      "51",
      provincia([["51001", EMPLAZAMIENTOS_MINIMOS - 1]]),
    );
    assert.isNull(pocos.zonaProvincial);
    assert.deepStrictEqual(pocos.municipios, []);
  });

  it("no depende del orden de las medidas, y una medida de 0 queda la más baja", () => {
    const medidas = [
      ...provincia([["08019", 120]]),
      {
        provincia: "08",
        municipio: "08019",
        emplazamiento: "cero",
        distanciaMetros: 0,
        microvatiosPorCm2: 0,
      },
    ];
    const azar = aleatorios(3);
    const barajadas = medidas
      .map((m) => ({ m, orden: azar() }))
      .toSorted((a, b) => a.orden - b.orden)
      .map(({ m }) => m);
    const baremo = baremoDeProvincia(VERSION, "08", medidas);
    assert.strictEqual(
      generarBaremo(baremoDeProvincia(VERSION, "08", barajadas)),
      generarBaremo(baremo),
    );
    const zona = baremo.zonaProvincial ?? assert.fail("sin zona provincial");
    assert.strictEqual(
      compararMedida(baremo, zona, { distanciaMetros: 0, microvatiosPorCm2: 0 }).masAltaQue,
      0,
    );
  });

  /**
   * La huella del baremo de una provincia sintética, por formato. Si cambia lo que sale del
   * cálculo, esta prueba falla: sube `FORMATO_DEL_BAREMO` y apunta aquí la huella nueva. Así la web
   * pide los baremos por otro nombre y el flujo de despliegue los vuelve a montar (ADR 0030).
   */
  const HUELLAS = {
    1: "98273fa4417e6debc1baf238b2784c5e05ebaac294a35263d8379b42ff234875",
  } satisfies Readonly<Record<number, string>>;

  it.effect("cada formato del baremo da siempre lo mismo", () =>
    Effect.gen(function* () {
      const contenido = generarBaremo(
        baremoDeProvincia(
          VERSION,
          "08",
          provincia([
            ["08019", 150],
            ["08089", 40],
          ]),
        ),
      );
      const huella = yield* Effect.orDie(sha256(contenido));
      assert.strictEqual(
        huella,
        HUELLAS[FORMATO_DEL_BAREMO],
        "El cálculo ha cambiado: sube FORMATO_DEL_BAREMO",
      );
    }),
  );
});

/** Un almacén en memoria, con lo que guarda a la vista. */
const almacenEnMemoria = (ficheros: Map<string, string>) =>
  AlmacenDeFicheros.of({
    guardar: (fichero, contenido) =>
      Effect.sync(() => {
        ficheros.set(fichero, contenido);
        return true;
      }),
    leer: (fichero) => Effect.sync(() => Option.fromNullishOr(ficheros.get(fichero))),
    cambiarVigente: (contenido) =>
      Effect.sync(() => {
        ficheros.set("vigente.json", contenido);
      }),
    listar: Effect.sync(() => [...ficheros.keys()]),
    borrar: (fichero) =>
      Effect.sync(() => {
        ficheros.delete(fichero);
      }),
    url: (fichero) => `/capas/${fichero}`,
  });

const FUENTE = {
  atribucion: "Instituto Geográfico Nacional",
  producto: "Base de Datos de Límites Jurisdiccionales de España",
  licencia: "CC BY 4.0",
  enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
  fecha: "2026-08-10",
  huella: "sha256:prueba",
};

const lote = (fichas: ReadonlyArray<Ficha>) =>
  generarLoteDeProvincia("08", fichas, new Map(), FUENTE);

describe("montarBaremos", () => {
  it.effect("guarda un baremo por provincia con medidas, con los lotes de la vigente", () =>
    Effect.gen(function* () {
      const ficheros = new Map([
        [
          "fichas/08/aaaaaaaaaaaaaaaa.json",
          lote([
            ficha("a", enBarcelona("08089"), [estacion("orange", [medida(55, 227, 2.15456)])]),
          ]),
        ],
        [
          "fichas/08/bbbbbbbbbbbbbbbb.json",
          lote([
            ficha("b", enBarcelona("08019"), [estacion("vodafone", [medida(7, 320, 0.66219)])]),
          ]),
        ],
        ["provincias/08/cccccccccccccccc.json", "{}"],
      ]);
      const montados = yield* montarBaremos(VERSION, [...ficheros.keys()]).pipe(
        Effect.provideService(AlmacenDeFicheros, almacenEnMemoria(ficheros)),
      );
      const fichero = ficheroDeBaremo(VERSION, "08");
      assert.strictEqual(fichero, `baremos/${FORMATO_DEL_BAREMO}/2026-10-20T22:30:02Z/08.json`);
      assert.deepStrictEqual(montados.ficheros, [fichero]);
      const leido = leerBaremo(ficheros.get(fichero) ?? "", VERSION, "08");
      assert.isTrue(Result.isSuccess(leido));
      // Dos emplazamientos no bastan para comparar con nadie.
      if (Result.isSuccess(leido)) assert.isNull(leido.success.zonaProvincial);
      assert.strictEqual(
        montados.bytes,
        new TextEncoder().encode(ficheros.get(fichero) ?? "").length,
      );
    }),
  );

  it.effect(
    "si un lote de la vigente falta o no se entiende, falla sin guardar ningún baremo",
    () =>
      Effect.gen(function* () {
        for (const [contenido, motivo] of [
          [undefined, "falta fichas/08/aaaaaaaaaaaaaaaa.json"],
          ['{"formato":7}', "fichas/08/aaaaaaaaaaaaaaaa.json no se entiende"],
        ] as const) {
          const ficheros = new Map<string, string>(
            contenido === undefined ? [] : [["fichas/08/aaaaaaaaaaaaaaaa.json", contenido]],
          );
          const error = yield* Effect.flip(
            montarBaremos(VERSION, ["fichas/08/aaaaaaaaaaaaaaaa.json"]).pipe(
              Effect.provideService(AlmacenDeFicheros, almacenEnMemoria(ficheros)),
            ),
          );
          assert.strictEqual(error._tag, "BaremoSinCalcular");
          assert.include(error._tag === "BaremoSinCalcular" ? error.motivo : "", motivo);
          assert.isFalse([...ficheros.keys()].some((f) => f.startsWith("baremos/")));
        }
      }),
  );
});
